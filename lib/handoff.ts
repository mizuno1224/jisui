import { getSupabase } from "@/lib/supabase/client";
import { getSnapshot as getSession } from "@/lib/store";
import * as local from "@/lib/local-db";

/**
 * チャット(Cowork)が出した「受け渡し JSON」を、アプリから直接 Supabase に入れる。
 *
 * 【なぜこれが要るのか】
 * チャットはクラウドで動くので Supabase に届かない。
 * パソコン経由でファイルを置く道は作ってあるが、それはデスクトップアプリが
 * 起きている必要があり、スマホしか無いときに使えない。
 *
 * この画面は、チャットが出した JSON を【人がコピーして貼る】ことで橋を渡す。
 * アプリはスマホからでも Supabase に届くので、パソコンが一切要らなくなる。
 *
 * 遠回りに見えるが、追加の課金も、常時起動のパソコンも要らない。
 */

export const HANDOFF_KIND = "jisui-handoff";
/** 形を変えたら上げる。cowork/jisui/db.py の HANDOFF_VERSION と揃える。 */
export const HANDOFF_VERSION = 1;

/**
 * この画面が扱える操作。**下の applyOne の case と揃えること。**
 *
 * 型にしてあるのは、頼む側の文章(lib/handoff-prompt.ts)を道連れにするため。
 * op を足してここに書くと、あちらの説明が欠けている間は tsc が落ちる。
 * 揃っていないと、チャットは正しいつもりで、入らない JSON を返し続ける。
 */
export type HandoffOp =
  | "add_receipt"
  | "import_card_row"
  | "add_shopping"
  | "add_event"
  | "add_todo"
  | "add_rule"
  | "add_checkup"
  | "insert";

/** 入れなかったが、失敗ではないもの。すでに同じものがある場合など。 */
class SkipError extends Error {}

export type HandoffRecord = {
  op: string;
  key?: string;
  args: Record<string, unknown>;
};

export type Handoff = {
  kind: string;
  version?: number;
  created_at?: string;
  skill_version?: string;
  note?: string | null;
  records: HandoffRecord[];
};

/**
 * 貼られた文字列から、受け渡し JSON の部分だけを拾い出す。
 *
 * 【前後に文章が付いてくる前提で読む】
 * アプリが配る依頼文(lib/handoff-prompt.ts)は、チャットに
 * 「JSON はコードブロックに入れて、**説明はその外に書く**」と頼んでいる。
 * つまり返事には必ず前後に文章が付く。スマホで返事をまるごとコピーすると
 * それがそのまま貼られるので、全体を JSON として読もうとすると必ず落ちる。
 * こちらから文章を書けと頼んでおきながら、その形を読めないのは筋が通らない。
 *
 * 試す順番は、素のまま → コードブロックの中 → いちばん外側の { … }。
 * **素のままを先に試す**ので、いま読めている貼り方の結果は変わらない。
 */
function* jsonCandidates(s: string): Generator<string> {
  yield s;
  // ```json … ``` は文章のどこにあってもよい。複数あれば順に試す。
  for (const m of s.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g)) {
    const body = m[1].trim();
    if (body) yield body;
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) yield s.slice(start, end + 1);
}

/** 貼られた文字列を読む。前後の文章やコードブロックの ``` が付いていても剥がす。 */
export function parseHandoff(text: string): { ok: true; value: Handoff } | { ok: false; why: string } {
  const s = text.trim();
  if (!s) return { ok: false, why: "何も貼られていません。" };

  /*
   * 読めたもののうち【受け渡し JSON を優先して選ぶ】。
   * 献立の相談などで、チャットが別のコードブロック(レシピの表など)を
   * 先に出すことがある。先に読めたほうを採ると、それを見て
   * 「これは受け渡し JSON ではない」と言ってしまい、
   * 下に本物があるのに気づけない。
   */
  let picked: unknown;
  let firstError: string | null = null;
  for (const candidate of jsonCandidates(s)) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch (e) {
      firstError ??= e instanceof Error ? e.message : String(e);
      continue;
    }
    if (value && typeof value === "object" && (value as Handoff).kind === HANDOFF_KIND) {
      picked = value;
      break;
    }
    picked ??= value;
  }

  if (picked === undefined) {
    return {
      ok: false,
      why:
        `JSON として読めません: ${firstError ?? "中身がありません"}\n` +
        "チャットの返事のうち、{ で始まって } で終わる部分だけを貼ってください。",
    };
  }
  const data = picked;
  if (!data || typeof data !== "object") return { ok: false, why: "中身が空です。" };
  const h = data as Handoff;
  if (h.kind !== HANDOFF_KIND) {
    return {
      ok: false,
      why:
        `これは受け渡し JSON ではないようです(kind が「${h.kind ?? "無し"}」)。\n` +
        "チャットに「受け渡し JSON を出して」と頼んでください。",
    };
  }
  if (!Array.isArray(h.records) || h.records.length === 0) {
    return { ok: false, why: "records が空です。入れるものがありません。" };
  }
  for (const r of h.records) {
    if (!r || typeof r.op !== "string" || !r.args || typeof r.args !== "object") {
      return { ok: false, why: "records の中に、op か args が欠けたものがあります。" };
    }
  }
  return { ok: true, value: h };
}

/** 何をするつもりかを日本語で1行にする。入れる前に人が読んで確かめるため。 */
export function describeRecord(r: HandoffRecord): string {
  const a = r.args as Record<string, never>;
  const n = (k: string) => (a[k] as unknown as string | number | undefined) ?? "";
  switch (r.op) {
    case "add_receipt":
      return `レシート: ${n("date")} ${n("merchant_raw")} ${Number(n("amount")).toLocaleString()}円(${n("category")})`;
    case "import_card_row":
      return `カード明細: ${n("date")} ${n("merchant_raw")} ${Number(n("amount")).toLocaleString()}円`;
    case "add_shopping": {
      const items = (a["items"] as unknown as { item?: string }[]) ?? [];
      return `買い物リストに ${items.length} 件: ${items.map((i) => i?.item ?? "?").join("、")}`;
    }
    case "add_event":
      return `予定: ${n("date")} ${n("title")}`;
    case "add_todo":
      return `やること: ${n("title")}`;
    case "add_rule":
      return `分類の決まり: 「${n("keyword")}」→ ${n("category")}`;
    case "add_checkup": {
      const results = (a["results"] as unknown as unknown[]) ?? [];
      return `健康診断: ${n("date")} ${n("member")} ${n("kind")}(${results.length} 項目)`;
    }
    case "insert": {
      const rows = (a["rows"] as unknown as unknown[]) ?? [];
      return `${n("table")} に ${rows.length} 行`;
    }
    default:
      return `${r.op}(中身は下の詳細を見てください)`;
  }
}

async function sha256hex(src: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** date|amount|merchant_raw の SHA-256。db.py の dedup_hash と同じ計算。 */
async function dedupHash(date: string, amount: number, merchant: string): Promise<string> {
  return sha256hex(`${date}|${amount}|${merchant}`);
}

/**
 * 中身から必ず同じ文字列を作る。鍵のもとにする。
 *
 * 【鍵に時刻を入れない】
 * 入れると、同じ内容を2回書き出しただけで別物になり、二重に入る。
 * cowork/jisui/db.py の _canonical と同じ形にしてあるので、
 * スキルが付けた鍵と、ここで作る鍵は、同じ中身なら同じになる。
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

/**
 * 1件ごとの鍵。**無ければ中身から作る。**
 *
 * 【なぜ作るのか】
 * 鍵を付けてくれるのはスキルを積んだチャットだけ。
 * アプリが配る依頼文(lib/handoff-prompt.ts)で書かせた JSON には鍵が無い。
 * 鍵が無いと「この端末で入れ済み」の控えが効かず、
 * 同じものを2回貼ると、予定もやることも買い物も二重に入る。
 * レシートとレシピは DB 側にも守りがあるが、ほかは何も無い。
 */
export async function handoffKeys(h: Handoff): Promise<string[]> {
  return Promise.all(
    h.records.map((r) => (r.key ? Promise.resolve(r.key) : sha256hex(`${r.op}|${canonical(r.args)}`))),
  );
}

const APPLIED_KEY = "handoff_applied_keys";

async function loadApplied(): Promise<string[]> {
  return (await local.getMeta<string[]>(APPLIED_KEY)) ?? [];
}

async function markApplied(keys: string[]) {
  const cur = await loadApplied();
  // 増え続けないよう、直近300件だけ覚える。レシートは DB 側にも守りがある。
  await local.setMeta(APPLIED_KEY, [...cur, ...keys].slice(-300));
}

/**
 * 何番目の記録が「この端末で入れ済み」か。
 *
 * 鍵の一覧ではなく **並び順の真偽** を返す。鍵は無いことがあり
 * (依頼文で書かせた JSON には付かない)、鍵で照合する側は
 * handoffKeys をもう一度呼ぶことになって、同じ SHA-256 を2回計算していた。
 */
export async function appliedFlags(h: Handoff): Promise<boolean[]> {
  const applied = new Set(await loadApplied());
  const keys = await handoffKeys(h);
  return keys.map((k) => applied.has(k));
}

/**
 * 1件ずつ入れる。1件が失敗しても残りは続ける。
 * 「途中まで入った」を隠さず、どれが入ってどれが入らなかったかを返す。
 */
export async function applyHandoff(
  h: Handoff,
): Promise<{ ok: string[]; skipped: string[]; failed: { what: string; why: string }[] }> {
  const supabase = getSupabase();
  const householdId = getSession().householdId;
  if (!supabase) throw new Error("Supabase につながっていません。");
  if (!householdId) throw new Error("世帯が分かりません。ログインし直してください。");

  const applied = new Set(await loadApplied());
  const keys = await handoffKeys(h);
  const done: string[] = [];
  const skipped: string[] = [];
  const failed: { what: string; why: string }[] = [];
  const newKeys: string[] = [];

  for (const [i, r] of h.records.entries()) {
    const what = describeRecord(r);
    const key = keys[i];
    if (applied.has(key)) {
      skipped.push(`${what} — この端末で入れ済み`);
      continue;
    }
    try {
      await applyOne(r, householdId, supabase);
      done.push(what);
      newKeys.push(key);
    } catch (e) {
      if (e instanceof SkipError) {
        skipped.push(`${what} — ${e.message}`);
        newKeys.push(key);
        continue;
      }
      failed.push({ what, why: e instanceof Error ? e.message : String(e) });
    }
  }
  if (newKeys.length > 0) await markApplied(newKeys);
  return { ok: done, skipped, failed };
}

type Client = NonNullable<ReturnType<typeof getSupabase>>;

async function applyOne(r: HandoffRecord, householdId: string, supabase: Client) {
  const a = r.args as Record<string, unknown>;
  const str = (k: string) => (a[k] == null ? null : String(a[k]));
  const num = (k: string) => (a[k] == null ? null : Number(a[k]));

  // case を足したら HandoffOp にも足すこと(そこから頼む側の説明までつながっている)。
  switch (r.op) {
    case "add_receipt":
    case "import_card_row": {
      const date = str("date");
      const amount = num("amount");
      const merchant = str("merchant_raw");
      if (!date || amount == null || !merchant) {
        throw new Error("date / amount / merchant_raw のどれかが足りません。");
      }
      const hash = await dedupHash(date, amount, merchant);
      // 同じレシートを2回入れない。ここは DB 側にも unique がある。
      const dup = await supabase
        .from("transactions")
        .select("id")
        .eq("household_id", householdId)
        .eq("dedup_hash", hash)
        .limit(1);
      if (dup.error) throw dup.error;
      if ((dup.data ?? []).length > 0) return; // 既に入っている。成功扱い。

      const tx = await supabase
        .from("transactions")
        .insert({
          household_id: householdId,
          date,
          amount,
          merchant_raw: merchant,
          category: str("category") ?? "要確認",
          source: str("source") ?? (r.op === "add_receipt" ? "レシート" : "カード明細"),
          memo: str("memo"),
          dedup_hash: hash,
          needs_review: Boolean(a["needs_review"]) || str("category") == null,
        })
        .select("id");
      if (tx.error) throw tx.error;
      const txId = tx.data?.[0]?.id as number | undefined;

      const items = (a["items"] as { item?: string; price?: number }[] | undefined) ?? [];
      if (txId && items.length > 0) {
        /*
         * 【receipt_items に household_id を送らない】
         * この表は household_id を持たない。世帯は transaction_id をたどって
         * 決まる(04_schema_kakeibo.sql の RLS もその形)。送ると
         *   400 PGRST204 "Could not find the 'household_id' column"
         * で【1行も入らない】。品目つきのレシートが丸ごと落ちる。
         * checkup_result も同じ形なので、増やすときは気をつけること。
         */
        const ri = await supabase.from("receipt_items").insert(
          items.map((i) => ({
            transaction_id: txId,
            item: i.item ?? "",
            price: i.price ?? null,
          })),
        );
        if (ri.error) throw ri.error;
      }

      const inv = (a["inventory"] as Record<string, unknown>[] | undefined) ?? [];
      if (inv.length > 0) {
        const bad = inv.find(
          (i) => i.location != null && !LOCATIONS_OK.includes(String(i.location)),
        );
        if (bad) {
          throw new Error(
            `在庫の置き場所「${String(bad.location)}」は使えません。` +
              `使えるのは ${LOCATIONS_OK.join(" / ")} のどれかです。` +
              `(支出は入りました。在庫だけもう一度入れてください)`,
          );
        }
        const ins = await supabase
          .from("inventory")
          .insert(inv.map((i) => ({ ...i, household_id: householdId })));
        if (ins.error) throw ins.error;
      }
      return;
    }

    case "add_shopping": {
      const items = (a["items"] as Record<string, unknown>[] | undefined) ?? [];
      if (items.length === 0) return;
      const ins = await supabase.from("shopping_list").insert(
        items.map((i) => ({
          household_id: householdId,
          item: i.item,
          qty: i.qty ?? null,
          reason: i.reason ?? null,
          section: i.section ?? "要確認",
          status: "未購入",
        })),
      );
      if (ins.error) throw ins.error;
      return;
    }

    case "add_event": {
      const ins = await supabase.from("events").insert({
        household_id: householdId,
        date: str("date"),
        end_date: str("end_date"),
        start_time: str("start_time"),
        end_time: str("end_time"),
        title: str("title"),
        memo: str("memo"),
        location: str("location"),
        url: str("url"),
        items: str("items"),
        repeat: str("repeat") ?? "なし",
        repeat_until: str("repeat_until"),
        created_by: getSession().userId,
      });
      if (ins.error) throw ins.error;
      return;
    }

    case "add_todo": {
      const parent = await supabase
        .from("todos")
        .insert({
          household_id: householdId,
          title: str("title"),
          detail: str("detail"),
          due_date: str("due_date"),
          repeat: str("repeat") ?? "なし",
        })
        .select("id");
      if (parent.error) throw parent.error;
      const pid = parent.data?.[0]?.id as number | undefined;
      const subs = (a["subtasks"] as string[] | undefined) ?? [];
      if (pid && subs.length > 0) {
        const kids = await supabase
          .from("todos")
          .insert(subs.map((t) => ({ household_id: householdId, title: t, parent_id: pid })));
        if (kids.error) throw kids.error;
      }
      return;
    }

    /**
     * 健康診断(健診・人間ドック・血液検査)を1回ぶん入れる。
     *
     * 【これだけ専用の op にする理由】
     * 受診(checkup)と項目(checkup_result)の2つの表にまたがり、
     * 子は親の id を要る。汎用の insert では「先に親を入れて id を見てから
     * 子を書く」ができないので、まとめて入れる口をここに作る。
     *
     * 【基準値はチャットが検査票から写して送る】
     * こちらで一般的な基準を当てない。紙と画面で判定が食い違うため
     * (lib/checkup.ts の頭に理由を書いてある)。
     */
    case "add_checkup": {
      const date = str("date");
      const member = str("member");
      const kind = str("kind");
      if (!date || !member || !kind) throw new Error("date / member / kind のどれかが足りません。");

      // 同じ受診を2回入れない。表にも unique(member, date, kind) がある。
      const dup = await supabase
        .from("checkup")
        .select("id")
        .eq("household_id", householdId)
        .eq("member", member)
        .eq("date", date)
        .eq("kind", kind)
        .limit(1);
      if (dup.error) throw dup.error;
      if ((dup.data ?? []).length > 0) {
        throw new SkipError(`${date} の${kind}は既に入っています。直すときは SQL からにしてください`);
      }

      const head = await supabase
        .from("checkup")
        .insert({
          household_id: householdId,
          member,
          date,
          kind,
          place: str("place"),
          overall: str("overall"),
          finding: str("finding"),
          memo: str("memo"),
        })
        .select("id");
      if (head.error) throw head.error;
      const checkupId = head.data?.[0]?.id as number | undefined;

      const results = (a["results"] as Record<string, unknown>[] | undefined) ?? [];
      if (checkupId && results.length > 0) {
        const rows = results.map((r, i) => ({
          checkup_id: checkupId,
          item: String(r.item ?? ""),
          value_num: r.value_num == null ? null : Number(r.value_num),
          value_text: r.value_text == null ? null : String(r.value_text),
          unit: r.unit == null ? null : String(r.unit),
          ref_low: r.ref_low == null ? null : Number(r.ref_low),
          ref_high: r.ref_high == null ? null : Number(r.ref_high),
          ref_text: r.ref_text == null ? null : String(r.ref_text),
          judge: r.judge == null ? null : String(r.judge),
          memo: r.memo == null ? null : String(r.memo),
          // 検査票に書いてあった順。lib/checkup.ts の並びに無い項目は、この順で後ろに続く
          sort_order: r.sort_order == null ? i : Number(r.sort_order),
        }));
        const ins = await supabase.from("checkup_result").insert(rows);
        // 【受診だけ入って項目が入らない状態を黙って残さない】。
        // 次に同じ JSON を貼っても、受診が既にあるので飛ばされてしまう。
        if (ins.error) {
          throw new Error(
            `受診は入りましたが、項目が入りませんでした: ${ins.error.message}。` +
              `checkup の ${date} ${kind} を消してから、もう一度貼ってください。`,
          );
        }
      }
      return;
    }

    case "add_rule": {
      const ins = await supabase.from("expense_rules").insert({
        household_id: householdId,
        keyword: str("keyword"),
        category: str("category"),
        note: str("note"),
      });
      if (ins.error) throw ins.error;
      return;
    }

    case "insert": {
      const table = str("table");
      const rows = (a["rows"] as Record<string, unknown>[] | undefined) ?? [];
      if (!table || rows.length === 0) throw new Error("table か rows がありません。");
      if (!INSERTABLE.includes(table)) {
        throw new Error(
          `${table} への直接の書き込みは、この画面では受け付けません。` +
            `受け付けるのは ${INSERTABLE.join(" / ")} です。`,
        );
      }
      /*
       * 【全部の行で列をそろえてから送る】
       * PostgREST は一括挿入のとき、全ての行が同じ列を持つことを求める。
       * 1行目にあって2行目に無い列があると
       * 400 PGRST102 "All object keys must match" で【1行も入らない】。
       * レシピのように任意の欄がある表では普通に起きる。実際に落ちた。
       */
      const keys: string[] = [];
      for (const row of rows) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
      const even = rows.map((row) =>
        Object.fromEntries(keys.map((k) => [k, row[k] ?? null])),
      );
      /*
       * 【同じ名前のレシピを二重に作らない】
       * チャットは「銀鮭の照り焼き」のように、既にあるものの
       * 作り直したカードを送ってくることがある。素直に入れると同名が2つ並び、
       * どちらが本物か分からなくなる。実際に1件そうなった。
       * 既にある名前は飛ばし、何を飛ばしたかを呼び出し側に伝える。
       */
      let toInsert = even;
      if (table === "recipes") {
        const names = even.map((x) => String(x.name ?? ""));
        const found = await supabase
          .from("recipes")
          .select("name")
          .eq("household_id", householdId)
          .in("name", names);
        if (found.error) throw found.error;
        const exists = new Set((found.data ?? []).map((r) => (r as { name: string }).name));
        toInsert = even.filter((x) => !exists.has(String(x.name ?? "")));
        if (toInsert.length === 0) {
          throw new SkipError(
            `同じ名前のレシピが既にあります: ${[...exists].join("、")}。` +
              `作り直したいときは、レシピ画面から直してください。`,
          );
        }
      }

      // recipe_ingredients には household_id が無い(世帯はレシピ経由で判定される)
      const withHousehold =
        table === "recipe_ingredients"
          ? toInsert
          : toInsert.map((x) => ({ ...x, household_id: householdId }));
      const ins = await supabase.from(table).insert(withHousehold);
      if (ins.error) throw ins.error;
      return;
    }

    default:
      throw new Error(`「${r.op}」はこの画面では扱えません。`);
  }
}

/** 在庫の置き場所。supabase/12a_schema_v6_constraint.sql の check と揃える。 */
const LOCATIONS_OK = ["冷蔵", "氷温", "野菜", "冷凍", "常温"];

/**
 * insert で受け付ける表。
 * 何でも書けるようにすると、貼り付けた JSON1つで世帯のデータを壊せてしまう。
 * 献立とレシピと在庫まわりだけに絞る。
 */
const INSERTABLE = [
  "meal_plan",
  "recipes",
  "recipe_ingredients",
  "inventory",
  "cook_log",
  "pantry",
  "preferences",
  "equipment",
];
