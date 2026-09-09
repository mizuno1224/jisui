"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { setPantryStock } from "@/lib/mutations";
import { useTable } from "@/lib/use-table";
import type { Equipment, Pantry, Preference } from "@/lib/types";

/**
 * 台所の決めごと。器具・常備品・好み。
 *
 * 【献立の答えが変わる前提が、アプリのどこにも出ていなかった】
 * チャットに献立を頼むと、この3つを読んでから答えが決まる。
 *   ・equipment に無い器具を使うレシピは出さない
 *   ・pantry にあるものは買い物リストに載せない(米は絶対に載せない)
 *   ・preferences の「苦手」は絶対に使わない
 * つまり「なぜトマトが一度も出てこないのか」の答えはここにある。
 * それが画面から見えないと、AIの気まぐれに見えてしまう。
 *
 * 【常備品だけは、この画面から直せる】
 * もとは読むだけの画面にしていた(直す道が2本になると、どちらが最後に効いたのか
 * 追えなくなるため)。だが**残り具合はチャットからでは記録されない**。
 * 鶏がらスープの素が残り少ないと気づくのは瓶を持っているときで、
 * そこでチャットを開く人はいない。気づきが消えて、そのまま切らす。
 *
 * そこで常備品の「ある / 切れそう / 切れた」だけを、ここから押せるようにした。
 * 器具・好み・方針は今までどおり読むだけ(こちらは滅多に変わらないので、
 * 入口を1本に保つ理由がまだ立つ)。
 *
 * 【押すたびに切り替えない】。3つを並べて選ばせる。
 * 回すボタンは押しすぎて通り過ぎる(MoveToInventorySheet で同じ失敗をしている)。
 */

const STOCK_STYLE: Record<Pantry["stock"], string> = {
  ある: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  切れそう: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  切れた: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

const KIND_STYLE: Record<Preference["kind"], string> = {
  苦手: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  好き: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  方針: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

export function KitchenScreen() {
  const equipment = useTable<Equipment>("equipment");
  const pantry = useTable<Pantry>("pantry");
  const preferences = useTable<Preference>("preferences");

  /** 常備品は分類ごと。切れているものを分類の中で先に出す。 */
  const pantryGroups = useMemo(() => {
    const map = new Map<string, Pantry[]>();
    for (const p of pantry.rows) {
      const key = p.category ?? "その他";
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
    const rank = { 切れた: 0, 切れそう: 1, ある: 2 } as const;
    for (const list of map.values()) {
      list.sort((a, b) => rank[a.stock] - rank[b.stock] || a.name.localeCompare(b.name, "ja"));
    }
    return [...map.entries()];
  }, [pantry.rows]);

  const prefGroups = useMemo(
    () =>
      (["苦手", "好き", "方針"] as const)
        .map((kind) => [kind, preferences.rows.filter((p) => p.kind === kind)] as const)
        .filter(([, list]) => list.length > 0),
    [preferences.rows],
  );

  const [target, setTarget] = useState<Pantry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (p: Pantry, stock: Pantry["stock"]) => {
    setBusy(true);
    setError(null);
    try {
      await setPantryStock(p.id, stock);
      // 往復を待たずに画面へ反映する。次の読み直しでサーバの値に揃う
      pantry.patch({ ...p, stock });
      setTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const short = pantry.rows.filter((p) => p.stock !== "ある");

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="記録"
        subtitle="台所の決めごと"
        right={
          <Link
            href="/records"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            もどる
          </Link>
        }
      >
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          器具 {equipment.rows.length} ・ 常備品 {pantry.rows.length} ・ 好みと方針{" "}
          {preferences.rows.length}
        </p>
      </ScreenHeader>

      <LoadNotice
        loading={equipment.loading && pantry.loading && preferences.loading}
        error={equipment.error ?? pantry.error ?? preferences.error}
        empty={false}
        emptyText=""
      />

      <div className="space-y-3 px-4 pt-3">
        <p className="px-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          献立を相談したときに、AI がこの3つを前提にします。常備品は押して直せます。器具と好みはチャットから。
        </p>

        {/* -------------------------------------------------- 好み・方針 */}
        {prefGroups.map(([kind, list]) => (
          <section
            key={kind}
            className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h2 className="flex items-center gap-2 px-4 pt-3.5 text-sm font-bold">
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${KIND_STYLE[kind]}`}>{kind}</span>
              {kind === "苦手" && (
                <span className="text-[11px] font-normal text-neutral-500 dark:text-neutral-400">
                  献立に絶対に出しません
                </span>
              )}
            </h2>
            <ul className="px-4 pb-3.5 pt-1.5">
              {list.map((p) => (
                <li key={p.id} className="py-1 text-sm">
                  {p.item}
                  {p.memo && (
                    <span className="ml-2 text-[11px] text-neutral-500 dark:text-neutral-400">{p.memo}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* -------------------------------------------------- 器具 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">器具</h2>
          <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            ここに無い器具を使うレシピは出しません
          </p>
          <ul className="px-4 pb-3.5">
            {equipment.rows.map((e) => (
              <li key={e.id} className="py-1 text-sm">
                {e.name}
                {e.memo && (
                  <span className="ml-2 text-[11px] text-neutral-500 dark:text-neutral-400">{e.memo}</span>
                )}
              </li>
            ))}
            {equipment.rows.length === 0 && (
              <li className="py-1 text-sm text-neutral-400 dark:text-neutral-600">まだありません</li>
            )}
          </ul>
        </section>

        {/* -------------------------------------------------- 常備品 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">常備品</h2>
          <p className="px-4 pb-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            買い物リストに載せないもの。
            <b className="text-neutral-700 dark:text-neutral-200">
              押すと残り具合を記録できます。
            </b>
            「あと少し」は<b>切れそう</b>にしてください。
            買い物タブに黄色い札が出て、1タップでリストに入ります。
            {short.length > 0 && (
              <b className="ml-1 text-amber-700 dark:text-amber-400">
                いま 切れそう・切れた {short.length} 件
              </b>
            )}
          </p>
          {pantryGroups.map(([category, list]) => (
            <div key={category} className="border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
              <h3 className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400">{category}</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {list.map((p) => (
                  <li key={p.id}>
                    {/* 高さ36pxは、札を詰めて並べたときに隣を踏まない下限 */}
                    <button
                      type="button"
                      onClick={() => setTarget(p)}
                      className={`h-9 rounded-lg px-2 text-xs active:opacity-60 ${
                        p.stock === "ある"
                          ? "bg-neutral-100 dark:bg-neutral-800"
                          : STOCK_STYLE[p.stock]
                      }`}
                    >
                      {p.staple && <span className="mr-0.5">★</span>}
                      {p.name}
                      {p.stock !== "ある" && <span className="ml-1 font-bold">{p.stock}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="border-t border-neutral-100 px-4 py-2.5 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            ★ は毎回チェックするお決まり食材です
          </p>
        </section>
      </div>

      {/* 残り具合を決めるシート。3つを並べて選ばせる(回すボタンにしない) */}
      {target && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setTarget(null)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
            <p className="mb-1 text-center text-base font-bold">{target.name}</p>
            <p className="mb-4 text-center text-[11px] text-neutral-500 dark:text-neutral-400">
              いま {target.stock}
            </p>

            {error && (
              <p className="mb-2 text-center text-xs font-semibold text-rose-600">{error}</p>
            )}

            <div className="space-y-2">
              {(["ある", "切れそう", "切れた"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => void choose(target, s)}
                  className={`h-14 w-full rounded-xl text-base font-bold disabled:opacity-40 ${
                    target.stock === s
                      ? "bg-emerald-600 text-white"
                      : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  }`}
                >
                  {s}
                  {s === "切れそう" && (
                    <span className="ml-2 text-xs font-normal opacity-80">(あと少し)</span>
                  )}
                </button>
              ))}
            </div>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              「切れそう」「切れた」にすると、<b>買い物タブの上に黄色い札</b>が出ます。
              そこから1タップで買い物リストに入ります。
            </p>

            <button
              type="button"
              onClick={() => setTarget(null)}
              className="mt-4 h-14 w-full rounded-xl bg-neutral-100 text-base font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              やめる
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
