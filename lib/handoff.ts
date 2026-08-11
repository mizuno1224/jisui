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

/** 貼られた文字列を読む。コードブロックの ``` が付いていても剥がす。 */
export function parseHandoff(text: string): { ok: true; value: Handoff } | { ok: false; why: string } {
  let s = text.trim();
  // ```json … ``` で囲まれて渡されることが多い。剥がしてから読む。
  const fence = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  if (fence) s = fence[1].trim();
  if (!s) return { ok: false, why: "何も貼られていません。" };

  let data: unknown;
  try {
    data = JSON.parse(s);
  } catch (e) {
    return {
      ok: false,
      why:
        `JSON として読めません: ${e instanceof Error ? e.message : String(e)}\n` +
        "チャットの返事のうち、{ で始まって } で終わる部分だけを貼ってください。",
    };
  }
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
    case "insert": {
      const rows = (a["rows"] as unknown as unknown[]) ?? [];
      return `${n("table")} に ${rows.length} 行`;
    }
    default:
      return `${r.op}(中身は下の詳細を見てください)`;
  }
}

/** date|amount|merchant_raw の SHA-256。db.py の dedup_hash と同じ計算。 */
async function dedupHash(date: string, amount: number, merchant: string): Promise<string> {
  const src = `${date}|${amount}|${merchant}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

export async function alreadyApplied(h: Handoff): Promise<string[]> {
  const applied = new Set(await loadApplied());
  return h.records.filter((r) => r.key && applied.has(r.key)).map((r) => r.key!);
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
  const done: string[] = [];
  const skipped: string[] = [];
  const failed: { what: string; why: string }[] = [];
  const newKeys: string[] = [];

  for (const r of h.records) {
    const what = describeRecord(r);
    if (r.key && applied.has(r.key)) {
      skipped.push(`${what} — この端末で入れ済み`);
      continue;
    }
    try {
      await applyOne(r, householdId, supabase);
      done.push(what);
      if (r.key) newKeys.push(r.key);
    } catch (e) {
      if (e instanceof SkipError) {
        skipped.push(`${what} — ${e.message}`);
        if (r.key) newKeys.push(r.key);
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
        const ri = await supabase.from("receipt_items").insert(
          items.map((i) => ({
            household_id: householdId,
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
