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
