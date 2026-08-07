"use client";

// 献立と調理記録の書き込み。
//
// 買い物リストや在庫と違い、これらは家の中で使う機能なので、
// オフライン用の送信待ち行列は持たせていない。通信できないときは
// その場で失敗を伝えて、後でやり直してもらうほうが分かりやすい。
import * as local from "./local-db";
import { getSnapshot as getSession } from "./store";
import { getSupabase } from "./supabase/client";

const REQUEST_TIMEOUT_MS = 20_000;
const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

export class OfflineError extends Error {
  constructor() {
    super("通信できないため保存できませんでした。電波のあるところでやり直してください。");
    this.name = "OfflineError";
  }
}

function requireClient() {
  const supabase = getSupabase();
  if (!supabase || !getSession().signedIn || !navigator.onLine) throw new OfflineError();
  return supabase;
}

/** 書き込んだら、その表のキャッシュを捨てて次回に読み直させる。 */
async function invalidate(table: string) {
  await local.writeCache(table, []);
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
  await invalidate("cook_log");
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
  await invalidate("meal_plan");
}

export async function setMealStatus(id: number, status: "予定" | "実施" | "中止") {
  const supabase = requireClient();
  const { error } = await supabase
    .from("meal_plan")
    .update({ status })
    .eq("id", id)
    .abortSignal(signal());
  if (error) throw error;
  await invalidate("meal_plan");
}

export async function deleteMealPlan(id: number) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("meal_plan")
    .delete()
    .eq("id", id)
    .abortSignal(signal());
  if (error) throw error;
  await invalidate("meal_plan");
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
  };
  const query = input.id
    ? supabase.from("events").update(row).eq("id", input.id)
    : supabase.from("events").insert(row);
  const { error } = await query.abortSignal(signal());
  if (error) throw error;
  await invalidate("events");
}

export async function deleteEvent(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("events").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  await invalidate("events");
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
  await invalidate("chores");
}

export async function deleteChore(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("chores").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  await invalidate("chores");
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
  await invalidate("chore_log");
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
  await invalidate("transactions");
}

export async function deleteTransaction(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("transactions").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  await invalidate("transactions");
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
  await invalidate("budgets");
}

export async function deleteBudget(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("budgets").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  await invalidate("budgets");
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
  await invalidate("accounts");
}

export async function deleteAccount(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("accounts").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  await invalidate("accounts");
  await invalidate("balances");
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
  await invalidate("balances");
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
  await invalidate("income");
}

export async function deleteIncome(id: number) {
  const supabase = requireClient();
  const { error } = await supabase.from("income").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  await invalidate("income");
}
