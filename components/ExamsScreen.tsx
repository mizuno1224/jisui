"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { formatDate, todayISO } from "@/lib/dates";
import {
  CHECKUP_NOTE,
  RESULT_STYLE,
  byNewest,
  checkupLabel,
  formatDelta,
  formatRef,
  formatValue,
  hasRef,
  itemRank,
  resultState,
  shortLabel,
  type Checkup,
  type CheckupResult,
} from "@/lib/checkup";
import { MEMBERS, ageOn, type HealthProfile, type Member } from "@/lib/health";
import { useTable } from "@/lib/use-table";

/**
 * 健康診断。
 *
 * 【検診(/health/checkups)とは別の画面である】
 *   検診・予防接種 … これから【いつ受けるか】。期限を出すのが仕事
 *   健康診断(ここ) … すでに【受けた結果】。紙で来た検査票の中身
 * 同じ画面に混ぜると、「次の大腸がん検診は2034年」と「今年のLDLは109」が
 * 並ぶことになる。時間の向きが逆のものは分ける。
 *
 * 【この画面は読むためのもの】
 * 検査票の項目は1回で15〜40ある。スマホのフォームで打つものではないので、
 * 入力は受け渡し JSON(op: add_checkup)から入れる。チャットに検査票を読ませて、
 * 出てきた JSON を「チャットから取り込む」画面に貼れば入る。
 *
 * 【推移を主役にする】
 * 1回ぶんの値だけなら紙を見れば足りる。紙で分からないのは
 * 「3年で γ-GTP が 14 → 21 になっている」のような向きのほうで、
 * それは複数年の紙を並べないと見えない。だから上に推移の表を置く。
 *
 * 【色は行が持つ基準からしか付けない】。lib/checkup.ts の頭に理由がある。
 */
export function ExamsScreen() {
  const [member, setMember] = useState<Member>("夫");
  const [openId, setOpenId] = useState<number | null>(null);

  const profiles = useTable<HealthProfile>("health_profile");
  const checkups = useTable<Checkup>("checkup", { orderBy: "date", ascending: false });
  const results = useTable<CheckupResult>("checkup_result");

  const profile = profiles.rows.find((p) => p.member === member);

  /** この人の受診。新しい順。 */
  const mine = useMemo(
    () => checkups.rows.filter((c) => c.member === member).sort(byNewest),
    [checkups.rows, member],
  );

  /** 受診 id → その受診の項目(検査票の順)。 */
  const byCheckup = useMemo(() => {
    const map = new Map<number, CheckupResult[]>();
    for (const r of results.rows) {
      const list = map.get(r.checkup_id);
      if (list) list.push(r);
      else map.set(r.checkup_id, [r]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => itemRank(a.item, a.sort_order) - itemRank(b.item, b.sort_order));
    }
    return map;
  }, [results.rows]);

  /**
   * 推移の表。
   *
   * 【2回以上ある項目だけを出す】。1回しか無い項目は「推移」にならず、
   * 空欄だらけの行が増えて、動いている項目が埋もれる。
   * 1回だけの項目も下の受診カードには必ず出るので、消えるわけではない。
   *
   * 【列は5回まで】。横スクロールできるとはいえ、それ以上は指が疲れるだけで
   * 3年ぶんの向きは5列あれば読める。
   */
  const trend = useMemo(() => {
    const columns = mine.slice(0, 5);
    const seen = new Map<string, { count: number; rank: number }>();
    for (const c of columns) {
      for (const r of byCheckup.get(c.id) ?? []) {
        const hit = seen.get(r.item);
        if (hit) hit.count += 1;
        else seen.set(r.item, { count: 1, rank: itemRank(r.item, r.sort_order) });
      }
    }
    const items = [...seen.entries()]
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => a[1].rank - b[1].rank)
      .map(([item]) => item);

    const rows = items.map((item) => {
      const cells = columns.map((c) => (byCheckup.get(c.id) ?? []).find((r) => r.item === item) ?? null);
      // 基準は【一番新しく書かれていたもの】。機関が変わると基準も変わるため、
      // 古い紙の基準を今の値に当てない。
      const withRef = cells.find((r): r is CheckupResult => r != null && formatRef(r) != null);
      return { item, cells, ref: withRef ? formatRef(withRef) : null };
    });
    return { columns, rows };
  }, [mine, byCheckup]);

  const age = ageOn(profile?.birth_date ?? null, todayISO());

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="健康"
        subtitle="健康診断"
        right={
          <Link
            href="/health"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            もどる
          </Link>
        }
      >
        <div className="mt-2 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
          {MEMBERS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMember(m);
                setOpenId(null);
              }}
              className={`h-10 flex-1 rounded-lg text-sm font-bold ${
                member === m ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
              }`}
            >
              {m}
              {age != null && member === m && (
                <span className="ml-1 text-xs font-normal text-neutral-500">{age}歳</span>
              )}
            </button>
          ))}
        </div>
      </ScreenHeader>

      <LoadNotice
        loading={checkups.loading}
        error={checkups.error}
        empty={false}
        emptyText=""
      />

      <div className="space-y-3 px-4 pt-3">
        {!checkups.loading && mine.length === 0 && (
          <section className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
            <p className="font-bold">{member}の健康診断は、まだ1件も入っていません。</p>
            <p className="mt-2 text-[13px] text-neutral-500 dark:text-neutral-400">
              検査票の項目は1回で15〜40あるので、この画面では打ちません。
              チャットに検査票を読ませて受け渡し JSON(<code>add_checkup</code>)を作り、
              <Link href="/handoff" className="mx-1 font-bold underline">
                チャットから取り込む
              </Link>
              に貼ってください。
            </p>
            <p className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
              表がまだ無いときは <code>supabase/20_checkup.sql</code> を実行してください。
            </p>
          </section>
        )}

        {/* -------------------------------------------------- 推移 */}
        {trend.rows.length > 0 && (
          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="px-4 pt-3.5 text-sm font-bold">推移</h2>
            <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              2回以上測っている項目だけ。新しいほうが左です。横にスクロールできます
            </p>
            {/* 【表だけを横に流す】。ページ全体が横に動くと、縦に読むときに指が滑る */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-[13px]">
                <thead>
                  <tr className="border-y border-neutral-100 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    <th className="sticky left-0 bg-white px-4 py-2 text-left font-medium dark:bg-neutral-900">
                      項目
                    </th>
                    {trend.columns.map((c) => (
                      <th key={c.id} className="px-2 py-2 text-right font-medium tabular-nums">
                        {shortLabel(c)}
                      </th>
                    ))}
                    {/* 基準が印刷されていない項目(体重・血圧)では、ここに単位だけが出る */}
                    <th className="px-3 py-2 text-left font-medium">基準・単位</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.rows.map((row) => (
                    <tr key={row.item} className="border-b border-neutral-100 dark:border-neutral-800">
                      <th className="sticky left-0 bg-white px-4 py-2 text-left font-medium dark:bg-neutral-900">
                        {row.item}
                      </th>
                      {row.cells.map((cell, i) => (
                        <td
                          key={trend.columns[i].id}
                          className={`px-2 py-2 text-right tabular-nums ${
                            cell ? RESULT_STYLE[resultState(cell)].text : "text-neutral-300 dark:text-neutral-600"
                          }`}
                        >
                          {cell ? formatValue(cell) : "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                        {row.ref ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* -------------------------------------------------- 受診ごと */}
        {mine.map((c, i) => {
          const rows = byCheckup.get(c.id) ?? [];
          const out = rows.filter((r) => resultState(r) === "基準から外れている");
          const open = openId === c.id;
          // 1つ前の受診。同じ項目があれば前回比を出す
          const prev = mine[i + 1];
          const prevRows = prev ? (byCheckup.get(prev.id) ?? []) : [];

          return (
            <section
              key={c.id}
              className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : c.id)}
                className="flex w-full items-start gap-2 px-4 py-3.5 text-left active:bg-neutral-50 dark:active:bg-neutral-800"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-[15px] font-bold">{checkupLabel(c)}</span>
                  <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {formatDate(c.date)}
                    {c.place && ` ・ ${c.place}`}
                    {rows.length > 0 && ` ・ ${rows.length} 項目`}
                  </p>
                  <p className="mt-1 text-xs">
                    {rows.length === 0 ? (
                      <span className="text-neutral-400 dark:text-neutral-500">項目の記録はありません</span>
                    ) : out.length === 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        基準が書かれている項目は、すべて基準内
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">
                        基準から外れている項目 {out.length} 件: {out.map((r) => r.item).join("、")}
                      </span>
                    )}
                  </p>
                </div>
                <span className="ml-1 shrink-0 pt-1 text-neutral-300 dark:text-neutral-600">
                  {open ? "▲" : "▼"}
                </span>
              </button>

              {c.overall && (
                <p className="px-4 pb-2 text-xs text-neutral-600 dark:text-neutral-300">
                  総合判定{" "}
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-bold dark:bg-neutral-800">
                    {c.overall}
                  </span>
                </p>
              )}
              {c.finding && (
                <p className="px-4 pb-3 text-xs text-neutral-600 dark:text-neutral-300">{c.finding}</p>
              )}

              {open && rows.length > 0 && (
                <ul className="border-t border-neutral-100 dark:border-neutral-800">
                  {rows.map((r) => {
                    const state = resultState(r);
                    const delta = formatDelta(
                      r.value_num,
                      prevRows.find((p) => p.item === r.item)?.value_num ?? null,
                    );
                    return (
                      <li
                        key={r.id}
                        className="flex items-baseline gap-2 border-b border-neutral-100 px-4 py-2.5 last:border-b-0 dark:border-neutral-800"
                      >
                        <span className="w-28 shrink-0 text-[13px]">{r.item}</span>
                        <span className={`text-[15px] font-bold tabular-nums ${RESULT_STYLE[state].text}`}>
                          {formatValue(r)}
                        </span>
                        {r.unit && r.value_num != null && (
                          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{r.unit}</span>
                        )}
                        <span className="ml-auto shrink-0 text-right">
                          {/* 単位しか無い行に「基準 kg」と書かない */}
                          {hasRef(r) && (
                            <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                              基準 {formatRef(r)}
                            </span>
                          )}
                          {delta && (
                            <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">
                              {delta}
                            </span>
                          )}
                          {r.judge && (
                            <span className="mt-0.5 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                              判定 {r.judge}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                  {rows.some((r) => r.memo) && (
                    <li className="px-4 py-2.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                      {rows
                        .filter((r) => r.memo)
                        .map((r) => `${r.item}: ${r.memo}`)
                        .join(" / ")}
                    </li>
                  )}
                </ul>
              )}

              {c.memo && open && (
                <p className="border-t border-neutral-100 px-4 py-2.5 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  {c.memo}
                </p>
              )}
            </section>
          );
        })}

        {mine.length > 0 && (
          <Link
            href="/handoff"
            className="flex h-12 w-full items-center justify-center rounded-2xl border border-neutral-200 bg-white text-sm font-bold text-neutral-600 active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
          >
            新しい検査票を取り込む
          </Link>
        )}

        <p className="px-1 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">{CHECKUP_NOTE}</p>
      </div>
    </main>
  );
}
