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
  | { kind: "delete"; id: ItemId };

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
  | { kind: "delete"; id: ItemId };

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
