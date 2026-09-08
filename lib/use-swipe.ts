"use client";

import { useRef } from "react";

/**
 * 横に払う指の動きを拾う。
 *
 * 【なぜ要るか】
 * 在庫の区画(冷蔵/氷温/野菜/冷凍/常温)は上のタブでしか切り替えられなかった。
 * 冷蔵庫の前では片手で、しかも濡れた指で操作するので、
 * 画面上端の小さなタブまで親指を伸ばすのが一番つらい。
 * 一覧のどこを払っても隣の区画に移れれば、指を動かす距離がほぼ0になる。
 *
 * 【縦のスクロールを邪魔しないこと】
 * ここが一番大事で、外すと一覧がスクロールできなくなる。
 *   ・preventDefault を呼ばない。ブラウザのスクロールはそのまま通す
 *   ・横の移動が縦より【はっきり大きい】ときだけ、払ったと見なす
 *   ・指を離した時点で1回だけ判定する。途中では何もしない
 *
 * 【画面の左端から始まった指は無視する】
 * iPhone は左端からの右払いを「前の画面へ戻る」に使う。
 * ここでも拾うと、戻りながらタブも変わって何が起きたか分からなくなる。
 */

/** 払ったと見なす横の距離(px)。短いと、ただの押し間違いで区画が変わる。 */
const MIN_DISTANCE = 60;
/** 横が縦の何倍あれば「横に払った」と見なすか。 */
const RATIO = 1.5;
/** これより長くかかった動きは、払いではなく「掴んで動かした」と見なす。 */
const MAX_MS = 700;
/** 画面の左右この幅から始まった指は、端末の戻る操作とぶつかるので拾わない。 */
const EDGE = 24;

export type SwipeHandlers = {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
};

/**
 * @param onSwipe 次(+1)か前(-1)へ。左へ払うと +1(次の区画が左から出てくる感覚)
 * @param enabled 検索中など、切り替えても意味がないときは false にする
 */
export function useHorizontalSwipe(
  onSwipe: (direction: 1 | -1) => void,
  enabled = true,
): SwipeHandlers {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);

  return {
    onTouchStart: (e) => {
      if (!enabled || e.touches.length !== 1) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      // 端から始まった指は端末の操作。ここでは拾わない。
      if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) {
        start.current = null;
        return;
      }
      start.current = { x: t.clientX, y: t.clientY, at: Date.now() };
    },
    onTouchEnd: (e) => {
      const from = start.current;
      start.current = null;
      if (!from || !enabled) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      if (Date.now() - from.at > MAX_MS) return;
      if (Math.abs(dx) < MIN_DISTANCE) return;
      if (Math.abs(dx) < Math.abs(dy) * RATIO) return; // 縦に動かしている
      onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

/**
 * 並びの中を隣へ動かす。**端では止まる(回り込まない)。**
 *
 * 在庫の区画、レシピの「普段/弁当」、健康の「夫/妻」のように、
 * 決まった数の札を切り替える画面はアプリ中にある。
 * 同じ指の動きがどの画面でも同じ意味になるように、ここに1つだけ書く。
 *
 * 【回り込ませない理由】
 * 常温の次が冷蔵に戻ると、何周したのか分からなくなる。
 * 端に着いたら何も起きないほうが、いまどこにいるかを見失わない。
 *
 * 【手ごたえを返す】
 * 画面の上のほうにある札が変わるだけだと、指の下では何が起きたか分からない。
 * 短く震わせて「効いた」ことを伝える(対応していない端末では何も起きない)。
 */
export function useSwipeAmong<T>(
  items: readonly T[],
  current: T,
  onChange: (next: T) => void,
  enabled = true,
): SwipeHandlers {
  return useHorizontalSwipe((dir) => {
    const next = items[items.indexOf(current) + dir];
    if (next === undefined) return;
    onChange(next);
    navigator.vibrate?.(8);
  }, enabled);
}

/**
 * 月を送る。家計・資産のように「前の月 / 次の月」がある画面向け。
 * 端が無いので止めない。左へ払うと次の月へ進む。
 */
export function useSwipeMonths(
  month: string,
  onChange: (next: string) => void,
  addMonths: (month: string, delta: number) => string,
  enabled = true,
): SwipeHandlers {
  return useHorizontalSwipe((dir) => {
    onChange(addMonths(month, dir));
    navigator.vibrate?.(8);
  }, enabled);
}
