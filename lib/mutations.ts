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
 * 繰り返すやること(毎週のゴミ出しなど)を完了にしたときは、
 * 次の期限の行を新しく作る。行を作り直す方式にしたのは、
 * 「いつ済ませたか」が1件ずつ残るため。完了日を別表に持つ方式だと
 * 履歴は綺麗だが、画面に出すたびに繰り返しを展開する処理が要る。
 */
export async function setTodoDone(todo: {
  id: number;
  status: string;
  title: string;
  detail: string | null;
  due_date: string | null;
  assignee_id: string | null;
  parent_id: number | null;
  repeat: string | null;
  repeat_until: string | null;
  sort_order: number;
}, done: boolean) {
  const supabase = requireClient();
  const { error } = await supabase
    .from("todos")
    .update({
      status: done ? "done" : "open",
      done_at: done ? new Date().toISOString() : null,
      done_by: done ? getSession().userId : null,
    })
    .eq("id", todo.id)
    .abortSignal(signal());
  if (error) throw error;

  if (done && todo.repeat && todo.repeat !== "なし" && todo.due_date) {
    const next = nextDue(todo.due_date, todo.repeat);
    if (next && (!todo.repeat_until || next <= todo.repeat_until)) {
      await saveTodo({
        title: todo.title,
        detail: todo.detail,
        dueDate: next,
        assigneeId: todo.assignee_id,
        parentId: todo.parent_id,
        repeat: todo.repeat,
        repeatUntil: todo.repeat_until,
        sortOrder: todo.sort_order,
      });
    }
  }
  invalidate("todos");
}

export async function deleteTodo(id: number) {
  const supabase = requireClient();
  // 子は on delete cascade で一緒に消える(schema_v5.sql)
  const { error } = await supabase.from("todos").delete().eq("id", id).abortSignal(signal());
  if (error) throw error;
  invalidate("todos");
}

/** 次の期限。月末の扱いは予定の繰り返しと同じで、無い日は月末に寄せる。 */
function nextDue(due: string, repeat: string): string | null {
  const d = new Date(`${due}T00:00:00`);
  if (repeat === "毎日") d.setDate(d.getDate() + 1);
  else if (repeat === "毎週") d.setDate(d.getDate() + 7);
  else if (repeat === "毎月") {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  } else return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
