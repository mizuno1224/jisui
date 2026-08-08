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
  const { data: already } = await supabase
    .from("cook_log")
    .select("id")
    .eq("date", input.date)
    .eq("name", input.name)
    .abortSignal(signal())
    .maybeSingle();

  if (!already) {
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
  title: string;
  memo?: string | null;
  /** null = 2人の共有予定 */
  ownerId: string | null;
  label?: string | null;
  repeat?: string | null;
  repeatUntil?: string | null;
}) {
  const supabase = requireClient();
  const row = {
    household_id: getSession().householdId,
    date: input.date,
    end_date: input.endDate || null,
    start_time: input.startTime || null,
    title: input.title,
    memo: input.memo ?? null,
    owner_id: input.ownerId,
    created_by: getSession().userId,
    label: input.label ?? null,
    repeat: input.repeat ?? "なし",
    repeat_until: input.repeatUntil || null,
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
