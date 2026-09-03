"use client";

import Link from "next/link";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useRecordCounts } from "@/lib/record-counts";

/**
 * 記録の目録。
 *
 * 【なぜ要るのか】
 * 画面が20近くになり、記録の種類はそれより多い。
 * レシートの明細・作った記録・器具や常備品・費目の決まりのように、
 * **入っているのに、どの画面からも見えない記録**が育っていた。
 * 見えない記録は、無いのと同じどころか悪い。人は「入れたはず」と思っており、
 * アプリは黙って抱えている。どちらも間違いに気づけない。
 *
 * ここは【アプリが持っている記録を1つ残らず並べた目録】である。
 * 種類・件数・見る場所の3つを出す。
 *
 * 【ここが画面一覧の正本】
 * ホームにも同じような一覧があったが、二重に持つと必ず片方が古くなる。
 * ホームからはこの画面へ1行で来る形にした。**新しい画面を足したら、
 * 下の CATALOG に必ず1行足すこと。**
 *
 * 【件数は行を読まずに数える】(lib/record-counts.ts)
 * 20表を素直に読むと、目録がアプリでいちばん重い画面になる。
 */

type Entry = {
  title: string;
  /** 数える表。目録の件数はここから出る */
  table: string;
  href: string;
  desc: string;
  /** 数え方が「その表の行数」と一致しない場合の但し書き */
  unit?: string;
};

const CATALOG: { group: string; note?: string; entries: Entry[] }[] = [
  {
    group: "くらし",
    entries: [
      { title: "買い物リスト", table: "shopping_list", href: "/shopping", desc: "買うもの。チェックした人と時刻も残る" },
      { title: "在庫", table: "inventory", href: "/inventory", desc: "冷蔵・冷凍・常温の中身と期限" },
      { title: "レシピ", table: "recipes", href: "/recipes", desc: "作り方・材料・器具・栄養(野菜量と塩分)" },
      { title: "献立", table: "meal_plan", href: "/plan", desc: "いつ何を食べるか。カレンダーに出る" },
      { title: "作った記録", table: "cook_log", href: "/records/cooking", desc: "実際に作った日と回数。1食あたりコストの分母" },
      { title: "台所の決めごと", table: "pantry", href: "/records/kitchen", desc: "器具・常備品・好み。献立の答えが変わる前提", unit: "常備品" },
    ],
  },
  {
    group: "予定とやること",
    entries: [
      { title: "予定", table: "events", href: "/plan", desc: "カレンダー。繰り返し・持ち物・非公開のタグ" },
      { title: "やること", table: "todos", href: "/plan/todos", desc: "サブタスクと繰り返しつき" },
      { title: "家事", table: "chore_log", href: "/plan/chores", desc: "やった日の記録。設定は曜日ごと・毎月n日", unit: "やった記録" },
      { title: "予定のタグ", table: "calendar_tags", href: "/plan/tags", desc: "色分けと、相手に見せない設定" },
    ],
  },
  {
    group: "健康",
    note: "このアプリは診断をしません。判断は医師によります",
    entries: [
      { title: "日々の記録", table: "vitals", href: "/health", desc: "体重・体脂肪・血圧。睡眠と活動と飲酒も同じ画面", unit: "体重など" },
      { title: "検診・予防接種", table: "screening", href: "/health/checkups", desc: "受けた日と、次に受ける時期" },
      { title: "健康診断", table: "checkup", href: "/health/exams", desc: "健診・人間ドック・血液検査の結果と、年ごとの推移", unit: "受診" },
    ],
  },
  {
    group: "お金",
    entries: [
      { title: "支出", table: "transactions", href: "/spending", desc: "レシートとカード明細。費目・予算・誰のぶんか" },
      { title: "レシートの明細", table: "receipt_items", href: "/records/receipts", desc: "何をいくらで買ったか。品目ごとの値段", unit: "品目" },
      { title: "費目の決まり", table: "expense_rules", href: "/records/rules", desc: "店名から費目を決める辞書。取り込みのときに引く" },
      { title: "資産と負債", table: "balances", href: "/spending/assets", desc: "口座の残高・ローン・給与", unit: "月ごとの残高" },
      { title: "投資", table: "holdings", href: "/spending/investments", desc: "保有銘柄と監視銘柄" },
      { title: "投資のまとめ", table: "watchlist", href: "/spending/investments/summary", desc: "配分・FANG+の割合・押し目ルールを方針と突き合わせる", unit: "監視銘柄" },
    ],
  },
];

const TABLES = CATALOG.flatMap((g) => g.entries.map((e) => e.table));

export function RecordsScreen() {
  const { counts, loading } = useRecordCounts(TABLES);

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="くらし"
        subtitle="記録"
        right={
          <Link
            href="/"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            ホーム
          </Link>
        }
      >
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          このアプリに残っている記録の全部です
        </p>
      </ScreenHeader>

      <div className="space-y-3 px-4 pt-3">
        {CATALOG.map((group) => (
          <section
            key={group.group}
            className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h2 className="px-4 pt-3.5 text-sm font-bold">{group.group}</h2>
            {group.note && (
              <p className="px-4 pb-1 text-[11px] text-neutral-500 dark:text-neutral-400">{group.note}</p>
            )}
            <ul className="pt-1.5">
              {group.entries.map((e) => {
                const n = counts[e.table];
                return (
                  <li key={e.href + e.title}>
                    <Link
                      href={e.href}
                      className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3 active:bg-neutral-50 dark:border-neutral-800 dark:active:bg-neutral-800"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{e.title}</span>
                        <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                          {e.desc}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-1.5">
                        <span className="text-right">
                          <span className="block text-sm font-bold tabular-nums">
                            {/*
                              数えられなかったものを 0 と書かない。
                              「まだ表が無い」と「本当に0件」は別のことで、
                              0 と出すと、入れたはずの記録が消えたように見える。
                            */}
                            {n == null ? (loading ? "…" : "—") : n.toLocaleString("ja-JP")}
                          </span>
                          {e.unit && n != null && (
                            <span className="block text-[10px] text-neutral-400 dark:text-neutral-500">
                              {e.unit}
                            </span>
                          )}
                        </span>
                        <span className="text-neutral-300 dark:text-neutral-600">›</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {/* -------------------------------------------------- 入れ方 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">記録の入れ方</h2>
          <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            入口は2つあります。得意なことが違うので、どちらも残してあります
          </p>
          <ul>
            <li className="border-t border-neutral-100 px-4 py-3 text-[13px] dark:border-neutral-800">
              <b>アプリ</b>
              <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                買い物のチェック・在庫の増減・体重・予定・やること。片手で1タップのもの
              </span>
            </li>
            <li className="border-t border-neutral-100 dark:border-neutral-800">
              <Link href="/handoff" className="block px-4 py-3 text-[13px] active:bg-neutral-50 dark:active:bg-neutral-800">
                <b>チャットから取り込む ›</b>
                <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                  レシート・カード明細・レシピ・検査票のように、まとめて入るもの
                </span>
              </Link>
            </li>
          </ul>
        </section>

        <Link
          href="/help"
          className="flex h-12 w-full items-center justify-center rounded-2xl border border-neutral-200 bg-white text-sm font-bold text-neutral-600 active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
        >
          使い方を見る
        </Link>
      </div>
    </main>
  );
}
