"use client";

import { useState } from "react";
import { addItem } from "@/lib/store";
import { restockReason, type ShortStaple } from "@/lib/staples";

/**
 * 切らしている常備品を、買い物リストの一番上に出す。
 *
 * 【なぜ勝手に足さないのか】
 * 常備品は「いつも家にあるもの」として買い物リストに載せない決まりで、
 * レシピの「足りない n 点」からも除かれる。そのぶん**切らしても気づけない。**
 * 買ったつもりで買えていない、という起き方をする。
 *
 * かといって毎回自動で載せると、「今週は要らない」と消したものが
 * 次の同期で戻ってきて、リストが自分のものでなくなる。
 * 気づかせるところまでをアプリがやり、載せるかどうかは人が決める。
 *
 * 【押す的を2つに分ける】
 * 「まとめて足す」と「あとで」を並べる。片方しか無いと、
 * 要らないときに札を消す道が無く、毎回スクロールで避けることになる。
 */
export function ShortStaplesCard({
  items,
  onDismiss,
}: {
  items: ShortStaple[];
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addAll = async () => {
    setBusy(true);
    setError(null);
    try {
      /*
       * 1件ずつ順に足す。addItem は売り場ごとの並び順(sort_order)を
       * いまのリストから決めるので、まとめて投げると同じ番号が並ぶ。
       * 通信は待たずに手元へ書かれるので、圏外でも押せる。
       */
      for (const s of items) {
        await addItem({
          item: s.name,
          qty: "1",
          section: s.section,
          reason: restockReason(s),
        });
      }
      /*
       * 足したあとは何も呼ばない。**札が消えることが返事になる。**
       * 足した品は買い物リストの「未購入」になるので、
       * 次の計算で切らし判定から外れ、この札は自然に消える。
       * 売り場の行にもその場で並ぶ(通信は待たない)。
       */
    } catch (e) {
      setError(e instanceof Error ? e.message : "足せませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-4 mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
      <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
        切らしている常備品 {items.length} 件
      </h2>
      <p className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-200/70">
        常備品はふだんリストに載らないので、ここでだけ出しています。
      </p>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((s) => (
          <li
            key={s.id}
            className="rounded-lg bg-white/70 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
          >
            {s.name}
            <span className="ml-1 text-[10px] opacity-70">{s.why}</span>
          </li>
        ))}
      </ul>

      {error && (
        <p className="mt-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">{error}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void addAll()}
          disabled={busy}
          className="h-11 flex-[2] rounded-xl bg-amber-600 text-sm font-bold text-white active:bg-amber-700 disabled:opacity-40"
        >
          {busy ? "足しています…" : `まとめて足す(${items.length})`}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="h-11 flex-1 rounded-xl bg-white/70 text-sm font-semibold text-amber-900 disabled:opacity-40 dark:bg-amber-900/40 dark:text-amber-100"
        >
          あとで
        </button>
      </div>
    </section>
  );
}
