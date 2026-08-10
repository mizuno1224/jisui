"use client";

// 献立と調理記録の書き込み。
//
// 買い物リストや在庫と違い、これらは家の中で使う機能なので、
// オフライン用の送信待ち行列は持たせていない。通信できないときは
// その場で失敗を伝えて、後でやり直してもらうほうが分かりやすい。
import { markStale } from "./table-cache";
import { getSnapshot as getSession } from "./store";
import { getSupabase } from "./supabase/client";

const REQUEST_TIMEOUT_MS = 8_000;
const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

export class OfflineError extends Error {
  constructor() {
    super("通信できないため保存できませんでした。電波のあるところでやり直してください。");
    this.name = "OfflineError";
  }
}

function requireClient() {
  const supabase = getSupabase();
  if (!supabase || !getSession().householdId || !navigator.onLine) throw new OfflineError();
  return supabase;
}

/**
 * 書き込んだら「古くなった」と印を立てる。
 *
 * 以前はここでキャッシュを空配列に置き換えていた。そのため保存直後に
 * 圏外になると、サーバには入っているのに「予定なし」「記録はありません」と
 * 出てしまった。キャッシュは消さず、次に読むとき通信を1回強制するだけにする。
 */
function invalidate(table: string) {
  markStale(table);
}

export async function logCooking(input: {
  recipeId: number | null;
  name: string;
  date: string;
  rating?: number | null;
  memo?: string | null;
  batch?: boolean;
}) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("cook_log")
    .insert({
      household_id: getSession().householdId,
      date: input.date,
      recipe_id: input.recipeId,
      name: input.name,
      batch: input.batch ?? false,
      rating: input.rating ?? null,
      memo: input.memo ?? null,
    })
    .abortSignal(signal());
  if (error) throw error;
  invalidate("cook_log");
}

export async function addMealPlan(input: {
  date: string;
  slot?: string;
  recipeId: number | null;
  name: string;
}) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("meal_plan")
    .insert({
      household_id: getSession().householdId,
      date: input.date,
      slot: input.slot ?? "夕食",
      recipe_id: input.recipeId,
      name: input.name,
      status: "予定",
    })
    .abortSignal(signal());
  if (error) throw error;
  invalidate("meal_plan");
}

/**
 * 「作った」を1本にまとめる。
 *
 * 予定タブの「作った」は meal_plan の状態だけ、レシピ詳細の「記録する」は
 * cook_log だけを書いていた。家計の「1食あたり」は cook_log の件数で割るので、
 * 普段の運用(予定タブで押す)では永久に「—」のままだった。
 * どちらの入口から押しても両方に残す。
 */
export async function markCooked(input: {
  planId?: number;
  recipeId: number | null;
  name: string;
  date: string;
}) {
  const supabase = requireClient();

  if (input.planId) {
    const { error } = await supabase
      .from("meal_plan")
      .update({ status: "実施" })
      .eq("id", input.planId)
      .abortSignal(signal());
    if (error) throw error;
  } else if (input.recipeId != null) {
    // レシピ側から押されたときは、同じ日の予定があればそれも実施にする
    await supabase
      .from("meal_plan")
      .update({ status: "実施" })
      .eq("date", input.date)
      .eq("recipe_id", input.recipeId)
      .abortSignal(signal());
  }

  // 同じ日に同じものを二重に記録しない(1食あたりの計算が狂うため)
  // 同じ日に同じものが2行あっても落ちないよう limit(1) で見る
  const { data: already } = await supabase
    .from("cook_log")
    .select("id")
    .eq("date", input.date)
    .eq("name", input.name)
    .limit(1)
    .abortSignal(signal());

  if (!already?.length) {
    const { error } = await supabase
      .from("cook_log")
      .insert({
        household_id: getSession().householdId,
        date: input.date,
        recipe_id: input.recipeId,
        name: input.name,
      })
      .abortSignal(signal());
    if (error) throw error;
  }

  invalidate("meal_plan");
  invalidate("cook_log");
}

export async function setMealStatus(id: number, status: "予定" | "実施" | "中止") {
  const supabase = requireClient();
  const { error } = await supabase
    .from("meal_plan")
    .update({ status })
    .eq("id", id)
    .abortSignal(signal());
  if (error) throw error;
  invalidate("meal_plan");
}

export async function deleteMealPlan(id: number) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("meal_plan")
    .delete()
    .eq("id", id)
    .abortSignal(signal());
  if (error) throw error;
  invalidate("meal_plan");
}

// ------------------------------------------------------------------ 予定

export async function saveEvent(input: {
  id?: number;
  date: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  title: string;
  memo?: string | null;
  /** null = 2人の共有予定。【非公開とは別の話】。下の tagId を読むこと */
  ownerId: string | null;
  /**
   * 色と、非公開かどうかを決めるタグ。
   *
   * 非公開タグを選ぶと、その予定は相手から【完全に見えなくなる】。
   * 隠す判定はサーバ側(RLS)で行う。ここで送るのは tag_id だけで、
   * 「誰の秘密か」はデータベースのトリガがタグから決める。
   * アプリが private_owner_id を送っても無視される(送ってはいけない)。
   */
  tagId?: number | null;
  location?: string | null;
  url?: string | null;
  /** 持ち物メモ。改行区切りのただの文字列 */
  items?: string | null;
  /** 通知を何分前に出すか。null = 通知しない */
  notifyMin?: number | null;
  repeat?: string | null;
  repeatUntil?: string | null;
}) {
  const supabase = requireClient();
  const row = {
    household_id: getSession().householdId,
    date: input.date,
    end_date: input.endDate || null,
    start_time: input.startTime || null,
    end_time: input.endTime || null,
    title: input.title,
    memo: input.memo ?? null,
    owner_id: input.ownerId,
    created_by: getSession().userId,
    tag_id: input.tagId ?? null,
    location: input.location ?? null,
    url: input.url ?? null,
    items: input.items ?? null,
    notify_min: input.notifyMin ?? null,
    repeat: input.repeat ?? "なし",
    repeat_until: input.repeatUntil || null,
    // label はサーバのトリガが公開タグ名で埋める。ここでは送らない
    // (非公開タグの名前が label に残ると、あとで公開に切り替えたとき漏れる)
  };
  const query = input.id
    ? supabase.from("events").update(row).eq("id", input.id)
    : supabase.from("events").insert(row);
  const { error } = await query.abortSignal(signal());
  if (error) throw error;
  invalidate("events");
}

export async function deleteEvent(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("events").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("events");
}

/** 予定ごとのやりとり。「何時に出る?」を予定に紐づけて残す。 */
export async function addEventComment(eventId: number, body: string) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("event_comments")
    .insert({
      household_id: getSession().householdId,
      event_id: eventId,
      user_id: getSession().userId,
      body,
    })
    .abortSignal(signal());
  if (error) throw error;
  invalidate("event_comments");
}

export async function deleteEventComment(id: number) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("event_comments")
    .delete()
    .eq("id", id)
    .abortSignal(signal());
  if (error) throw error;
  invalidate("event_comments");
}

// ------------------------------------------------------------------ 家事

export async function saveChore(input: {
  id?: number;
  name: string;
  weekdays: number[];
  monthday?: number | null;
  assigneeId?: string | null;
  memo?: string | null;
  active?: boolean;
}) {
  const supabase = requireClient();
  const row = {
    household_id: getSession().householdId,
    name: input.name,
    weekdays: input.weekdays,
    monthday: input.monthday ?? null,
    assignee_id: input.assigneeId ?? null,
    memo: input.memo ?? null,
    active: input.active ?? true,
  };
  const query = input.id
    ? supabase.from("chores").update(row).eq("id", input.id)
    : supabase.from("chores").insert(row);
  const { error } = await query.abortSignal(signal());
  if (error) throw error;
  invalidate("chores");
}

export async function deleteChore(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("chores").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("chores");
}

/** 家事のチェック。同じ日に二重で入らないよう、外すときは行ごと消す。 */
export async function toggleChoreDone(choreId: number, date: string, done: boolean) {
  const supabase = requireClient();
  if (done) {
    const { error } = await supabase
      .from("chore_log")
      .insert({
        household_id: getSession().householdId,
        chore_id: choreId,
        date,
        done_by: getSession().userId,
      })
      .abortSignal(signal());
    // 相手が同時に押した場合の重複は成功扱いにする(結果は同じ「やった」なので)
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await supabase
      .from("chore_log")
      .delete()
      .eq("chore_id", choreId)
      .eq("date", date)
      .abortSignal(signal());
    if (error) throw error;
  }
  invalidate("chore_log");
}

// ---------------------------------------------------------------- 家計簿

/** 手入力の支出。dedup_hash は必須なので、同じ計算式で作る(設計書 5-2)。 */
async function dedupHash(date: string, amount: number, merchant: string): Promise<string> {
  const data = new TextEncoder().encode(`${date}|${amount}|${merchant}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function saveTransaction(input: {
  id?: number;
  date: string;
  amount: number;
  merchant: string;
  category: string;
  source?: string;
  memo?: string | null;
}) {
  const supabase = requireClient();
  const row = {
    household_id: getSession().householdId,
    date: input.date,
    amount: input.amount,
    merchant_raw: input.merchant,
    category: input.category,
    source: input.source ?? "手入力",
    memo: input.memo ?? null,
    dedup_hash: await dedupHash(input.date, input.amount, input.merchant),
  };
  const query = input.id
    ? supabase.from("transactions").update(row).eq("id", input.id)
    : supabase.from("transactions").insert(row);
  const { error } = await query.abortSignal(signal());
  if (error) {
    if (error.code === "23505") {
      throw new Error("同じ日付・金額・店名の記録がすでにあります。");
    }
    throw error;
  }
  invalidate("transactions");
}

export async function deleteTransaction(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("transactions").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("transactions");
}

export async function saveBudget(category: string, amount: number, yearMonth: string | null) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("budgets")
    .upsert(
      { household_id: getSession().householdId, category, amount, year_month: yearMonth },
      { onConflict: "household_id,category,year_month" },
    )
    .abortSignal(signal());
  if (error) throw error;
  invalidate("budgets");
}

export async function deleteBudget(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("budgets").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("budgets");
}

// ------------------------------------------------------ 資産・負債・収入

export async function saveAccount(input: {
  id?: number;
  name: string;
  kind: "資産" | "負債";
  category?: string | null;
  memo?: string | null;
}) {
  const supabase = requireClient();
  const row = {
    household_id: getSession().householdId,
    name: input.name,
    kind: input.kind,
    category: input.category ?? null,
    memo: input.memo ?? null,
  };
  const query = input.id
    ? supabase.from("accounts").update(row).eq("id", input.id)
    : supabase.from("accounts").insert(row);
  const { error } = await query.abortSignal(signal());
  if (error) throw error;
  invalidate("accounts");
}

export async function deleteAccount(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("accounts").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("accounts");
  invalidate("balances");
}

export async function saveBalance(accountId: number, yearMonth: string, amount: number) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("balances")
    .upsert(
      { household_id: getSession().householdId, account_id: accountId, year_month: yearMonth, amount },
      { onConflict: "account_id,year_month" },
    )
    .abortSignal(signal());
  if (error) throw error;
  invalidate("balances");
}

export async function saveIncome(input: {
  id?: number;
  date: string;
  amount: number;
  source: string;
  memo?: string | null;
}) {
  const supabase = requireClient();
  const row = {
    household_id: getSession().householdId,
    date: input.date,
    amount: input.amount,
    source: input.source,
    memo: input.memo ?? null,
  };
  const query = input.id
    ? supabase.from("income").update(row).eq("id", input.id)
    : supabase.from("income").insert(row);
  const { error } = await query.abortSignal(signal());
  if (error) throw error;
  invalidate("income");
}

export async function deleteIncome(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("income").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("income");
}

// -------------------------------------------------------------- 投資

export async function saveWatchItem(input: {
  id?: number;
  code: string;
  name: string;
  market?: string | null;
  memo?: string | null;
}) {
  const supabase = requireClient();
  const row = {
    household_id: getSession().householdId,
    code: input.code,
    name: input.name,
    market: input.market ?? null,
    memo: input.memo ?? null,
  };
  const query = input.id
    ? supabase.from("watchlist").update(row).eq("id", input.id)
    : supabase.from("watchlist").insert(row);
  const { error } = await query.abortSignal(signal());
  if (error) throw error;
  invalidate("watchlist");
}

export async function deleteWatchItem(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("watchlist").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("watchlist");
}

// -------------------------------------------------------------- 予定のタグ

export async function saveTag(input: {
  id?: number;
  name: string;
  color: string;
  /**
   * true = このタグを付けた予定は自分しか見られない。
   *
   * 【作ったあとは変えられない】。データベース側のトリガで止めてある。
   * 公開→非公開にすると、相手が使っていた予定が予告なく相手の画面から消える。
   * 非公開→公開にすると、隠していた過去の予定が一気に相手に出る。
   * どちらも1回の操作で取り返しがつかないので、作るときだけ決める。
   */
  isPrivate?: boolean;
  sortOrder?: number;
}) {
  const supabase = requireClient();
  const base = {
    name: input.name,
    color: input.color,
    sort_order: input.sortOrder ?? 50,
  };
  const query = input.id
    ? supabase.from("calendar_tags").update(base).eq("id", input.id)
    : supabase.from("calendar_tags").insert({
        ...base,
        household_id: getSession().householdId,
        private: input.isPrivate ?? false,
        // 非公開タグには持ち主が要る(データベースの check 制約)。
        // 公開タグに持ち主を入れてもいけない。
        owner_id: input.isPrivate ? getSession().userId : null,
      });
  const { error } = await query.abortSignal(signal());
  if (error) throw error;
  invalidate("calendar_tags");
}

export async function deleteTag(id: number) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("calendar_tags")
    .delete()
    .eq("id", id)
    .abortSignal(signal());
  if (error) throw error;
  invalidate("calendar_tags");
  invalidate("events");
}

// ------------------------------------------------------------ やること

export async function saveTodo(input: {
  id?: number;
  title: string;
  detail?: string | null;
  dueDate?: string | null;
  assigneeId?: string | null;
  /** 親のやること。入れ子は1段まで(データベース側でも止めてある) */
  parentId?: number | null;
  repeat?: string | null;
  repeatUntil?: string | null;
  sortOrder?: number;
}) {
  const supabase = requireClient();
  const row = {
    household_id: getSession().householdId,
    title: input.title,
    detail: input.detail ?? null,
    due_date: input.dueDate || null,
    assignee_id: input.assigneeId ?? null,
    parent_id: input.parentId ?? null,
    repeat: input.repeat ?? "なし",
    repeat_until: input.repeatUntil || null,
    sort_order: input.sortOrder ?? 0,
  };
  // 作ったばかりの行の id を返す。サブタスクをぶら下げるのに要る。
  const query = input.id
    ? supabase.from("todos").update(row).eq("id", input.id).select("id")
    : supabase.from("todos").insert(row).select("id");
  const { data, error } = await query.abortSignal(signal());
  if (error) throw error;
  invalidate("todos");
  return (data?.[0]?.id as number | undefined) ?? input.id ?? null;
}

/**
 * やることを完了/未完了にする。
 *
 * 【繰り返すやることは、行を増やさずに期限を進める】
 *
 * 毎週のものを完了にしたとき、新しい行を作って古い行を
 * 履歴として残すやり方もあるが、このアプリでは採らない。
 * lib/use-table.ts が select * で全行を IndexedDB に書く作りなので、
 * 行が増え続ける = 端末のキャッシュがそのまま太る。
 * 毎日のごみ出しを1年続けたら365行になる。
 *
 * かわりに、行は1本のまま due_date を次回へ進める。
 * done_at / done_by は「最後にやった日 / 人」として上書きする。
 * 子タスクも未完了に戻して、親と一緒に次回へ持っていく。
 *
 * 履歴が欲しい繰り返しは、家事(chores / chore_log)の担当。
 * こちらで二重に持たない。11_schema_v5.sql の D 章の設計メモと揃えてある。
 */
export async function setTodoDone(
  todo: {
    id: number;
    status: string;
    due_date: string | null;
    repeat: string | null;
    repeat_until: string | null;
  },
  done: boolean,
): Promise<{ recurred: boolean; nextDue: string | null }> {
  const supabase = requireClient();

  const repeats = Boolean(todo.repeat && todo.repeat !== "なし");
  const next = done && repeats && todo.due_date ? nextDue(todo.due_date, todo.repeat!) : null;
  // repeat_until を過ぎたら、次回へ進めずに完了で終わらせる
  const carryOn = next != null && (!todo.repeat_until || next <= todo.repeat_until);

  const patch = carryOn
    ? {
        status: "open",
        due_date: next,
        done_at: new Date().toISOString(),
        done_by: getSession().userId,
      }
    : {
        status: done ? "done" : "open",
        done_at: done ? new Date().toISOString() : null,
        done_by: done ? getSession().userId : null,
      };

  const { error } = await supabase
    .from("todos")
    .update(patch)
    .eq("id", todo.id)
    .abortSignal(signal());
  if (error) throw error;

  if (carryOn) {
    // 子をまとめて未完了に戻す。親だけ進めて子を残すと、
    // 次の回の準備がすでに済んだことになってしまう。
    const { error: childError } = await supabase
      .from("todos")
      .update({ status: "open", done_at: null, done_by: null })
      .eq("parent_id", todo.id)
      .abortSignal(signal());
    if (childError) throw childError;
  } else if (done) {
    // 繰り返さない親を完了にしたら、子もまとめて完了にする。
    // 親が済んだのに子が未完了で残ると、件数の表示が合わなくなる。
    await supabase
      .from("todos")
      .update({ status: "done", done_at: new Date().toISOString(), done_by: getSession().userId })
      .eq("parent_id", todo.id)
      .eq("status", "open")
      .abortSignal(signal());
  }

  invalidate("todos");
  return { recurred: carryOn, nextDue: carryOn ? next : null };
}

export async function deleteTodo(id: number) {
  const supabase = requireClient();
  // 子は on delete cascade で一緒に消える(11_schema_v5.sql)
  const { error } = await supabase.from("todos").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("todos");
}

/**
 * 次の期限。
 *
 * 月末の扱いは予定の繰り返し(lib/event-labels.ts)と同じ。
 * 31日や 2/29 はその月に無いことがあるので、その月の最終日に寄せる
 * (月末の支払いは月末に出したい)。
 * 語彙は DB の todos_repeat_check と完全に揃えること。
 */
function nextDue(due: string, repeat: string): string | null {
  const d = new Date(`${due}T00:00:00`);
  const monthly = (months: number) => {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  };

  if (repeat === "毎日") d.setDate(d.getDate() + 1);
  else if (repeat === "毎週") d.setDate(d.getDate() + 7);
  else if (repeat === "隔週") d.setDate(d.getDate() + 14);
  else if (repeat === "毎月") monthly(1);
  else if (repeat === "毎年") monthly(12);
  else return null;

  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ------------------------------------------------------------ レシピ

/**
 * レシピを保存する。
 *
 * 【なぜアプリから作れる必要があるのか】
 * これまでレシピはチャット(Cowork)からしか作れなかった。
 * ところがチャットはクラウドで動くと Supabase に届かず、パソコンも要る。
 * スマホしか手元に無いときに献立を思いついても、記録する先が無かった。
 *
 * スマホの Claude アプリに相談して、返ってきた本文をそのまま貼れるようにする。
 * これで追加の課金なしに、スマホだけで「相談する → 記録する」が閉じる。
 */
export async function saveRecipe(input: {
  id?: number;
  name: string;
  category?: string | null;
  protein?: string | null;
  timeMin?: number | null;
  freezable?: boolean;
  freezeNotes?: string | null;
  /** 手順の本文(Markdown)。レシピ画面がそのまま表示する */
  cardMd?: string | null;
  source?: string | null;
  tags?: string | null;
}) {
  const supabase = requireClient();
  const row = {
    household_id: getSession().householdId,
    name: input.name,
    category: input.category ?? null,
    protein: input.protein ?? null,
    time_min: input.timeMin ?? null,
    freezable: input.freezable ?? false,
    freeze_notes: input.freezeNotes ?? null,
    card_md: input.cardMd ?? null,
    source: input.source ?? null,
    tags: input.tags ?? null,
  };
  const query = input.id
    ? supabase.from("recipes").update(row).eq("id", input.id).select("id")
    : supabase.from("recipes").insert(row).select("id");
  const { data, error } = await query.abortSignal(signal());
  if (error) throw error;
  invalidate("recipes");
  return (data?.[0]?.id as number | undefined) ?? input.id ?? null;
}

export async function deleteRecipe(id: number) {
  const supabase = requireClient();
  // 材料は on delete cascade で一緒に消える(01_schema.sql)
  const { error } = await supabase.from("recipes").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("recipes");
  invalidate("recipe_ingredients");
}

/**
 * レシピの材料をまとめて入れ替える。
 *
 * 1件ずつ足し引きせず、そのレシピのぶんを全部消してから入れ直す。
 * 貼り直すたびに古い材料が残るほうが厄介なため。
 * この表には household_id が無い(世帯はレシピ経由で判定される)。
 */
export async function replaceRecipeIngredients(
  recipeId: number,
  items: { name: string; qty?: number | null; unit?: string | null; optional?: boolean }[],
) {
  const supabase = requireClient();
  const del = await supabase
    .from("recipe_ingredients")
    .delete()
    .eq("recipe_id", recipeId)
    .abortSignal(signal());
  if (del.error) throw del.error;
  if (items.length === 0) return;
  const { error } = await supabase
    .from("recipe_ingredients")
    .insert(
      items.map((i) => ({
        recipe_id: recipeId,
        name: i.name,
        qty: i.qty ?? null,
        unit: i.unit ?? null,
        optional: i.optional ?? false,
      })),
    )
    .abortSignal(signal());
  if (error) throw error;
  invalidate("recipe_ingredients");
}
