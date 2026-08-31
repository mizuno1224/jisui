"use client";

import { weightForBmi } from "@/lib/health";

/**
 * 体重の折れ線と、BMI 21〜25 の帯。
 *
 * 【この画面で一番大事な決まり】
 * **減量前提の絵にしないこと。** 目標「線」ではなく目標「帯」を描く。
 * 線を1本引くと、その上にいるか下にいるかの話になり、
 * 下に行くほど良いという読み方が生まれる。この世帯は妻が少食で
 * 体重を増やしたい方針なので、それは逆向きの指示になる。
 * 帯なら「中にいるか」だけが問われ、上からでも下からでも同じ意味になる。
 * 痩せすぎもがんのリスクである、というのがガイドラインの立場。
 *
 * 【縦軸を帯より広く取る】
 * 折れ線が帯の外に出ているとき、軸を実測値だけで決めると帯が画面から
 * 消えることがある。帯が見えない体重グラフは、ただの折れ線であって
 * 「目標帯の中にいるか」を見せられない。必ず両方が入る幅にする。
 *
 * 身長が未入力のときは帯を描けない。そのときは折れ線だけを出し、
 * 「身長を入れると目標帯が出る」と画面側で案内する。
 */
export function WeightChart({
  points,
  heightCm,
  bmiMin,
  bmiMax,
}: {
  points: { date: string; weight: number }[];
  heightCm: number | null;
  bmiMin: number;
  bmiMax: number;
}) {
  if (points.length === 0) return null;

  const W = 340;
  const H = 160;
  const PAD_TOP = 10;
  const PAD_BOTTOM = 18;
  const PAD_LEFT = 30;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const plotW = W - PAD_LEFT;

  const band =
    heightCm != null
      ? { low: weightForBmi(bmiMin, heightCm), high: weightForBmi(bmiMax, heightCm) }
      : null;

  const values = points.map((p) => p.weight);
  const lo = Math.min(...values, band?.low ?? Infinity);
  const hi = Math.max(...values, band?.high ?? -Infinity);
  // 上下に少し余裕。全部が同じ値だと幅0になって割り算が壊れるので下限を置く。
  const span = Math.max(hi - lo, 2);
  const min = lo - span * 0.15;
  const max = hi + span * 0.15;

  const y = (v: number) => PAD_TOP + plotH - ((v - min) / (max - min)) * plotH;
  const x = (i: number) =>
    PAD_LEFT + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.weight).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={
          `体重の推移。${points.map((p) => `${Number(p.date.slice(5, 7))}月${Number(p.date.slice(8, 10))}日 ${p.weight}kg`).join("、")}。` +
          (band ? `目標帯は ${band.low}〜${band.high}kg。` : "身長が未入力のため目標帯は出ていません。")
        }
      >
        {/* 目標帯。データより先に描いて、必ず折れ線の下に置く */}
        {band && (
          <>
            <rect
              x={PAD_LEFT}
              y={y(band.high)}
              width={plotW}
              height={Math.max(1, y(band.low) - y(band.high))}
              className="fill-emerald-500/15"
            />
            <line x1={PAD_LEFT} x2={W} y1={y(band.high)} y2={y(band.high)} strokeWidth={1} strokeDasharray="3 3" className="stroke-emerald-600/50" />
            <line x1={PAD_LEFT} x2={W} y1={y(band.low)} y2={y(band.low)} strokeWidth={1} strokeDasharray="3 3" className="stroke-emerald-600/50" />
            {/* 帯の値は左端に。数字が無いと「どのくらいの幅か」が読めない */}
            <text x={0} y={y(band.high) + 3} className="fill-emerald-700 text-[9px] tabular-nums dark:fill-emerald-400">
              {band.high}
            </text>
            <text x={0} y={y(band.low) + 3} className="fill-emerald-700 text-[9px] tabular-nums dark:fill-emerald-400">
              {band.low}
            </text>
          </>
        )}

        <path d={line} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="stroke-neutral-800 dark:stroke-neutral-100" />
        {points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.weight)} r={i === points.length - 1 ? 3.5 : 2} className="fill-neutral-800 dark:fill-neutral-100" />
        ))}

        {/* 一番新しい値だけ数字を出す。全部に出すと 340px では重なって読めない */}
        <text
          x={Math.min(x(points.length - 1), W - 4)}
          y={Math.max(9, y(last.weight) - 7)}
          textAnchor="end"
          paintOrder="stroke"
          strokeWidth={3}
          strokeLinejoin="round"
          className="fill-neutral-700 stroke-white text-[10px] font-bold tabular-nums dark:fill-neutral-200 dark:stroke-neutral-900"
        >
          {last.weight}kg
        </text>

        <text x={PAD_LEFT} y={H - 4} className="fill-neutral-400 text-[9px]">
          {Number(points[0].date.slice(5, 7))}/{Number(points[0].date.slice(8, 10))}
        </text>
        <text x={W} y={H - 4} textAnchor="end" className="fill-neutral-400 text-[9px]">
          {Number(last.date.slice(5, 7))}/{Number(last.date.slice(8, 10))}
        </text>
      </svg>
    </figure>
  );
}
