"use client";

import { useMemo, useState } from "react";
import { addMany } from "@/lib/inventory-store";
import { todayISO } from "@/lib/dates";
import { removeItem as removeShoppingItem } from "@/lib/store";
import { countUnits } from "@/lib/food-count";
import { guessSection, looseMatch } from "@/lib/matching";
import { useTable } from "@/lib/use-table";
import {
  LOCATIONS,
  LOCATION_INFO,
  type Location,
  type RecipeIngredient,
  type ShoppingItem,
} from "@/lib/types";

/**
 * 野菜売り場で買っても、冷蔵庫に入れずに冷暗所へ置くもの。
 * 12_schema_v6.sql:64-66 と取説 p.31(常温保存がおすすめの野菜)による。
 * 玉ねぎに悪いのは低温より高湿度で、野菜室は高湿度に作ってあるため、
 * 野菜室はむしろ一番勧めにくい置き場所になる。
 * かなと漢字の両方を並べているのは、買い物リストの品名が手書きだから。
 */
const ROOM_TEMP_VEGETABLES =
  /玉ねぎ|たまねぎ|玉葱|オニオン|じゃがいも|ジャガイモ|じゃが芋|馬鈴薯|さつまいも|さつま芋|薩摩芋|かぼちゃ|カボチャ|南瓜/;

/**
 * 切ってある野菜。切り口から傷むので、野菜室(4〜8℃)より冷蔵室(0〜3℃)。
 * 氷温ルームには入れられない(凍って風味が落ちる。取説 p.24)。
 * 12_schema_v6.sql:318-320 でキャベツ(カット)を冷蔵に据え置いたのと同じ判断。
 */
const CUT_VEGETABLE = /カット|きざみ|刻み|千切り|スライス/;

/**
 * 買った物を置く場所を推測する。外れていても右のボタンで選び直せる。
 *
 * 【3区分の頃との一番の違い: 野菜を「冷蔵」に落としてはいけない】
 *   この冷蔵庫(日立 R-HWC54Y)の冷蔵室は約 0〜3℃ しかない。
 *   きゅうりのような野菜をそこへ入れると低温障害(表面の凹み)が出る。
 *   野菜室は約 4〜8℃ + 高湿度で、野菜はそちらが正しい。
 *   以前のこの関数は「冷凍でも調味料でもなければ冷蔵」だったので、
 *   野菜も肉も魚も全部 0〜3℃ の棚に入れる案内をしていた。
 *
 * 迷ったときの落とし先を '冷蔵' にしているのは、そこが一番害の小さい
 * 温度帯で、在庫画面で最初に開くタブでもあるから(見失いにくい)。
 */
function guessLocation(source: ShoppingItem): Location {
  const { item, section, reason } = source;

  // 「冷凍うどん」のように品名が冷凍食品だと言っている場合は、売り場より品名が強い。
  // (冷凍うどんは売り場としては加工品に入れられることがあり、それだと常温になる)
  if (/冷凍/.test(item)) return "冷凍";

  // セール枠と要確認は「どの棚で買ったか」を表していないので、売り場として使えない。
  // 品名から売り場を引き直す(lib/matching.ts の SECTION_HINTS)。
  // 例: セール枠の「豚こま」→ 肉・魚 → 氷温。ここを飛ばすと全部 冷蔵 に落ちる。
  const shelf =
    section && section !== "セール枠" && section !== "要確認"
      ? section
      : guessSection(item);

  if (shelf === "冷凍") return "冷凍";

  // この家では、セール枠で買った肉と野菜はその日のうちに冷凍している。
  // 買い物リストの理由欄にそう書いてある(lib/seed-data.ts:16「セール枠→冷凍ストック」)。
  // 理由欄は人とチャットが書く自由文なので当てにしすぎないが、
  // 「冷凍」とまで書いてあるものを氷温や野菜室へ案内するのはさすがに外れている。
  if (reason && /冷凍/.test(reason)) return "冷凍";

  // 未開封の調味料・乾物・缶詰。開封後に冷蔵へ移すかどうかは人が決める。
  if (shelf === "調味料" || shelf === "加工品・その他") return "常温";

  // 氷温ルームは「買ってきた肉・魚を凍らせずに置く」ための引き出し(取説 p.19)。
  // 加熱調理用で7日、生食用で3日が日立の目安で、冷蔵室に置くより明確に長持ちする。
  // 外したときの被害もこの向きが小さい。氷温の物を冷凍と記録しても混乱するだけだが、
  // 冷凍の物を氷温(=数日で食べる場所)と記録すると、食べ切りを急ぐ判断を誤らせる。
  if (shelf === "肉・魚") return "氷温";

  // 乳製品・卵・豆腐は氷温に入れてはいけない。凍ってスが入る(取説 p.24)。
  if (shelf === "乳製品・卵・豆腐") return "冷蔵";

  if (shelf === "野菜") {
    // 【切ってあるかを先に見る】常温に置けるのは丸ごとのときだけ。
    // 逆順にすると「かぼちゃ(カット)」が常温になり、切り口から傷む。
    if (CUT_VEGETABLE.test(item)) return "冷蔵";
    if (ROOM_TEMP_VEGETABLES.test(item)) return "常温";
    return "野菜";
  }

  return "冷蔵";
}

/** 「1丁」「2枚」→ 数量と単位に分ける。「安ければ」のような文言は1個として扱う。 */
function parseQty(qty: string | null): { qty: number; unit: string | null } {
  if (!qty) return { qty: 1, unit: null };
  const m = qty.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
  if (!m) return { qty: 1, unit: null };
  return { qty: Number(m[1]), unit: m[2].trim() || null };
}

/**
 * 在庫に入れないもの。惣菜・弁当・日用品・その場で食べたもの。
 *
 * 【これが無いと、片付ける道が「全部を在庫に入れる」しか無かった】
 * からあげ弁当やトイレットペーパーを在庫表に入れたい人はいない。
 * かといってチェックを外すわけにもいかず、結局リストに残り続けていた。
 * 残った行は「まだ買っていないもの」として数えられるので、
 * 常備品の切らし判定(lib/staples.ts)まで巻き添えで狂う。
 */
const SKIP = "入れない";

type Row = {
  source: ShoppingItem;
  /** 置き場所。SKIP なら在庫に入れず、リストから消すだけ */
  location: Location | typeof SKIP;
  qty: number;
  unit: string | null;
};

export function MoveToInventorySheet({
  checked,
  onClose,
}: {
  checked: ShoppingItem[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    checked.map((item) => ({
      source: item,
      location: guessLocation(item),
      ...parseQty(item.qty),
    })),
  );
  const [busy, setBusy] = useState(false);

  /*
   * どの食材を「個数で数えるか」は、レシピの書き方から決まる(lib/food-count.ts)。
   * 買い物リストの品名から食材を引けないので、名前で当てる簡易版にしてある
   * (この画面は買った直後の一度きりなので、外れても次の画面で直せる)。
   */
  const ingredients = useTable<RecipeIngredient>("recipe_ingredients");
  const units = useMemo(() => countUnits(ingredients.rows), [ingredients.rows]);
  const nameOfFood = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of ingredients.rows) {
      if (i.food_id != null && units.has(i.food_id)) m.set(i.name, units.get(i.food_id)!);
    }
    return m;
  }, [ingredients.rows, units]);
  /** その品目を数えるなら単位、数えないなら null */
  const countUnit = (item: ShoppingItem): string | null => {
    for (const [name, unit] of nameOfFood) {
      if (looseMatch(name, item.item)) return unit;
    }
    return null;
  };

  /*
   * 以前は押すたびに次の区画へ回すボタンだった。3区分のときは最大2回で
   * 目的の区画に着いたが、5区画になると最大4回押すことになり、
   * しかも押しすぎると通り過ぎてもう一周する。買った物が10点あれば効く差なので、
   * 一覧から直接選ぶ形(select)に変えた。端末側の選択画面が出るので、
   * 1タップで5つとも見えて、押し間違えても選び直せる。
   */
  const setLocation = (id: string, location: Location | typeof SKIP) =>
    setRows((prev) =>
      prev.map((r) => (String(r.source.id) === id ? { ...r, location } : r)),
    );

  /** 袋を開けて数えた数。空欄や文字は0として扱う(在庫は0でも記録できる) */
  const setQty = (id: string, value: string) =>
    setRows((prev) =>
      prev.map((r) =>
        String(r.source.id) === id
          ? { ...r, qty: Number.isNaN(Number(value)) ? r.qty : Math.max(0, Number(value)) }
          : r,
      ),
    );

  const toStock = rows.filter((r) => r.location !== SKIP);

  const submit = async () => {
    setBusy(true);
    const today = todayISO();
    if (toStock.length > 0) {
      await addMany(
        toStock.map((r) => ({
          name: r.source.item,
          qty: r.qty,
          // 単位はレシピが使っているものに揃える(「本」「個」)。
          // 揃っていないと在庫画面の「4 / 6本」が別の言葉で出る
          unit: countUnit(r.source) ?? r.unit,
          location: r.location as Location,
          bought_on: today,
        })),
      );
    }
    /*
     * 【在庫に入れなかったものも、リストからは消す】
     * この画面の目的は「買い終えたものを片付ける」ことで、
     * 在庫に入れるかどうかは、そのうちの一部の話でしかない。
     */
    for (const r of rows) await removeShoppingItem(r.source.id);
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="text-base font-bold">買い物をおわる</h2>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          チェックした {rows.length} 件をリストから片付けます。
          しまうものは置き場所を選ぶと在庫に入り、
          惣菜や日用品は<b>「入れない」</b>を選べば消えるだけです。
        </p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          <b>袋の中身の数は、ここで入れてください。</b>
          買い物リストの「なす 3本」は買う前の見込みなので、
          袋を開けて2本なら <b>2</b> に直します。
          入れた数がそのまま<b>満タンの数</b>になり、在庫画面のスライダーで減らせます。
        </p>
        {/*
         * 推測の癖を先に言っておく。ここに書いていないと
         * 「なぜ肉が氷温になっているのか」が分からず、毎回全部を疑うことになる。
         */}
        <p className="mt-1 text-xs text-neutral-500">
          肉と魚は氷温ルーム、野菜は野菜室に置く前提で出しています。
          そのまま凍らせるものは「冷凍」に変えてください。
        </p>

        <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
          {rows.map((r) => (
            <li key={String(r.source.id)} className="py-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                  {r.source.item}
                </span>
                {/*
                 * 見た目は今までのチップのまま(appearance-none で端末の三角を消す)。
                 * 高さは 44px。濡れた指で隣の行を触らないための下限。
                 */}
                <select
                  aria-label={`${r.source.item}の置き場所`}
                  value={r.location}
                  onChange={(e) =>
                    setLocation(String(r.source.id), e.target.value as Location | typeof SKIP)
                  }
                  className={`h-11 w-[5.5rem] shrink-0 appearance-none rounded-lg text-center text-xs font-bold ${
                    r.location === SKIP
                      ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
                      : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                  }`}
                >
                  {LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                  <option value={SKIP}>{SKIP}</option>
                </select>
              </div>

              {/*
               * 【個数を聞くのは、レシピが数える食材だけ】
               *
               * なす「3本」ピーマン「4個」たまご「10個」は、残りの本数が
               * 献立に効く。**小松菜「1袋」しめじ「1袋」は使い切りなので、
               * 葉が何枚あるかを数えても意味がない。**
               * 全部に聞くと、意味の無い入力を毎回させることになる。
               * どちらかは lib/food-count.ts がレシピの単位から決める。
               */}
              {r.location !== SKIP && (countUnit(r.source) ? (
                <div className="mt-1.5 flex items-center gap-2 pl-1">
                  <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
                    袋の中身
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={r.qty}
                    onChange={(e) => setQty(String(r.source.id), e.target.value)}
                    aria-label={`${r.source.item}の個数`}
                    className="h-11 w-16 rounded-lg border border-neutral-300 bg-white px-2 text-center text-sm dark:border-neutral-700 dark:bg-neutral-800"
                  />
                  <span className="shrink-0 text-sm font-semibold">{countUnit(r.source)}</span>
                  <span className="min-w-0 flex-1 text-[11px] leading-tight text-neutral-400 dark:text-neutral-500">
                    袋を開けて数えた数
                  </span>
                </div>
              ) : (
                <p className="mt-1 pl-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                  1袋まるごとで記録します(使い切る食材なので個数は数えません)
                </p>
              ))}
            </li>
          ))}
        </ul>

        {/* どの2文字がどの引き出しなのかを、この画面の中で引けるようにしておく */}
        <ul className="mt-3 space-y-0.5 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
          {LOCATIONS.map((loc) => (
            <li key={loc}>
              <span className="font-bold text-neutral-700 dark:text-neutral-200">{loc}</span>{" "}
              {LOCATION_INFO[loc].full}・{LOCATION_INFO[loc].note}
            </li>
          ))}
        </ul>

        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          この {rows.length} 件は買い物リストから消えます。
          {toStock.length > 0 && <>そのうち {toStock.length} 件が在庫に入ります。</>}
          {toStock.length < rows.length && (
            <>残り {rows.length - toStock.length} 件は在庫に入れず、消えるだけです。</>
          )}
        </p>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-14 flex-1 rounded-xl bg-neutral-100 text-base font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            やめる
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || rows.length === 0}
            className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            {busy ? "片付け中…" : `${rows.length}件を片付ける`}
          </button>
        </div>
      </div>
    </div>
  );
}
