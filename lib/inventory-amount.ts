"use client";

/**
 * 在庫の「残り」をスライダーで動かすための計算。
 *
 * 【なぜ全部の食材で同じ形にするのか】
 * +/- は 6Pチーズを1個ずつ減らすには合っているが、
 * 「なす1袋のうち2本使った」「牛乳を半分飲んだ」には合わない。
 * 数える単位が食材ごとに違うのに、操作だけが1種類しか無かった。
 *
 * そこで【満タンがいくつで、いま残りがいくつか】という1つの形に揃える。
 * 6Pチーズなら 6 のうち 4、牛乳1本なら 1 のうち 0.5。
 * どの食材でも、目盛りを動かすだけで残量が決まる。
 *
 * 満タんの数(pack_size)は**買ったときの数量から自動で入る**ので、
 * 人が余分に入力することは無い。違っていたら詳細で直せる。
 */

/** その行の満タン。記録が無いものは、いまの数量を満タンとみなす。 */
export function fullOf(item: { qty: number | null; pack_size: number | null }): number {
  if (item.pack_size != null && item.pack_size >= 1) return item.pack_size;
  return Math.max(1, Math.ceil(item.qty ?? 1));
}

/**
 * 目盛りの細かさ。
 *
 * 【満タンが1のものだけ4分の1きざみにする】
 * 牛乳1本・ドレッシング1本のように「1つ」しか無いものは、
 * 1きざみだと 有る / 無い の2択にしかならず、半分残っているを書けない。
 * 逆に個数で数えるもの(6Pチーズ)を0.25きざみにすると、
 * 「4.25個」という意味の無い数が作れてしまう。
 *
 * 大きい数(肉200g)は1きざみだと目盛りが細かすぎて指で合わない。10ずつにする。
 */
export function stepOf(full: number): number {
  if (full <= 1) return 0.25;
  if (full <= 30) return 1;
  return 10;
}

/** スライダーが作る値を、その食材で意味のある数に丸める。 */
export function snapQty(value: number, full: number): number {
  const step = stepOf(full);
  const snapped = Math.round(value / step) * step;
  return Math.min(full, Math.max(0, Math.round(snapped * 100) / 100));
}

/**
 * 残りを人の言葉にする。
 *
 * 【数字だけにしない】。0.25 と出されても、冷蔵庫の前では意味が取れない。
 * 4分の1きざみのものは「半分」「4分の1」と書く。
 */
export function remainLabel(qty: number, full: number, unit: string | null): string {
  if (qty <= 0) return "空(使い切った)";
  if (stepOf(full) === 0.25 && full <= 1) {
    const ratio = qty / full;
    if (ratio >= 1) return "満タン";
    if (ratio >= 0.75) return "4分の3";
    if (ratio >= 0.5) return "半分";
    if (ratio >= 0.25) return "4分の1";
    return "わずか";
  }
  const u = unit ?? "";
  return `${qty} / ${full}${u}`;
}
