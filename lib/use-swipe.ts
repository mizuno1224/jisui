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
