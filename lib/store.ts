"use client";

// 買い物リストの状態を持つ唯一の場所。
//
// 方針(設計書 3-1):
//   1. 画面が読むのは常に手元(IndexedDB)。サーバの応答は待たない。
//   2. タップは即座にローカルへ書き、送信は outbox に積んで後から流す。
//   3. 競合は「チェック済みが勝つ」。二重購入を防ぐことを最優先する。
import * as local from "./local-db";
import { LOCAL_HOUSEHOLD_ID, localSeedItems } from "./seed-data";
import { looseMatch } from "./matching";
import { sectionRank } from "./sections";
import { getSupabase, isSupabaseConfigured } from "./supabase/client";
import {
  isTempId,
  type ItemId,
  type Op,
  type QueuedOp,
  type ShoppingItem,
} from "./types";

const TABLE = "shopping_list";
const META_HOUSEHOLD = "household_id";
const META_MEMBERS = "members";
/** 過去に足した品目。次に足すとき打ち直さずに済むよう、この端末に覚えておく。 */
const META_RECENT = "recent_items";
const RECENT_LIMIT = 40;
/** 一度ログインできたか。圏外でトークンの確認が取れないときの判断に使う。 */
const META_SIGNED_IN = "signed_in_once";
const META_USER_ID = "user_id";

/**
 * 通信を打ち切るまでの時間。
 * スーパーの中は「電波は立っているのに通らない」ことがあり、
 * navigator.onLine は true のままなので、応答が返らない場合に備えて必ず切る。
 */
const REQUEST_TIMEOUT_MS = 8_000;
const abortAfterTimeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

export type Snapshot = {
  items: ShoppingItem[];
  status: "loading" | "ready";
  /** cloud: Supabase と同期する / local: この端末だけで完結する(未設定時) */
  mode: "cloud" | "local";
  signedIn: boolean;
  online: boolean;
  syncing: boolean;
  /** 未送信の操作数。画面上部に出す(設計書 3-1)。 */
  pending: number;
  userId: string | null;
  householdId: string | null;
  members: Record<string, string>;
  error: string | null;
  /** サーバに拒否されて捨てた操作。error と違い、同期成功では消さない。 */
  discarded: { label: string; message: string }[];
  /** ログインが切れた。リストは見せたまま、入り直す導線だけ出す。 */
  authExpired: boolean;
  lastSyncedAt: string | null;
};

const INITIAL: Snapshot = {
  items: [],
  status: "loading",
  mode: isSupabaseConfigured ? "cloud" : "local",
  signedIn: false,
  online: true,
  syncing: false,
  pending: 0,
  userId: null,
  householdId: null,
  members: {},
  error: null,
  discarded: [],
  authExpired: false,
  lastSyncedAt: null,
};

let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();

function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getSnapshot = () => snapshot;
export const getServerSnapshot = () => INITIAL;

// -------------------------------------------------------------- ならべ替え

export function sortItems(items: ShoppingItem[]): ShoppingItem[] {
  return [...items].sort((a, b) => {
    const s = sectionRank(a.section) - sectionRank(b.section);
    if (s !== 0) return s;
    // チェック済みはセクション内で下に沈める(設計書 3-2)
    if (a.status !== b.status) return a.status === "未購入" ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return String(a.id).localeCompare(String(b.id));
  });
}

function setItems(items: ShoppingItem[]) {
  emit({ items: sortItems(items) });
}

function upsertLocalState(row: ShoppingItem) {
  const rest = snapshot.items.filter((i) => String(i.id) !== String(row.id));
  setItems([...rest, row]);
}

async function refreshPending() {
  const ops = await local.loadOutbox<QueuedOp>("items");
  emit({ pending: ops.length });
  return ops;
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as Error).message);
  return String(e);
}

/**
 * サーバに拒否されたのか、単に届かなかったのかを見分ける。
 *
 * ここを間違えると店内で実害が出る。postgrest-js は通信失敗・中断のときも
 * error を返すが、その中身は code:"" / status:0 になる。
 * 「code が文字列なら拒否」と見ていたため、電波が弱くてタイムアウトした
 * チェック操作が拒否扱いで捨てられ、次の pull でサーバ側の「未購入」に
 * 上書きされて、つけたはずのチェックが黙って消えていた。
 *
 * 拒否と言えるのは、Postgres のエラーコードが実際に入っていて、
 * かつ HTTP 応答が返ってきている(status が 0 でない)ときだけ。
 */
export function isPermanent(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { code, status } = e as { code?: unknown; status?: unknown };
  if (typeof code !== "string" || code === "") return false;
  if (status === 0) return false;
  return true;
}

function describeOp(op: Op): string {
  if (op.kind === "add") return `${op.item.item} の追加`;
  if (op.kind === "check") return "チェック";
  if (op.kind === "uncheck") return "チェック解除";
  if (op.kind === "upsertQty") return "数量の変更";
  return "削除";
}

// ------------------------------------------------------------------ 初期化

let initialized = false;
let realtimeBound = false;

export async function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  emit({ online: navigator.onLine });
  window.addEventListener("online", () => {
    emit({ online: true });
    void syncNow();
  });
  window.addEventListener("offline", () => emit({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });

  // まず手元のデータで描く。ここまでにネットワークは一切使わない。
  const cached = await local.loadRows<ShoppingItem>("items");
  setItems(cached);
  await refreshPending();

  const supabase = getSupabase();
  if (!supabase) {
    if (cached.length === 0) {
      const seeded = localSeedItems(new Date().toISOString());
      await local.replaceRows("items", seeded);
      setItems(seeded);
    }
    emit({ status: "ready", mode: "local", householdId: LOCAL_HOUSEHOLD_ID });
    return;
  }

  // 前回の世帯 id / メンバー名・ログイン実績は手元に残してある。
  // これがあれば、圏外でトークンの確認が取れなくても操作を受け付けられる。
  const knownHousehold = (await local.getMeta<string>(META_HOUSEHOLD)) ?? null;
  const signedInBefore = (await local.getMeta<boolean>(META_SIGNED_IN)) ?? false;
  const knownUserId = (await local.getMeta<string>(META_USER_ID)) ?? null;

  // キャッシュは利用者ごとの引き出しに入っている。前回の人を思い出しておかないと、
  // 起動直後の1回だけ空の引き出しを読んで「圏外だと何も出ない」ことになる。
  // signedInBefore が false のときは引き出しを開けない(= 前の人のものを読まない)。
  local.setCacheScope(signedInBefore ? knownUserId : null);

  emit({
    householdId: knownHousehold,
    members: (await local.getMeta<Record<string, string>>(META_MEMBERS)) ?? {},
    userId: knownUserId,
    signedIn: signedInBefore,
  });

  /*
   * ここで画面を「読み込み中」から解放する。
   *
   * 以前はこの後の getSession() を待ってから ready にしていた。
   * トークンが切れた端末をスーパーの地下で開くと、auth-js が更新のため通信に出て
   * 失敗し、指数バックオフで数十秒「読み込み中…」が続いたうえ、
   * session=null で全面ログイン画面に差し替わり、手元にある買い物リストが
   * 1件も見えなくなっていた。設計の一番大事な場面で真逆の挙動だった。
   *
   * 以降は待たない。状態は onAuthStateChange などで遅れて入ってくればよい。
   */
  emit({ status: "ready" });

  // 別タブでのログインや、後からトークンが復帰した場合にも追随する
  supabase.auth.onAuthStateChange((event, next) => {
    if (event === "SIGNED_OUT") {
      // 別のタブでサインアウトされた場合もここに来る。
      // 手元に残っているものを消すのは signOut() と同じ理由(下を読むこと)。
      local.setCacheScope(null);
      emit({ signedIn: false, userId: null, householdId: null, members: {} });
      void local.setMeta(META_SIGNED_IN, false);
      void local.clearCache();
      void local.clearMeta();
    } else if (next?.user && next.user.id !== snapshot.userId) {
      void markSignedIn(next.user.id);
      void loadHousehold().then(() => syncNow()).then(bindRealtime);
    }
  });

  void resumeSession(supabase);
}

/** ログインできていることを手元にも残す。圏外での判断材料になる。 */
async function markSignedIn(userId: string) {
  // キャッシュの持ち主を先に切り替える。これより後のどの読み書きも
  // この人の引き出しに入る。順番を逆にすると、切り替わる前の1回だけ
  // 前の人の引き出しを読んでしまう。
  local.setCacheScope(userId);
  emit({ signedIn: true, userId, authExpired: false });
  await local.setMeta(META_SIGNED_IN, true);
  await local.setMeta(META_USER_ID, userId);
}

/**
 * 保存済みトークンの確認。画面を止めずに後追いで行う。
 *
 * getSession() は保存済みトークンを読むだけ…ではなく、期限が切れていれば
 * 更新のため通信に出る。圏外だとここで長く待たされるので、必ず打ち切る。
 */
async function resumeSession(supabase: NonNullable<ReturnType<typeof getSupabase>>) {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  const result = await Promise.race([
    supabase.auth.getSession().then((r) => r.data.session),
    timeout,
  ]);

  if (result?.user) {
    await markSignedIn(result.user.id);
    await loadHousehold();
    await syncNow();
    bindRealtime();
    return;
  }

  /*
   * 確認が取れなかった。ここでログイン画面に落としてはいけない。
   *
   * 「確認できなかった」と「ログアウトされた」は別物で、圏外や弱電波では
   * 前者が普通に起きる。navigator.onLine もリロード後は true に戻るため
   * 判断材料にならない。手元のリストを見せ続けるほうが、店内では正しい。
   *
   * 本当にログインが切れている場合は、同期が 401 で弾かれた時点で分かる
   * (syncNow の中で判定してログインを促す)。
   */
  if (snapshot.signedIn) {
    await loadHousehold();
    await syncNow();
    bindRealtime();
  }
}

/** ログインが本当に切れているか。オンラインで認証を拒否されたときだけ真。 */
function isAuthFailure(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { code, status, message } = e as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (status === 401 || status === 403) return true;
  // PostgREST は JWT 不正を PGRST301 で返す
  if (code === "PGRST301") return true;
  return typeof message === "string" && message.includes("JWT");
}

async function loadHousehold() {
  const supabase = getSupabase();
  if (!supabase || !navigator.onLine) return;
  const { data, error } = await supabase
    .from("household_members")
    .select("household_id,user_id,display_name")
    .abortSignal(abortAfterTimeout());
  if (error || !data?.length) return;

  const householdId = data[0].household_id as string;
  const members: Record<string, string> = {};
  for (const row of data) {
    if (row.display_name) members[row.user_id as string] = row.display_name as string;
  }
  emit({ householdId, members });
  await local.setMeta(META_HOUSEHOLD, householdId);
  await local.setMeta(META_MEMBERS, members);
}

// -------------------------------------------------------------------- 同期

export async function syncNow() {
  const supabase = getSupabase();
  if (!supabase || snapshot.mode !== "cloud") return;
  if (!snapshot.householdId || !navigator.onLine || snapshot.syncing) return;

  emit({ syncing: true });
  try {
    await flushOutbox();
    await pull();
    // discarded はここで消さない。「送れなかったもの」は本人が見て納得するまで残す。
    emit({ error: null, lastSyncedAt: new Date().toISOString() });
  } catch (e) {
    // ここで初めて「本当に切れている」と分かる。圏外の推測では落とさない。
    if (isAuthFailure(e)) {
      /*
       * ログインが切れた。ただし手元のリストは隠さない。
       * signedIn を false にすると全面ログイン画面に差し替わり、
       * 圏外対策で直したはずの「店内でリストが見えない」が再発する。
       * 送信待ちは積んだままにして、入り直せば流れるようにする。
       */
      emit({ authExpired: true, error: null });
      void local.setMeta(META_SIGNED_IN, false);
    } else if (isPermanent(e)) {
      emit({ error: errorMessage(e) });
    }
    // 通信が届かなかっただけなら「エラー」とは言わない。
    // 圏外は想定内で、伝えるべきは未送信の件数のほう。
  } finally {
    emit({ syncing: false });
  }
}

export function dismissDiscarded() {
  emit({ discarded: [] });
}

/**
 * 買い物リストを開いている間だけ、定期的に取りに行く。
 *
 * 手分けして店内を回っているとき、相手のチェックが届く経路は realtime か
 * 自分の操作しかなかった。WebSocket が切れると取りこぼしは配られず、
 * 画面を見続けているので visibilitychange も起きない。
 * 「電波は立っているのに通らない」場面では online イベントも来ないため、
 * 何もタップせず歩いている数分間、画面が古いまま=同じ物を2人が買う。
 */
export function startPolling(): () => void {
  let timer: number | null = null;
  const tick = () => {
    if (document.visibilityState === "visible") void syncNow();
    // 送信待ちが残っている間は短い間隔で。送れたら通常間隔に戻す。
    const interval = snapshot.pending > 0 ? 20_000 : 30_000;
    timer = window.setTimeout(tick, interval);
  };
  timer = window.setTimeout(tick, 30_000);
  return () => {
    if (timer !== null) window.clearTimeout(timer);
  };
}

/** 未送信の操作を積んだ順に流す。1件でも失敗したらそこで止め、次の機会に再送する。 */
async function flushOutbox() {
  const supabase = getSupabase();
  if (!supabase) return;

  // add で採番された id を後続の操作へ貼り替えるため、1件ずつ読み直す。
  let guard = (await local.loadOutbox<QueuedOp>("items")).length + 10;
  while (guard-- > 0) {
    const ops = await local.loadOutbox<QueuedOp>("items");
    const op = ops[0];
    if (!op) break;

    try {
      await sendOp(op);
    } catch (e) {
      // ログインが切れているだけなら、積んだまま待つ。捨てると
      // 店内でつけたチェックが全部消える。
      if (isAuthFailure(e)) throw e;
      if (!isPermanent(e)) throw e; // 通信断・中断。積んだまま次回に回す
      // サーバに拒否された操作を先頭に残すと以降が永久に詰まるので捨てる。
      // ただし黙って消さない。何を捨てたかは画面に残す。
      emit({
        discarded: [
          ...snapshot.discarded,
          { label: describeOp(op), message: errorMessage(e) },
        ],
      });
    }
    await local.dequeue(op.opId);
    await refreshPending();
  }
}

async function sendOp(op: Op) {
  const supabase = getSupabase()!;

  if (op.kind === "add") {
    const { item } = op;

    // 応答が返る前に切れた場合、行だけ入っていることがある。
    // added_at を手元の値で送っておき、再送のときはそれで既存行を探して二重登録を防ぐ。
    const { data: existing } = await supabase
      .from(TABLE)
      .select("*")
      .eq("household_id", item.household_id)
      .eq("item", item.item)
      .eq("added_at", item.added_at)
      .abortSignal(abortAfterTimeout())
      .maybeSingle();

    let row = existing as ShoppingItem | null;
    if (!row) {
      const { data, error } = await supabase
        .from(TABLE)
        .insert({
          household_id: item.household_id,
          item: item.item,
          qty: item.qty,
          reason: item.reason,
          section: item.section,
          sort_order: item.sort_order,
          status: item.status,
          added_at: item.added_at,
        })
        .select()
        .abortSignal(abortAfterTimeout())
        .single();
      if (error) throw error;
      row = data as ShoppingItem;
    }

    await local.removeRow("items", op.tempId);
    await local.saveRows("items", [row]);
    await local.remapOutboxId("items", op.tempId, row.id);
    const rest = snapshot.items.filter((i) => String(i.id) !== op.tempId);
    setItems([...rest, row]);
    return;
  }

  // add がまだ流れていない一時 id は、この時点では触れない
  if (isTempId(op.id)) return;

  if (op.kind === "check") {
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "購入済", checked_by: op.by, checked_at: op.at })
      .eq("id", op.id)
      .abortSignal(abortAfterTimeout());
    if (error) throw error;
    return;
  }

  if (op.kind === "upsertQty") {
    const { error } = await supabase
      .from(TABLE)
      .update({ qty: op.qty })
      .eq("id", op.id)
      .abortSignal(abortAfterTimeout());
    if (error) throw error;
    return;
  }

  if (op.kind === "uncheck") {
    // 自分がタップした後に相手がチェックしていたら外さない(チェック済みが勝つ)
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "未購入", checked_by: null, checked_at: null })
      .eq("id", op.id)
      .lte("checked_at", op.at)
      .abortSignal(abortAfterTimeout());
    if (error) throw error;
    return;
  }

  /*
   * 削除には2種類ある。
   *
   * ・本人が明示的に消したもの(長押し削除・在庫へ移した後の片付け)
   *   → 状態に関わらず消す。消えないと、次の pull で復活してリストに戻り、
   *     もう一度「在庫に入れる」と在庫が二重になる。
   * ・圏外中に消したものが、その間に相手に買われていた場合
   *   → 「買った記録」のほうが失って困るので消さない。
   *
   * 前者に後者の条件を掛けていたため、在庫へ移した品が必ず戻ってきていた。
   */
  const query = supabase.from(TABLE).delete().eq("id", op.id);
  const { error } = await (op.force
    ? query.abortSignal(abortAfterTimeout())
    : query.eq("status", "未購入").abortSignal(abortAfterTimeout()));
  if (error) throw error;
}

/** サーバの内容で手元を引き直す。未送信の操作がある行だけは手元を優先する。 */
async function pull() {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .abortSignal(abortAfterTimeout());
  if (error) throw error;

  const ops = await local.loadOutbox<QueuedOp>("items");
  const pendingIds = new Set(
    ops.map((op) => ("id" in op ? String(op.id) : op.tempId)),
  );
  const byId = new Map(snapshot.items.map((i) => [String(i.id), i]));

  const merged = (data as ShoppingItem[]).map((row) => {
    const mine = byId.get(String(row.id));
    return mine && pendingIds.has(String(row.id)) ? mine : row;
  });

  // まだサーバに届いていない自分の追加行を残す
  const serverIds = new Set((data as ShoppingItem[]).map((r) => String(r.id)));
  const localOnly = snapshot.items.filter(
    (i) => !serverIds.has(String(i.id)) && pendingIds.has(String(i.id)),
  );

  const next = [...merged, ...localOnly];
  await local.replaceRows("items", next);
  setItems(next);
}

/**
 * 相手の変更を受け取る購読。
 *
 * 以前は realtimeBound の旗で1回しか張らなかった。店内で WebSocket が切れると
 * postgres_changes は取りこぼしを後から配らないので、そこから先の相手の
 * チェックが永久に届かなくなっていた。切れたら張り直し、張り直した直後に
 * pull() を1回走らせて、切れていた間の差分を埋める。
 */
let channel: ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null = null;

function bindRealtime() {
  const supabase = getSupabase();
  if (!supabase || realtimeBound) return;
  realtimeBound = true;

  // 同じ名前で channel() を呼ぶと既存のインスタンスが返り、
  // 張り直すたびにハンドラが1本ずつ増えていく。必ず捨ててから作る。
  if (channel) void supabase.removeChannel(channel);

  channel = supabase
    .channel("shopping_list_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE },
      async (payload) => {
        const ops = await local.loadOutbox<QueuedOp>("items");
        const pendingIds = new Set(ops.map((op) => ("id" in op ? String(op.id) : op.tempId)));

        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id?: ItemId })?.id;
          if (id == null) return;
          await local.removeRow("items", id);
          setItems(snapshot.items.filter((i) => String(i.id) !== String(id)));
          return;
        }

        const row = payload.new as ShoppingItem;
        if (!row?.id) return;
        // 自分の未送信操作があるうちは、相手の更新で上書きしない
        if (pendingIds.has(String(row.id))) return;
        await local.saveRows("items", [row]);
        upsertLocalState(row);
      },
    )
    .subscribe((status) => {
      if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        realtimeBound = false;
        // すぐ張り直すと切断中に落ちた更新を取り逃すので、必ず取り直してから
        window.setTimeout(() => {
          if (realtimeBound) return;
          void syncNow().then(() => bindRealtime());
        }, 3000);
      }
    });
}

// ---------------------------------------------------------------- 画面操作

/**
 * 送信待ちに積む。
 *
 * 条件を signedIn ではなく householdId にしてあるのは、圏外でトークンの
 * 確認が取れないときでも操作を積むため。以前は signedIn が false になる場面
 * (まさに店内)で早期 return し、タップが outbox にすら残らなかった。
 */
async function queue(op: Op) {
  if (snapshot.mode !== "cloud") return;
  if (!snapshot.householdId) {
    // 世帯の登録が見つからないと保存先が決まらない。
    // 黙って捨てると「入れたのに相手に出ない」が延々続くので、必ず知らせる。
    emit({
      error:
        "世帯の登録が見つかりません。household_members にこの利用者が登録されているか確認してください。",
    });
    void loadHousehold();
    return;
  }
  await local.enqueue("items", op);
  await refreshPending();
  void syncNow();
}

/** チェックの入り切り。ローカルへ即書きして画面を更新し、送信は後追い。 */
export async function toggle(id: ItemId) {
  const item = snapshot.items.find((i) => String(i.id) === String(id));
  if (!item) return;

  const at = new Date().toISOString();
  const checking = item.status === "未購入";
  const next: ShoppingItem = checking
    ? { ...item, status: "購入済", checked_by: snapshot.userId, checked_at: at }
    : { ...item, status: "未購入", checked_by: null, checked_at: null };

  await local.saveRows("items", [next]);
  upsertLocalState(next);
  await queue(checking ? { kind: "check", id, at, by: snapshot.userId } : { kind: "uncheck", id, at });
}

export type NewItem = {
  item: string;
  qty: string | null;
  section: string;
  reason: string | null;
};

export type RecentItem = { item: string; qty: string | null; section: string };

/**
 * すでにリストにある同じものを探す。
 *
 * 夫が「牛乳」を足した後に妻も足すと同じ売り場に2行並び、店では2本カゴに入る。
 * レシピからの一括追加はもっと起きやすく、別々のレシピで玉ねぎを足すと
 * 理由が「◯◯用」で違うので、同じ物とすら気づけない。
 * 買う前に気づけるよう、追加のたびに未購入の同等品を見る。
 */
export function findDuplicate(name: string): ShoppingItem | null {
  return (
    snapshot.items.find((i) => i.status === "未購入" && looseMatch(i.item, name)) ?? null
  );
}

/** 既存の行に数量を足す(「まとめる」を選んだとき)。 */
export async function mergeIntoItem(id: ItemId, extraQty: string | null) {
  const item = snapshot.items.find((i) => String(i.id) === String(id));
  if (!item) return;
  const qty = [item.qty, extraQty].filter(Boolean).join(" + ") || null;
  const next = { ...item, qty };
  await local.saveRows("items", [next]);
  upsertLocalState(next);
  await queue({ kind: "upsertQty", id, qty, at: new Date().toISOString() });
}

/**
 * よく買うものの候補。
 *
 * 買い物リストの行は、在庫へ流し込むときに消える。だから履歴をサーバに残しても
 * 拾えない。この端末の中に、足した品目だけを覚えておく。
 * 圏外でも出せるうえ、スキーマも増やさずに済む。
 */
export async function loadRecentItems(): Promise<RecentItem[]> {
  return (await local.getMeta<RecentItem[]>(META_RECENT)) ?? [];
}

async function rememberItem(input: NewItem) {
  const previous = await loadRecentItems();
  const next = [
    { item: input.item, qty: input.qty, section: input.section },
    ...previous.filter((r) => r.item !== input.item),
  ].slice(0, RECENT_LIMIT);
  await local.setMeta(META_RECENT, next);
}

/** 足した行をそのまま返す。呼び出し側が「取り消す」で消せるようにするため */
export async function addItem(input: NewItem): Promise<ShoppingItem> {
  const householdId = snapshot.householdId ?? LOCAL_HOUSEHOLD_ID;
  const sameSection = snapshot.items.filter((i) => i.section === input.section);
  const sortOrder = sameSection.reduce((max, i) => Math.max(max, i.sort_order), 0) + 10;

  const row: ShoppingItem = {
    id: `tmp_${crypto.randomUUID()}`,
    household_id: householdId,
    item: input.item,
    qty: input.qty,
    reason: input.reason,
    section: input.section,
    sort_order: sortOrder,
    status: "未購入",
    checked_by: null,
    checked_at: null,
    added_at: new Date().toISOString(),
  };

  await local.saveRows("items", [row]);
  upsertLocalState(row);
  await rememberItem(input);
  await queue({ kind: "add", tempId: row.id as string, item: row });
  return row;
}

/** 本人が消したもの。相手が買っていても消す(force)。 */
export async function removeItem(id: ItemId) {
  await local.removeRow("items", id);
  setItems(snapshot.items.filter((i) => String(i.id) !== String(id)));
  await queue({ kind: "delete", id, force: true });
}

/**
 * サインアウト。
 *
 * 【手元に残っているものを全部消すこと】
 * 以前は買い物リスト(items)だけ消していた。それでは足りない。
 * useTable は select * で取った行をまるごと IndexedDB の cache に置くので、
 * そこには予定・コメント・家計まで入っている。予定には「非公開タグを付けた、
 * 本人しか見られないはずの予定」が含まれる。
 *
 * この端末は2人で共有されうる。妻がサインアウトしたあと夫が予定を開くと、
 * useTable はログイン確認より先にキャッシュを描くので、
 * 妻の非公開予定がそのまま画面に出る。圏外ならサーバに取り直しに行かないので
 * 消えずに残り続ける。DB 側で RLS を書いても、この経路には効かない。
 */
export async function signOut() {
  const supabase = getSupabase();
  await supabase?.auth.signOut();
  await local.replaceRows("items", []);
  await local.replaceRows("inventory", []);
  await local.clearCache();
  await local.clearMeta();
  local.setCacheScope(null);
  emit({
    ...INITIAL,
    status: "ready",
    online: typeof navigator === "undefined" ? true : navigator.onLine,
  });
}
