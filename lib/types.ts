// 買い物リストのドメイン型。schema.sql の shopping_list に対応する。

/** サーバ採番の id は bigint(number)。オフライン中に作った行は一時的に文字列 id を持つ。 */
export type ItemId = number | string;

export type ItemStatus = "未購入" | "購入済";

export type ShoppingItem = {
  id: ItemId;
  household_id: string;
  item: string;
  qty: string | null;
  reason: string | null;
  section: string | null;
  sort_order: number;
  status: ItemStatus;
  checked_by: string | null;
  checked_at: string | null;
  added_at: string;
};

/**
 * 未同期の操作。オフライン中の操作をここに積み、オンライン復帰時に順に流す。
 * at はタップした瞬間の時刻。これが競合解決(チェック済みが勝つ)の判断材料になる。
 */
export type Op =
  | { kind: "check"; id: ItemId; at: string; by: string | null }
  | { kind: "uncheck"; id: ItemId; at: string }
  | { kind: "add"; tempId: string; item: ShoppingItem }
  | { kind: "upsertQty"; id: ItemId; qty: string | null; at: string }
  /** force: 本人が明示的に消した。相手が買っていても消す */
  | { kind: "delete"; id: ItemId; force?: boolean };

export type QueuedOp = Op & { opId: number };

export const isTempId = (id: ItemId): id is string => typeof id === "string";

// ------------------------------------------------------------------ 在庫

export const LOCATIONS = ["冷蔵", "冷凍", "常温"] as const;
export type Location = (typeof LOCATIONS)[number];

export type InventoryItem = {
  id: ItemId;
  household_id: string;
  name: string;
  qty: number | null;
  unit: string | null;
  location: Location;
  expiry: string | null;
  bought_on: string | null;
  price: number | null;
  updated_at: string;
};

/** 在庫の未送信操作。数量は「最後に押した値が正」でよいので上書き方式にする。 */
export type InvOp =
  | { kind: "upsert"; id: ItemId; patch: Partial<InventoryItem>; at: string }
  | { kind: "add"; tempId: string; item: InventoryItem }
  /** force: 本人が明示的に消した。相手が買っていても消す */
  | { kind: "delete"; id: ItemId; force?: boolean };

export type QueuedInvOp = InvOp & { opId: number };

// ------------------------------------------------- レシピ・献立・調理記録

export type Recipe = {
  id: number;
  household_id: string;
  name: string;
  category: string | null;
  protein: string | null;
  time_min: number | null;
  freezable: boolean;
  freeze_notes: string | null;
  card_md: string | null;
  source: string | null;
  tags: string | null;
  created_at: string;
};

export type RecipeIngredient = {
  id: number;
  recipe_id: number;
  name: string;
  qty: number | null;
  unit: string | null;
  optional: boolean;
};

export type MealPlan = {
  id: number;
  household_id: string;
  date: string;
  slot: string;
  recipe_id: number | null;
  name: string | null;
  status: "予定" | "実施" | "中止";
};

export type CookLog = {
  id: number;
  household_id: string;
  date: string;
  recipe_id: number | null;
  name: string | null;
  batch: boolean;
  rating: number | null;
  memo: string | null;
  created_at: string;
};

// ---------------------------------------------------------------- 家計簿

export type Transaction = {
  id: number;
  household_id: string;
  date: string;
  amount: number;
  merchant_raw: string;
  merchant_norm: string | null;
  category: string;
  source: string;
  memo: string | null;
  receipt_path: string | null;
  needs_review: boolean;
  imported_at: string;
};

export type Budget = {
  id: number;
  household_id: string;
  category: string;
  amount: number;
  /** null = 毎月の既定。'2026-08' ならその月だけの上書き */
  year_month: string | null;
};

export type Account = {
  id: number;
  household_id: string;
  name: string;
  kind: "資産" | "負債";
  category: string | null;
  memo: string | null;
  sort_order: number;
  active: boolean;
};

export type Balance = {
  id: number;
  household_id: string;
  account_id: number;
  year_month: string;
  amount: number;
};

export type Income = {
  id: number;
  household_id: string;
  date: string;
  amount: number;
  source: string;
  category: string | null;
  memo: string | null;
};

// ------------------------------------------------------------ 予定・家事

export type CalendarEvent = {
  id: number;
  household_id: string;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  title: string;
  memo: string | null;
  /** null = 2人の共有予定 / user_id = その人の個人予定 */
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  /**
   * 旧・色分け用の文字列。schema_v5 でタグに移した。
   * 今は tag_id が正で、これは公開タグ名の写し(非公開タグのときは null)。
   * タグを消したあとの表示のために残してある。
   */
  label: string | null;
  /** なし / 毎週 / 隔週 / 毎月 / 毎年。展開は表示側で行う */
  repeat: string | null;
  repeat_until: string | null;

  /** calendar_tags.id。色と、非公開かどうかはここから決まる */
  tag_id: number | null;
  location: string | null;
  url: string | null;
  /** 持ち物メモ。改行区切りのただの文字列 */
  items: string | null;
  /** 通知を何分前に出すか。null = 通知しない */
  notify_min: number | null;
  /**
   * 誰の秘密か。null = 2人とも見える。
   *
   * 【アプリからは絶対に書かない】。DB のトリガがタグの設定から決める。
   * ここに書き込もうとしても上書きされる。読むだけの列。
   */
  private_owner_id: string | null;
};

export type CalendarTag = {
  id: number;
  household_id: string;
  name: string;
  /** lib/tags.ts の TAG_COLORS のキー。'violet' など */
  color: string;
  /** true = このタグを付けた予定は owner_id 本人しか見られない */
  private: boolean;
  owner_id: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
};

export type EventComment = {
  id: number;
  household_id: string;
  event_id: number;
  user_id: string | null;
  body: string;
  created_at: string;
};

export type Chore = {
  id: number;
  household_id: string;
  name: string;
  /** 0=日 〜 6=土 */
  weekdays: number[];
  monthday: number | null;
  assignee_id: string | null;
  memo: string | null;
  active: boolean;
  sort_order: number;
};

export type ChoreLog = {
  id: number;
  household_id: string;
  chore_id: number;
  date: string;
  done_by: string | null;
  done_at: string;
};

/** 支出の費目。予算と突き合わせるため、アプリ側でも一覧を持っておく。 */
export const EXPENSE_CATEGORIES = [
  "食費",
  "日用品",
  "外食",
  "交通・車",
  "住居",
  "光熱・通信",
  "医療",
  "娯楽",
  "衣類",
  "その他",
] as const;

// ------------------------------------------------ 手元の家計簿から吸収

export type AssetDetail = {
  id: number;
  household_id: string;
  /** 親の資産名(accounts.name に対応) */
  item: string;
  sub_item: string;
  amount: number;
  as_of: string | null;
  note: string | null;
};

export type Holding = {
  id: number;
  household_id: string;
  as_of: string;
  kind: string;
  account: string;
  code: string | null;
  name: string;
  quantity: number | null;
  acq_price: number | null;
  cur_price: number | null;
  acq_amount: number | null;
  value: number | null;
  pnl: number | null;
  accumulating: boolean;
};

export type WatchItem = {
  id: number;
  household_id: string;
  code: string;
  name: string;
  market: string | null;
  memo: string | null;
  added_at: string;
};

export type WatchHistory = {
  id: number;
  household_id: string;
  code: string;
  as_of: string;
  price: number | null;
  per: number | null;
  pbr: number | null;
  div_yield: number | null;
  dividend: number | null;
  year_high: number | null;
  year_low: number | null;
  note: string | null;
};

export type LoanSchedule = {
  id: number;
  household_id: string;
  year_month: string;
  balance: number;
  /** 実績 / 見込 */
  kind: string;
  note: string | null;
};

export type SalaryRow = {
  id: number;
  household_id: string;
  age: number;
  grade_no: number | null;
  monthly_salary: number;
  bonus_summer: number;
  bonus_winter: number;
  retire_rate_self: number | null;
  retire_rate_teinen: number | null;
  retire_rate_komu: number | null;
  note: string | null;
};

export type Todo = {
  id: number;
  household_id: string;
  title: string;
  detail: string | null;
  status: "open" | "done";
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  done_at: string | null;
  done_by: string | null;

  /** 親のやること。null = 一番上の階層。入れ子は1段まで */
  parent_id: number | null;
  /** なし / 毎日 / 毎週 / 毎月。完了にすると次の期限で作り直す */
  repeat: string | null;
  repeat_until: string | null;
  sort_order: number;
};
