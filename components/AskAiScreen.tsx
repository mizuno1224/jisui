"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { buildAiContext, parseRecipeMarkdown } from "@/lib/ai-context";
import { replaceRecipeIngredients, saveRecipe } from "@/lib/mutations";
import {
  getServerSnapshot as invServerSnapshot,
  getSnapshot as invSnapshot,
  subscribe as invSubscribe,
} from "@/lib/inventory-store";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/store";
import { useTable } from "@/lib/use-table";
import type {
  CookLog,
  Equipment,
  MealPlan,
  Pantry,
  Preference,
  Recipe,
} from "@/lib/types";

/**
 * スマホから AI に献立を相談するための画面。
 *
 * 【なぜこの回り道をするのか】
 * アプリの中に AI を組み込むと、使うたびに従量課金がかかる。
 * かといってチャット(Cowork)はクラウドで動くと Supabase に届かず、
 * パソコンのデスクトップアプリも要る。スマホしか手元に無いときに使えない。
 *
 * そこで「相談に必要なものを全部書き出した文章」をこの画面が作り、
 * すでに契約している Claude のスマホアプリに貼ってもらう。
 * 返ってきたレシピを下の欄に貼れば、そのまま登録される。
 *
 * 追加の課金なしに、スマホだけで「相談する → 記録する」が閉じる。
 * 手数は増えるが、毎月の支払いが増えないことのほうが大事だと判断した。
 */
export function AskAiScreen() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const inv = useSyncExternalStore(invSubscribe, invSnapshot, invServerSnapshot);

  const pantry = useTable<Pantry>("pantry", { orderBy: "name" });
  const preferences = useTable<Preference>("preferences");
  const equipment = useTable<Equipment>("equipment", { orderBy: "name" });
  const cookLog = useTable<CookLog>("cook_log", { orderBy: "date", ascending: false });
  const mealPlan = useTable<MealPlan>("meal_plan", { orderBy: "date" });
  const recipes = useTable<Recipe>("recipes", { orderBy: "name" });

  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const context = useMemo(
    () =>
      buildAiContext({
        inventory: inv.items,
        pantry: pantry.rows,
        preferences: preferences.rows,
        equipment: equipment.rows,
        cookLog: cookLog.rows,
        mealPlan: mealPlan.rows,
        shopping: session.items,
        recipes: recipes.rows,
      }),
    [
      inv.items,
      pantry.rows,
      preferences.rows,
      equipment.rows,
      cookLog.rows,
      mealPlan.rows,
      session.items,
      recipes.rows,
    ],
  );

  const preview = useMemo(() => parseRecipeMarkdown(pasted), [pasted]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(context);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setError("コピーできませんでした。下の文章を長押しして選んでください。");
    }
  };

  const save = async () => {
    if (!preview.name) return;
    setBusy(true);
    setError(null);
    try {
      const id = await saveRecipe({
        name: preview.name,
        timeMin: preview.timeMin,
        cardMd: pasted.trim(),
        source: "AIに相談",
      });
      if (id && preview.ingredients.length > 0) {
        await replaceRecipeIngredients(id, preview.ingredients);
      }
      setSaved(preview.name);
      setPasted("");
      recipes.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="レシピ"
        subtitle="AIに相談する"
        right={
          <Link
            href="/recipes"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            レシピ一覧
          </Link>
        }
      />

      <div className="space-y-4 px-4 pt-4">
        {/* ------------------------------------------------ 手順1 */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-bold">1. まとめをコピーする</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            冷蔵庫の中身・常備品・苦手なもの・調理器具・最近作ったもの・
            これからの献立を1つの文章にしました。
            期限が近いものは先頭に出しています。
          </p>

          <button
            type="button"
            onClick={() => void copy()}
            className="mt-3 h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white active:bg-emerald-700"
          >
            {copied ? "コピーしました" : "まとめをコピー"}
          </button>

          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-neutral-500 dark:text-neutral-400">
              中身を見る({context.length.toLocaleString()}文字)
            </summary>
            <textarea
              readOnly
              value={context}
              rows={12}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded-xl border border-neutral-300 bg-neutral-50 p-3 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-800"
            />
          </details>
        </section>

        {/* ------------------------------------------------ 手順2 */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-bold">2. Claude アプリに貼って相談する</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            スマホの Claude アプリを開いて、いまコピーしたものを貼り付けて送ってください。
            そのあと普通に会話できます。
          </p>
          <ul className="mt-2 space-y-1 text-[11px] text-neutral-600 dark:text-neutral-300">
            <li>・「今夜の献立を考えて」</li>
            <li>・「キャベツを使い切りたい」</li>
            <li>・「15分で作れるものがいい」</li>
          </ul>
          <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            まとめの最後に「この形で書いてください」というお願いを入れてあります。
            そのとおりに返ってくれば、下にそのまま貼れます。
          </p>
        </section>

        {/* ------------------------------------------------ 手順3 */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-bold">3. 返ってきたレシピを貼る</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Claude の返事をコピーして、ここに貼り付けてください。
            名前と材料を読み取って登録します。
          </p>

          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={8}
            placeholder={"# 豚こまとキャベツの回鍋肉風\n\n## 材料(2人分)\n- 豚こま 300g\n…"}
            className="mt-3 w-full rounded-xl border border-neutral-300 bg-white p-3 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />

          {pasted.trim() !== "" && (
            <div className="mt-2 rounded-xl bg-neutral-100 px-3 py-2.5 text-[11px] dark:bg-neutral-800">
              <p className="font-bold">読み取った内容</p>
              <p className="mt-1">
                名前:{" "}
                {preview.name ? (
                  preview.name
                ) : (
                  <span className="text-rose-600">
                    読み取れません(先頭に「# レシピ名」の行が要ります)
                  </span>
                )}
              </p>
              <p>調理時間: {preview.timeMin != null ? `${preview.timeMin}分` : "(未記入)"}</p>
              <p>材料: {preview.ingredients.length} 件</p>
              {preview.ingredients.length > 0 && (
                <p className="mt-1 text-neutral-500 dark:text-neutral-400">
                  {preview.ingredients
                    .map((i) => `${i.name}${i.qty != null ? ` ${i.qty}${i.unit ?? ""}` : ""}`)
                    .join(" / ")}
                </p>
              )}
              <p className="mt-1.5 text-neutral-500 dark:text-neutral-400">
                読み取れなかったところは空のまま登録します。
                あとからレシピ画面で直せます。
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !preview.name}
            className="mt-3 h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            {busy ? "保存中…" : "レシピとして登録する"}
          </button>

          {saved && (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
              「{saved}」を登録しました。
              <Link href="/recipes" className="ml-1 font-bold underline">
                レシピ一覧で見る
              </Link>
            </p>
          )}
          {error && (
            <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </p>
          )}
        </section>

        <p className="px-1 pb-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          この回り道をしているのは、<strong>追加の支払いを増やさないため</strong>です。
          アプリの中に AI を組み込むと使うたびに料金がかかります。
          すでに契約している Claude をそのまま使えば、増える費用はありません。
        </p>
      </div>
    </main>
  );
}
