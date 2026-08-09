import type { ShoppingItem } from "./types";

/** 02_seed.sql と同じ世帯 id。ローカルモードでもデータ形を揃えておく。 */
export const LOCAL_HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";

type SeedRow = Pick<ShoppingItem, "item" | "qty" | "reason" | "section" | "sort_order">;

/**
 * Supabase 未設定のときだけ使う初期データ。02_seed.sql の shopping_list と同じ 6 件。
 * 接続後はサーバ側が唯一の正になるので、これは使われない。
 */
const SEED_ROWS: SeedRow[] = [
  {
    item: "鶏むね肉",
    qty: "安ければ",
    reason: "セール枠→唐揚げを差し替え or 冷凍ストック",
    section: "セール枠",
    sort_order: 10,
  },
  {
    item: "豚こま",
    qty: "安ければ",
    reason: "セール枠→冷凍ストック",
    section: "セール枠",
    sort_order: 20,
  },
  {
    item: "オクラ・ピーマン等の夏野菜",
    qty: "安ければ",
    reason: "セール枠→副菜追加",
    section: "セール枠",
    sort_order: 30,
  },
  {
    item: "ミックスナッツ(素焼き)",
    qty: "1袋",
    reason: "妻の増量サポート補食(任意)。バナナの代替",
    section: "加工品・その他",
    sort_order: 40,
  },
  {
    item: "絹豆腐",
    qty: "1丁",
    reason: "冷奴の分が不足(麻婆で1丁使うため)",
    section: "乳製品・卵・豆腐",
    sort_order: 50,
  },
  {
    item: "ドレッシング",
    qty: "1本",
    reason: "サラダ用。ノンオイルより普通のオイル入りが増量方針に合う",
    section: "調味料",
    sort_order: 60,
  },
];

export function localSeedItems(now: string): ShoppingItem[] {
  return SEED_ROWS.map((row, i) => ({
    ...row,
    id: `seed_${i + 1}`,
    household_id: LOCAL_HOUSEHOLD_ID,
    status: "未購入" as const,
    checked_by: null,
    checked_at: null,
    added_at: now,
  }));
}
