"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * 下から出る共通のシート。
 *
 * iOS の Safari はキーボードが出ても layout viewport を縮めないため、
 * position:fixed のシートは動かず、「保存する」がキーボードの下に完全に隠れる。
 * 支出を1件足すたび、数量を打つたびに「キーボードを閉じる→ボタンを押す」の
 * 2手が余計に要っていた。
 *
 * visualViewport の変化からキーボードの高さを出し、そのぶん下に余白を足す。
 * iOS ではこれ以外に効く手が無い。
 */
export function Sheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardInset(inset > 40 ? inset : 0);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{ paddingBottom: keyboardInset }}
        className="relative max-h-[88dvh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl dark:bg-neutral-900"
      >
        <div className="px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
          {children}
        </div>
      </div>
    </div>
  );
}
