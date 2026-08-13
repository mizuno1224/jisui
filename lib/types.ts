// 買い物リストのドメイン型。01_schema.sql の shopping_list に対応する。

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

/**
 * 在庫の置き場所。並び順は【冷蔵庫の上から下】で、在庫画面のタブもこの順に出る。
 *
 * 【この5つの文字列は supabase/12a_schema_v6_constraint.sql:216 の
 *   check (location in ('冷蔵','氷温','野菜','冷凍','常温'))
 *   と 1 文字も違わず同じでなければならない】
 *   lib/inventory-store.ts:189 は location をそのまま送る。値がずれると
 *   Postgres が 23514(check 制約違反)を返し、lib/inventory-store.ts:156-159 が
 *   それを「サーバに拒否された」と判断してその操作を【黙って1件捨てる】。
 *   画面には何も出ないので、気づけるのは在庫が合わなくなってから。
 *
 * 【この区分は日立 R-HWC54Y という、この家の冷蔵庫1台に固有のものである】
 *   一般的な食品分類ではない。
 *     氷温 … 特鮮氷温ルーム(約 -2〜0℃)。冷蔵室の中にある独立した引き出し
 *     野菜 … 新鮮スリープ野菜室(約 4〜8℃・高湿度)
 *   この機種の冷蔵室の棚は約 0〜3℃ しかなく、きゅうりのような野菜を入れると
 *   低温障害を起こす。だから「野菜」を冷蔵と分けて持つ必要がある。
 *   なぜこの5つなのか、なぜ冷凍を上段/下段に割らなかったのかは
 *   supabase/12a_schema_v6_constraint.sql:26-96 に全部書いてある。
 *
 * 【冷蔵庫を買い替えたら、この区分は意味を失う。そのとき直す場所は5つ】
 *   1. supabase/12a_schema_v6_constraint.sql:398-453「元に戻す手順」を先に流す。
 *      DB の check を戻し、無くなる区画の行を残る区画へ寄せる。
 *      ★ アプリを先に出すと、まだ '氷温' が入っている行を保存し直した瞬間に
 *        23514 で弾かれ、上に書いた「黙って捨てる」が起きる。必ず DB が先。
 *   2. この LOCATIONS と、すぐ下の LOCATION_INFO を新しい冷蔵庫の区画に直す
 *      (型 Location はここから自動で決まるので、書き換えるのはこの2つだけ)
 *   3. components/MoveToInventorySheet.tsx の guessLocation。
 *      売り場→区画の対応表。無くなった区画を返したままだと保存が落ちる
 *   4. lib/help-content.ts の「## 台所で」にある区画の表
 *   5. public/sw.js の VERSION を1つ上げる。
 *      上げないと古い端末に古い画面(古いタブ)が残り続ける
 */
export const LOCATIONS = ["冷蔵", "氷温", "野菜", "冷凍", "常温"] as const;
export type Location = (typeof LOCATIONS)[number];

/**
 * 区画の正式な呼び名と、その場所の説明。
 *
 * データベースとタブに入れる名前は 2 文字に切り詰めてある(幅 390px の画面で
 * 5 分割しても折り返さないため。理由は 12a_schema_v6_constraint.sql:79-87)。
 * ただし「氷温」「野菜」の 2 文字だけでは、冷蔵庫のどの引き出しの話なのかも、
 * 何を入れてよいのかも分からない。それを画面に添えるための対応表。
 * ここは表示専用で、DB には短い方(LOCATIONS の値)しか入れない。
 */
export const LOCATION_INFO: Record<Location, { full: string; note: string }> = {
  冷蔵: { full: "冷蔵室の棚", note: "約0〜3℃・乳製品・卵・豆腐・惣菜・カットした野菜" },
  // 乳製品・豆腐・こんにゃく・ゆで卵・カット野菜は凍ってスが入る(取説 p.24)
  氷温: { full: "特鮮氷温ルーム", note: "約-2〜0℃・肉と魚。乳製品と豆腐は入れない" },
  野菜: { full: "新鮮スリープ野菜室", note: "約4〜8℃・葉物と根菜。乾燥しにくい" },
  冷凍: { full: "冷凍室", note: "約-20〜-17℃・上段と下段は分けていない" },
  常温: { full: "冷暗所", note: "玉ねぎ・いも類・未開封の調味料・乾物" },
};

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
  /**
   * 誰のぶんの支出か。
   *
   * 取り込んだ時点では分からないので「未分類」で入る。
   * ここを勝手に「夫婦」にすると、個人の買い物が家計に混ざったまま
   * 気づけない。分からないものは分からないままにして、人が決める。
   */
  share: "夫婦" | "夫" | "妻" | "未分類";
  /**
   * 人が「これは二重計上ではない(別々の買い物)」と確かめた印。
   * 一度決めた組を毎回聞き直さないために持つ。
   */
  dup_ok: boolean;
  /**
   * どちらの口座から出たか。share(誰のための支出か)とは別物。
   * 精算の向きを決めるのに要る。
   */
  payer: "夫" | "妻";
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

// ------------------------------------------------ 献立を考えるときの前提

/** 調理器具。01_schema.sql の equipment に対応する。 */
export type Equipment = {
  id: number;
  household_id: string;
  name: string;
  memo: string | null;
};

/** 常備品。ここにあるものは買い物リストに載せない決まり。 */
export type Pantry = {
  id: number;
  household_id: string;
  name: string;
  category: string | null;
  stock: "ある" | "切れそう" | "切れた";
  /** お決まり食材(毎回チェックする定番) */
  staple: boolean;
  memo: string | null;
};

/** 好み・方針。kind が「苦手」のものは絶対に使わない。 */
export type Preference = {
  id: number;
  household_id: string;
  kind: "苦手" | "好き" | "方針";
  item: string;
  memo: string | null;
  added_at: string;
};
