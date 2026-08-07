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
