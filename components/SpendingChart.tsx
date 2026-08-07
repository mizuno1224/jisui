"use client";

import { yen } from "@/lib/dates";

/**
 * 費目1つの月次推移。
 *
 * 設計の理由:
 *   ・系列は1つだけ。390px の幅に10費目を並べても読めないので、
 *     費目をタップして切り替える形にした。1系列なので凡例は要らない(見出しが名前を言う)。
 *   ・6ヶ月ぶんに絞り、各棒に金額を直接書く。指で触れないぶん、
 *     ツールチップに頼らず最初から全部見えているほうが速い。
 *   ・予算がある費目は破線で基準を引く。超えた月がひと目で分かる。
 *   ・色は validate_palette.js でライト/ダーク両方の背景に対して検証済み。
 *     超過は色だけでなく金額の文字でも示す(色覚特性で緑と橙は近いため)。
 */
const OK = "#059669";
const OVER = "#e11d48";

export function SpendingChart({
  data,
  budget,
  label,
}: {
  data: { month: string; amount: number }[];
  budget: number | null;
  label: string;
}) {
  if (data.length === 0) return null;

  const W = 340;
  const H = 150;
  const PAD_TOP = 18; // 金額ラベルのぶん
  const PAD_BOTTOM = 18; // 月ラベルのぶん
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const slot = W / data.length;
  const barW = Math.min(38, slot - 12);

  const peak = Math.max(...data.map((d) => d.amount), budget ?? 0, 1);
  const y = (v: number) => PAD_TOP + plotH - (v / peak) * plotH;

  return (
    <figure className="m-0">
      <figcaption className="px-4 pb-1 text-xs font-bold text-neutral-500">
        {label}の推移
        {budget != null && <span className="ml-1 font-normal">(破線は予算 {yen(budget)})</span>}
      </figcaption>
      <div className="px-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`${label}の月別推移。${data
            .map((d) => `${Number(d.month.slice(5))}月 ${d.amount}円`)
            .join("、")}`}
        >
          {/* 基準線は控えめに。データより目立たせない */}
          <line
            x1={0}
            x2={W}
            y1={PAD_TOP + plotH}
            y2={PAD_TOP + plotH}
            stroke="currentColor"
            strokeWidth={1}
            className="text-neutral-200 dark:text-neutral-700"
          />
          {budget != null && budget > 0 && (
            <line
              x1={0}
              x2={W}
              y1={y(budget)}
              y2={y(budget)}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              className="text-neutral-400 dark:text-neutral-500"
            />
          )}

          {data.map((d, i) => {
            const x = i * slot + (slot - barW) / 2;
            const top = y(d.amount);
            const h = Math.max(2, PAD_TOP + plotH - top);
            const over = budget != null && d.amount > budget;
            return (
              <g key={d.month}>
                <rect
                  x={x}
                  y={top}
                  width={barW}
                  height={h}
                  rx={4}
                  fill={over ? OVER : OK}
                />
                {/*
                  金額は予算の破線と重なる位置に来ることがある。
                  背景色で縁取りしてから文字を描き、線を切り抜いて読めるようにする。
                */}
                <text
                  x={x + barW / 2}
                  y={top - 5}
                  textAnchor="middle"
                  paintOrder="stroke"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  className="fill-neutral-500 stroke-neutral-50 text-[9px] tabular-nums dark:fill-neutral-400 dark:stroke-neutral-950"
                >
                  {d.amount.toLocaleString("ja-JP")}
                </text>
                <text
                  x={x + barW / 2}
                  y={H - 5}
                  textAnchor="middle"
                  className="fill-neutral-400 text-[10px]"
                >
                  {Number(d.month.slice(5))}月
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
