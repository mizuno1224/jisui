"use client";

import { useMemo, useState } from "react";
import { setShare, setShareForMerchant } from "@/lib/mutations";
import type { Transaction } from "@/lib/types";

const YEN = new Intl.NumberFormat("ja-JP");

/**
 * 「夫婦 / 夫 / 妻」に振り分ける画面。
 *
 * 【1タップで終わらせる】
 * 未分類は数十件たまる。1件ずつ開いて閉じてでは終わらないので、
 * 一覧のまま3つのボタンを並べ、押した行はその場で消える。
 * 押し間違いに気づけるよう、直前の1件だけ「取り消す」を出す。
 *
 * 【同じ店をまとめて片付ける】
 * カード明細は同じ店が何度も出る(ETC、コンビニ)。1件ずつ押させない。
 * 同じ店が2件以上あるときは「この店 n 件をまとめて」を出す。
 *
 * 【次から自動にするのは、人が選んだときだけ】
 * まとめたついでに辞書へ書くと、たまたま今回そうだっただけの店が
 * 次から勝手に振り分けられる。スーパーは共用と個人が混ざるので、
 * 「次からも同じ」に印を付けたときだけ辞書に書く。
 */
export function ShareSheet({
  rows,
  onClose,
}: {
  rows: Transaction[];
  onClose: () => void;
}) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const [undo, setUndo] = useState<{ ids: number[]; label: string } | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const left = useMemo(() => rows.filter((t) => !done.has(t.id)), [rows, done]);

  /** 同じ店の未分類。まとめて片付けるために数える。 */
  const sameMerchant = useMemo(() => {
    if (left.length === 0) return [];
    const key = left[0].merchant_norm || left[0].merchant_raw;
    return left.filter((t) => (t.merchant_norm || t.merchant_raw) === key);
  }, [left]);

  const head = left[0];

  async function apply(share: "夫婦" | "夫" | "妻", all: boolean) {
    if (!head || busy) return;
    const targets = all ? sameMerchant : [head];
    setBusy(true);
    try {
      await setShare(targets.map((t) => t.id), share);
      if (remember && all) {
        // 「まとめて」を選んだ = その店はいつもこれ、という判断。
        // 1件ずつのときは判断が1回ぶんしかないので辞書に書かない。
        await setShareForMerchant(head.merchant_norm || head.merchant_raw, share);
      }
      setDone((s) => new Set([...s, ...targets.map((t) => t.id)]));
      setUndo({
        ids: targets.map((t) => t.id),
        label: `${targets.length}件を「${share}」にしました`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function undoLast() {
    if (!undo || busy) return;
    setBusy(true);
    try {
      await setShare(undo.ids, "未分類");
      setDone((s) => {
        const n = new Set(s);
        for (const id of undo.ids) n.delete(id);
        return n;
      });
      setUndo(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-950">
      <header className="border-b border-neutral-200 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">誰のぶんか決める</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3 text-sm text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
          >
            閉じる
          </button>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          残り <span className="font-bold text-neutral-800 dark:text-neutral-200">{left.length}</span> 件
        </p>
      </header>

      {head ? (
        <div className="flex flex-1 flex-col overflow-y-auto px-4 py-5">
          {/* いま決める1件。大きく出して、迷わないようにする */}
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-xs text-neutral-500">{head.date}・{head.source}</p>
            <p className="mt-1 text-lg font-bold leading-snug">{head.merchant_raw}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">¥{YEN.format(head.amount)}</p>
            <p className="mt-1 text-xs text-neutral-500">
              費目: {head.category}
              {head.memo ? `・${head.memo}` : ""}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {(["夫婦", "夫", "妻"] as const).map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => apply(s, false)}
                className="h-16 rounded-xl bg-neutral-100 text-base font-bold active:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:active:bg-neutral-700"
              >
                {s}
              </button>
            ))}
          </div>

          {sameMerchant.length > 1 && (
            <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/40">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                同じ店があと {sameMerchant.length - 1} 件あります
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["夫婦", "夫", "妻"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => apply(s, true)}
                    className="h-11 rounded-lg bg-blue-600 text-sm font-bold text-white active:bg-blue-700 disabled:opacity-50"
                  >
                    全部{s}
                  </button>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-blue-900 dark:text-blue-200">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="size-4"
                />
                この店は次の取り込みからも同じにする
              </label>
            </div>
          )}

          {undo && (
            <div className="mt-5 flex items-center justify-between rounded-xl bg-neutral-800 px-4 py-3 text-white">
              <span className="text-sm">{undo.label}</span>
              <button
                type="button"
                onClick={undoLast}
                disabled={busy}
                className="text-sm font-bold underline disabled:opacity-50"
              >
                取り消す
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-4xl">🎉</p>
          <p className="text-lg font-bold">未分類はありません</p>
          <p className="text-sm text-neutral-500">
            次にカード明細を取り込んだとき、辞書に無い店だけがここに出ます。
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 h-11 rounded-xl bg-neutral-900 px-6 text-sm font-bold text-white dark:bg-white dark:text-neutral-900"
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}
