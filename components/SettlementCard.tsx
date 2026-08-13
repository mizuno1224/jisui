"use client";

import { useMemo } from "react";
import { yen } from "@/lib/dates";
import type { Transaction } from "@/lib/types";

/**
 * 月末に「いくらどこへ移すか」を出す。
 *
 * 【前提】生活費とローンは夫婦で折半(方針.md)。
 * 共用の支出は共用プール(住信SBI)から出し、そこへ2人が半分ずつ入れる。
 *
 * 【2段階で考える】
 *   ① 共用プールへ    … 共用の支出の合計を、2人で半分ずつ入れる
 *   ② 共用プールから  … 立て替えたカードの引落口座へ、立て替えた額を戻す
 * ここを1つにまとめると、折半と立替の精算が混ざって向きを間違える。
 *
 * 【立替は折半しない】
 * ②で半分だけ戻すと、折半を2回することになる。折半は①で済んでいる。
 *
 * 【未分類があるうちは金額を出さない】
 * 共用か個人かが決まっていない支出が抜け落ちたまま計算すると、
 * 正しく見える間違った額ができる。それを信じて送金してしまう。
 * 足りないと言うほうがよい。
 */
export function SettlementCard({
  rows,
  month,
  onFixUnclassified,
}: {
  rows: Transaction[];
  month: string;
  onFixUnclassified: () => void;
}) {
  const m = useMemo(() => {
    const inMonth = rows.filter((t) => t.date.startsWith(month));
    const sum = (payer: "夫" | "妻", share: string) =>
      inMonth
        .filter((t) => t.payer === payer && t.share === share)
        .reduce((n, t) => n + t.amount, 0);

    const husbandShared = sum("夫", "夫婦");
    const wifeShared = sum("妻", "夫婦");
    return {
      未分類: inMonth.filter((t) => t.share === "未分類").length,
      共用合計: husbandShared + wifeShared,
      夫が立替えた共用: husbandShared,
      妻が立替えた共用: wifeShared,
      夫のカードで妻のぶん: sum("夫", "妻"),
      妻のカードで夫のぶん: sum("妻", "夫"),
    };
  }, [rows, month]);

  const half = Math.round(m.共用合計 / 2);
  // 相手のカードで買った個人のぶん。プラスなら妻から夫へ。
  const wifeToHusband = m.夫のカードで妻のぶん - m.妻のカードで夫のぶん;

  if (m.未分類 > 0) {
    return (
      <section className="mx-4 mt-4 rounded-2xl bg-white p-4 dark:bg-neutral-900">
        <h2 className="text-sm font-bold">月末に移すお金</h2>
        <button
          type="button"
          onClick={onFixUnclassified}
          className="mt-3 w-full rounded-xl bg-amber-50 px-3 py-3 text-left dark:bg-amber-950/40"
        >
          <span className="block text-sm font-bold text-amber-900 dark:text-amber-200">
            まだ出せません
          </span>
          <span className="mt-0.5 block text-xs text-amber-800/80 dark:text-amber-300/80">
            この月に、誰のぶんか決めていない支出が {m.未分類} 件あります。
            決めてから計算します(押すと振り分けます)。
          </span>
        </button>
      </section>
    );
  }

  const Line = ({
    label,
    amount,
    note,
  }: {
    label: string;
    amount: number;
    note?: string;
  }) => (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {note && <p className="mt-0.5 text-[11px] text-neutral-500">{note}</p>}
      </div>
      <p className="shrink-0 text-lg font-bold tabular-nums">{yen(amount)}</p>
    </div>
  );

  return (
    <section className="mx-4 mt-4 rounded-2xl bg-white p-4 dark:bg-neutral-900">
      <h2 className="text-sm font-bold">月末に移すお金</h2>

      {/* ① まず共用プールを満たす */}
      <div className="mt-3 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800">
        <p className="text-xs font-bold text-neutral-500">① 住信SBI(共用プール)へ入れる</p>
        <Line
          label="共用の支出 合計"
          amount={m.共用合計}
          note="この月に「夫婦」に振り分けたぶん"
        />
        <div className="border-t border-neutral-200 dark:border-neutral-700" />
        <Line label="夫が入れる" amount={half} note="折半なので半分" />
        <Line label="妻が入れる" amount={m.共用合計 - half} note="折半なので半分" />
      </div>

      {/* ② 立て替えたぶんを戻す */}
      <div className="mt-3 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800">
        <p className="text-xs font-bold text-neutral-500">② 住信SBI から、立て替えた口座へ戻す</p>
        {m.夫が立替えた共用 > 0 && (
          <Line
            label="→ 夫の楽天銀行"
            amount={m.夫が立替えた共用}
            note="夫のカードで払った夫婦のぶん(引落に必要な額)"
          />
        )}
        {m.妻が立替えた共用 > 0 && (
          <Line
            label="→ 妻の楽天銀行"
            amount={m.妻が立替えた共用}
            note="妻のカードで払った夫婦のぶん"
          />
        )}
        {m.夫が立替えた共用 === 0 && m.妻が立替えた共用 === 0 && (
          <p className="py-2 text-sm text-neutral-500">戻すぶんはありません。</p>
        )}
        <p className="mt-1 text-[11px] text-neutral-500">
          ここは<strong>折半しません</strong>。半分だけ戻すと、①と合わせて折半が2回になります
        </p>
      </div>

      {/* ③ 個人のぶんの貸し借り */}
      {wifeToHusband !== 0 && (
        <div className="mt-3 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800">
          <p className="text-xs font-bold text-neutral-500">③ 個人のぶんの貸し借り</p>
          <Line
            label={wifeToHusband > 0 ? "妻 → 夫" : "夫 → 妻"}
            amount={Math.abs(wifeToHusband)}
            note={[
              m.夫のカードで妻のぶん > 0 ? `夫のカードで妻のぶん ${yen(m.夫のカードで妻のぶん)}` : "",
              m.妻のカードで夫のぶん > 0 ? `妻のカードで夫のぶん ${yen(m.妻のカードで夫のぶん)}` : "",
            ]
              .filter(Boolean)
              .join(" / ")}
          />
        </div>
      )}

      {m.共用合計 === 0 && wifeToHusband === 0 && (
        <p className="mt-3 text-sm text-neutral-500">この月に移すお金はありません。</p>
      )}
    </section>
  );
}
