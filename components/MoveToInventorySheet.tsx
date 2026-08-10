"use client";

import { useState } from "react";
import { addMany } from "@/lib/inventory-store";
import { todayISO } from "@/lib/dates";
import { removeItem as removeShoppingItem } from "@/lib/store";
import { guessSection } from "@/lib/matching";
import { LOCATIONS, LOCATION_INFO, type Location, type ShoppingItem } from "@/lib/types";

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

type Row = {
  source: ShoppingItem;
  location: Location;
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
   * 以前は押すたびに次の区画へ回すボタンだった。3区分のときは最大2回で
   * 目的の区画に着いたが、5区画になると最大4回押すことになり、
   * しかも押しすぎると通り過ぎてもう一周する。買った物が10点あれば効く差なので、
   * 一覧から直接選ぶ形(select)に変えた。端末側の選択画面が出るので、
   * 1タップで5つとも見えて、押し間違えても選び直せる。
   */
  const setLocation = (id: string, location: Location) =>
    setRows((prev) =>
      prev.map((r) => (String(r.source.id) === id ? { ...r, location } : r)),
    );

  const submit = async () => {
    setBusy(true);
    const today = todayISO();
    await addMany(
      rows.map((r) => ({
        name: r.source.item,
        qty: r.qty,
        unit: r.unit,
        location: r.location,
        bought_on: today,
      })),
    );
    // 買い終わった品目はリストから消す。次の買い物で使い回せるようにするため。
    for (const r of rows) await removeShoppingItem(r.source.id);
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="text-base font-bold">買った分を在庫に入れる</h2>
        <p className="mt-1 text-xs text-neutral-500">
          置き場所は売り場から推測しています。違うものは右の欄で選び直してください。
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
            <li key={String(r.source.id)} className="flex items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                {r.source.item}
              </span>
              <span className="shrink-0 text-xs text-neutral-500">
                {r.qty}
                {r.unit ?? ""}
              </span>
              {/*
               * 見た目は今までのチップのまま(appearance-none で端末の三角を消す)。
               * 幅 4.5rem は 2 文字ぶん + 余白で、5 区画のどれを選んでも変わらない。
               * 高さは 44px。濡れた指で隣の行を触らないための下限。
               */}
              <select
                aria-label={`${r.source.item}の置き場所`}
                value={r.location}
                onChange={(e) => setLocation(String(r.source.id), e.target.value as Location)}
                className="h-11 w-[4.5rem] shrink-0 appearance-none rounded-lg bg-neutral-100 text-center text-xs font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              >
                {LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
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

        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          登録すると、この {rows.length} 件は買い物リストから消えます。
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
            {busy ? "登録中…" : `${rows.length}件を在庫へ`}
          </button>
        </div>
      </div>
    </div>
  );
}
