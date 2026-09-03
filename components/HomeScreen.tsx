"use client";

import Link from "next/link";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { addDays, currentMonth, daysUntil, todayISO, weekdayOf, WEEKDAY_LABELS, yen } from "@/lib/dates";
import { occursOn } from "@/lib/event-labels";
import { tagStyle } from "@/lib/tags";
import { missingByRecipe } from "@/lib/recipe-facets";
import {
  DEFAULT_TARGETS,
  SCREENING_PLANS,
  bmi,
  bmiState,
  screeningStatus,
  type HealthProfile,
  type Screening,
  type Vitals,
} from "@/lib/health";
import { getServerSnapshot, getSnapshot, init, signOut, subscribe } from "@/lib/store";
import {
  getServerSnapshot as invServerSnapshot,
  getSnapshot as invSnapshot,
  init as invInit,
  subscribe as invSubscribe,
} from "@/lib/inventory-store";
import { useTable } from "@/lib/use-table";
import type {
  Account,
  Balance,
  Budget,
  CalendarEvent,
  CalendarTag,
  Chore,
  ChoreLog,
  CookLog,
  MealPlan,
  Pantry,
  Recipe,
  RecipeIngredient,
  Todo,
  Transaction,
} from "@/lib/types";

/** 期限がこの日数以内なら「もうすぐ切れる」として数える。 */
const EXPIRY_SOON_DAYS = 3;

/**
 * ホーム。
 *
 * 【何のための画面か】
 * 3つある。
 *   1. 今日1日ぶんを1画面にまとめる。開いてすぐ「今日は何があるか」が分かる
 *   2. **ジャンルごとの一番大事な数字を1つずつ出す。** くらし・健康・お金は
 *      それぞれ別のタブに分かれていて、行かないと様子が分からなかった。
 *      「体重を今日まだ入れていない」「検診の期限が過ぎている」
 *      「今月の支出が予算を超えた」は、行かないと分からないでは遅い
 *   3. 記録の目録(/records)への入口になる。タブは7つしか置けないが、
 *      画面は20近くあり、記録の種類はそれより多い。
 *      **どこに何が残っているかの一覧は /records が正本。**ここには持たない
 *
 * 【重い集計をしない、という決まりの現在地】
 * ジャンルの要約を出すために読む表は増えた。本番の実測(2026-08-31)で、
 *   transactions 250行 24KB(列を5つに絞ったぶん) / accounts 9行 / balances 11行
 *   todos 104行 49KB / inventory 52行 13KB
 * もともと読んでいた todos のほうが重い。集計はどれも1回なめるだけで、
 * 手元のキャッシュを先に描く作りも変えていない。
 *
 * **増やすときは列を絞ること。** transactions は select を書かないと
 * レシート本文まで付いてきて、この画面がいちばん重い画面になる。
 */
export function HomeScreen() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const today = todayISO();
  const month = currentMonth();

  // 在庫は useTable ではなくストアから読む。
  // useTable が扱えるのは id が数値の表だけで、在庫は一時 id(文字列)を
  // 使うオフライン書き込み対応のため、専用ストアを持っている。
  const inventorySnapshot = useSyncExternalStore(invSubscribe, invSnapshot, invServerSnapshot);

  useEffect(() => {
    void init();
    void invInit();
  }, []);

  const events = useTable<CalendarEvent>("events");
  const tags = useTable<CalendarTag>("calendar_tags");
  const plans = useTable<MealPlan>("meal_plan");
  const todos = useTable<Todo>("todos");
  const chores = useTable<Chore>("chores");
  const choreLogs = useTable<ChoreLog>("chore_log");

  /*
   * 今日の候補を出すための表。
   *
   * 【recipes は列を絞る】。card_md はレシピ1品で1〜3KB あり、
   * 全部読むとこの画面だけで 80KB を超える。ここで要るのは名前と時間だけ。
   * recipe_ingredients(約300行)・pantry(43行)・cook_log(20行前後)は
   * どれも小さい。実測でいちばん重いのは今も todos(49KB)のまま。
   */
  const recipes = useTable<Recipe>("recipes", { select: "id,name,time_min,category" });
  const ingredients = useTable<RecipeIngredient>("recipe_ingredients");
  const pantry = useTable<Pantry>("pantry", { select: "id,name,stock" });
  const cookLogs = useTable<CookLog>("cook_log", { select: "id,date,recipe_id,name" });

  // お金。列を絞る(この画面では金額と費目と振り分けしか要らない)
  const tx = useTable<Transaction>("transactions", { select: "id,date,amount,category,share" });
  const budgets = useTable<Budget>("budgets");
  const accounts = useTable<Account>("accounts");
  const balances = useTable<Balance>("balances");

  // 健康。ホームでは「今日の体重」と「検診の期限」だけを見る。
  // 睡眠・活動・飲酒まで読むと表が3つ増えるので、そこは健康タブの仕事にする。
  const profiles = useTable<HealthProfile>("health_profile");
  const vitals = useTable<Vitals>("vitals", { select: "id,date,member,weight_kg" });
  const screenings = useTable<Screening>("screening");

  const tagById = useMemo(() => new Map(tags.rows.map((t) => [t.id, t])), [tags.rows]);

  // 繰り返す予定はサーバに1本しか無いので、今日に当たるかここで広げる
  const todayEvents = useMemo(
    () =>
      events.rows
        .filter((e) => occursOn(e, today))
        .sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99")),
    [events.rows, today],
  );

  const todayMeals = useMemo(
    () => plans.rows.filter((p) => p.date === today && p.status !== "中止"),
    [plans.rows, today],
  );

  const todayChores = useMemo(() => {
    const wd = weekdayOf(today);
    const dayOfMonth = Number(today.slice(8, 10));
    const done = new Set(choreLogs.rows.map((l) => `${l.chore_id}_${l.date}`));
    const list = chores.rows.filter((c) => {
      if (!c.active) return false;
      if (c.weekdays?.length) return c.weekdays.includes(wd);
      if (c.monthday != null) return c.monthday === dayOfMonth;
      return false;
    });
    return { total: list.length, done: list.filter((c) => done.has(`${c.id}_${today}`)).length };
  }, [chores.rows, choreLogs.rows, today]);

  // 期限切れ・期限が近い在庫。今日使うものを決める材料になる。
  const expiring = useMemo(
    () =>
      inventorySnapshot.items
        .filter((i) => i.expiry && daysUntil(i.expiry) <= EXPIRY_SOON_DAYS)
        .sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? "")),
    [inventorySnapshot.items],
  );

  const openTodos = useMemo(() => {
    const open = todos.rows.filter((t) => t.status === "open");
    // 親だけ数える。子まで数えると「やること3件」が実際は1件のことになる
    const roots = open.filter((t) => t.parent_id == null);
    const overdue = open.filter((t) => t.due_date && t.due_date < today).length;
    return { count: roots.length, overdue };
  }, [todos.rows, today]);

  // ------------------------------------------------------------ お金
  const money = useMemo(() => {
    let spent = 0;
    let unclassified = 0;
    for (const t of tx.rows) {
      if (t.date.startsWith(month)) spent += t.amount;
      // 【未分類は月をまたいで全部数える】。今月ぶんだけ見ると、
      // 先月の未分類が画面から消えて忘れられる(家計画面と同じ考え方)。
      if (t.share === "未分類") unclassified += 1;
    }
    // その月の上書きがあればそれ、無ければ毎月の既定(year_month が null)
    const byCategory = new Map<string, number>();
    for (const b of budgets.rows) {
      if (b.year_month === null && !byCategory.has(b.category)) byCategory.set(b.category, b.amount);
      if (b.year_month === month) byCategory.set(b.category, b.amount);
    }
    const budget = [...byCategory.values()].reduce((s, v) => s + v, 0);
    return { spent, unclassified, budget: budget > 0 ? budget : null };
  }, [tx.rows, budgets.rows, month]);

  // ------------------------------------------------------------ 資産
  const assets = useMemo(() => {
    /*
     * 【一番新しく残高を入れた月で出す】
     * 今月の残高をまだ入れていない月初に「純資産 0円」と出ると、
     * 資産が消えたように見える。入っている中で一番新しい月を使い、
     * その月をラベルに書く(いつの数字なのかが分からないほうが困る)。
     */
    /*
     * 【ローンは差し引かない】。AssetsScreen と同じ規則にする。
     *
     * 住んでいる家を資産として記録していないので、家の価値を足さずに
     * ローンだけ引くと「家を買った瞬間に数千万円損した」という数字になる。
     * ここで素直に「資産 − 負債」と書くと、ホームと資産画面で
     * **同じ名前の数字が違う値になる。** 使い方(help-content.ts)にも
     * 「ローンは純資産に含めていません」と書いてあるので、そちらに合わせる。
     *
     * どれをローンとみなすかは分類の文字で決めるところまで同じ。
     * 片方だけ直すと、また食い違う。
     */
    const isLoan = (a: { category: string | null }) => (a.category ?? "").includes("ローン");
    const countable = new Map(
      accounts.rows
        .filter((a) => a.active && !(a.kind === "負債" && isLoan(a)))
        .map((a) => [a.id, a.kind]),
    );
    const months = [...new Set(balances.rows.map((b) => b.year_month))].sort();
    const latest = months[months.length - 1] ?? null;
    if (!latest) return { net: null, month: null };
    let net = 0;
    for (const b of balances.rows) {
      if (b.year_month !== latest) continue;
      const kind = countable.get(b.account_id);
      if (kind === "資産") net += b.amount;
      else if (kind === "負債") net -= b.amount;
    }
    return { net, month: latest };
  }, [accounts.rows, balances.rows]);

  // ------------------------------------------------------------ 健康
  const health = useMemo(() => {
    /*
     * BMI の目標帯は lib/health.ts の既定値を使う。
     * ホームでは health_targets を読まない(表を1つ増やすほどの用が無い)ので、
     * ここだけ 21〜25 を書き写さないこと。書き写すと、表を直したときに
     * ホームだけ古い基準で色が付き、健康タブと食い違う。
     */
    const band = DEFAULT_TARGETS.bmi;
    const people = profiles.rows.map((p) => {
      const todayRow = vitals.rows.find((v) => v.member === p.member && v.date === today);
      const w = todayRow?.weight_kg != null ? Number(todayRow.weight_kg) : null;
      const b = bmi(w, p.height_cm != null ? Number(p.height_cm) : null);
      const judge = bmiState(b, band.min ?? 21, band.max ?? 25);
      return {
        member: p.member,
        weight: w,
        bmiValue: b,
        note: w == null ? "今日はまだ" : judge.note,
        ok: w != null && judge.signal === "満たしている",
      };
    });
    // 期限が近い・過ぎている検診。**ここが健康の機能で一番効くところ**なので、
    // 健康タブへ行かなくてもホームで気づけるようにする。
    const due = profiles.rows.flatMap((p) =>
      SCREENING_PLANS.map((plan) =>
        screeningStatus(plan, p, screenings.rows.find((s) => s.member === p.member && s.kind === plan.kind), today),
      )
        .filter((s) => s.state === "受ける時期" || s.state === "期限が過ぎている")
        .map((s) => ({ member: p.member, kind: s.plan.kind })),
    );
    return { people, due };
  }, [profiles.rows, vitals.rows, screenings.rows, today]);

  /**
   * 今日の候補。
   *
   * 【3つの条件で絞る】
   *   1. いまの在庫と常備品だけで作れる(買い物に行かずに済む)
   *   2. 直近14日に作っていない(同じものが続かない)
   *   3. **短い順**に出す。本人の指示で時短を優先する
   *
   * 材料が1行も登録されていないレシピは候補にしない。
   * 「作れる」とも「足りない」とも言えないものを勧めると、台所で分かる。
   */
  const candidates = useMemo(() => {
    const shortfall = missingByRecipe(ingredients.rows, inventorySnapshot.items, pantry.rows);
    const since = addDays(today, -14);
    const recent = new Set(
      cookLogs.rows
        .filter((l) => l.date >= since)
        .flatMap((l) => [l.recipe_id != null ? `id:${l.recipe_id}` : null, l.name ? `name:${l.name}` : null])
        .filter((k): k is string => k !== null),
    );
    return recipes.rows
      .filter((r) => {
        const s = shortfall.get(r.id);
        if (!s || s.total === 0 || s.missing > 0) return false;
        return !recent.has(`id:${r.id}`) && !recent.has(`name:${r.name}`);
      })
      .sort((a, b) => (a.time_min ?? 999) - (b.time_min ?? 999))
      .slice(0, 3);
  }, [recipes.rows, ingredients.rows, pantry.rows, cookLogs.rows, inventorySnapshot.items, today]);

  const remaining = session.items.filter((i) => i.status === "未購入").length;
  const weekday = WEEKDAY_LABELS[weekdayOf(today)];

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="くらし"
        subtitle={
          <span>
            {Number(today.slice(5, 7))}月{Number(today.slice(8, 10))}日
            <span className="ml-1.5 text-lg font-medium text-neutral-500">({weekday})</span>
          </span>
        }
        right={
          <Link
            href="/help"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            使い方
          </Link>
        }
      />

      {session.authExpired && (
        <Link
          href="/login"
          className="mx-4 mt-3 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
        >
          ログインの期限が切れています
          <span className="font-bold underline">入り直す</span>
        </Link>
      )}

      {/* 【一番上に出す】検診の期限は、月単位で遅れても取り返しがつきにくい */}
      {health.due.length > 0 && (
        <Link
          href="/health/checkups"
          className="mx-4 mt-3 flex items-center justify-between rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:bg-rose-950/50 dark:text-rose-200"
        >
          <span className="min-w-0">
            <b>受ける時期の検診が {health.due.length} 件</b>
            <span className="block truncate text-xs">
              {health.due.map((d) => `${d.member}: ${d.kind}`).join(" / ")}
            </span>
          </span>
          <span className="ml-2 shrink-0 font-bold">›</span>
        </Link>
      )}

      <div className="space-y-3 px-4 pt-3">
        <GenreLabel>今日</GenreLabel>

        {/* ---------------------------------------------- 今日の予定 */}
        <Card href="/plan" title="今日の予定" more="カレンダー">
          {todayEvents.length === 0 ? (
            <Empty>予定なし</Empty>
          ) : (
            <ul className="pb-2">
              {todayEvents.map((e) => {
                const style = tagStyle(tagById.get(e.tag_id ?? -1), e.label);
                return (
                  <li key={e.id}>
                    {/* 【行ごと押せるようにする】文字だけを的にすると、歩きながらでは当たらない */}
                    <Link
                      href="/plan"
                      className="flex min-h-12 items-center gap-2 px-4 py-1.5 active:bg-neutral-100 dark:active:bg-neutral-800"
                    >
                      <span className={`size-2.5 shrink-0 rounded-full ${style.bar}`} />
                      <span className="w-11 shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                        {e.start_time ? e.start_time.slice(0, 5) : "終日"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                      <span className="shrink-0 text-neutral-300 dark:text-neutral-600">›</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ---------------------------------------------- 今日の献立 */}
        <Card href="/plan" title="今日の献立" more="決める">
          {todayMeals.length === 0 ? (
            <Empty>まだ決めていない</Empty>
          ) : (
            <ul className="pb-2">
              {todayMeals.map((m) => (
                <li key={m.id}>
                  {/*
                    【献立から作り方へ、1タップで飛べるようにする】
                    台所で開くのはここ。以前は文字が並んでいるだけで、レシピを開くには
                    献立を見て名前を覚え、レシピタブへ行って探し直す必要があった。
                    レシピが結び付いていない献立(名前だけ手で入れたもの)はカレンダーへ送る。
                  */}
                  <Link
                    href={m.recipe_id != null ? `/recipes/${m.recipe_id}` : "/plan"}
                    className="flex min-h-12 items-center gap-2 px-4 py-1.5 text-sm active:bg-neutral-100 dark:active:bg-neutral-800"
                  >
                    <span className="w-11 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{m.slot}</span>
                    <span className="min-w-0 flex-1 truncate">{m.name ?? "(未定)"}</span>
                    {m.status === "実施" && (
                      <span className="shrink-0 text-[10px] font-bold text-emerald-600">作った</span>
                    )}
                    <span className="shrink-0 text-neutral-300 dark:text-neutral-600">
                      {m.recipe_id != null ? "›" : "…"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ---------------------------------------------- 今日の候補 */}
        <Card href="/recipes" title="今日の候補" more="レシピ">
          {candidates.length === 0 ? (
            <Empty>
              いまの在庫だけで作れて、この2週間に作っていないものはありません
            </Empty>
          ) : (
            <ul className="pb-2">
              {candidates.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/recipes/${r.id}`}
                    className="flex min-h-12 items-center gap-2 px-4 py-1.5 active:bg-neutral-100 dark:active:bg-neutral-800"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                    {r.time_min != null && (
                      <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                        {r.time_min}分
                      </span>
                    )}
                    <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                      いま作れる
                    </span>
                    <span className="shrink-0 text-neutral-300 dark:text-neutral-600">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ---------------------------------------------- 健康 */}
        <GenreLabel>健康</GenreLabel>
        <Card href="/health" title="体重" more="健康">
          {health.people.length === 0 ? (
            <Empty>
              まだ始めていません(supabase/19_health.sql を実行すると使えます)
            </Empty>
          ) : (
            <ul className="px-4 pb-3.5">
              {health.people.map((p) => (
                <li key={p.member} className="flex items-baseline gap-2 py-1.5">
                  <span className="w-6 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{p.member}</span>
                  <span className="text-lg font-bold tabular-nums">
                    {p.weight != null ? `${p.weight.toFixed(1)}kg` : "—"}
                  </span>
                  {p.bmiValue != null && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">BMI {p.bmiValue}</span>
                  )}
                  <span
                    className={`ml-auto shrink-0 text-[11px] ${
                      p.weight == null
                        ? "text-neutral-400 dark:text-neutral-500"
                        : p.ok
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {p.note}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ---------------------------------------------- くらし */}
        <GenreLabel>くらし</GenreLabel>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            href="/shopping"
            label="買い物"
            value={remaining === 0 ? "なし" : `残り ${remaining}`}
            tone={remaining > 0 ? "emerald" : "plain"}
          />
          <StatCard
            href="/plan/todos"
            label="やること"
            value={openTodos.count === 0 ? "なし" : `${openTodos.count} 件`}
            note={openTodos.overdue > 0 ? `期限切れ ${openTodos.overdue}` : undefined}
            tone={openTodos.overdue > 0 ? "rose" : "plain"}
          />
          <StatCard
            href="/plan/chores"
            label="今日の家事"
            value={todayChores.total === 0 ? "なし" : `${todayChores.done}/${todayChores.total}`}
            tone={todayChores.total > 0 && todayChores.done < todayChores.total ? "amber" : "plain"}
          />
          <StatCard
            href="/inventory"
            label="期限が近い"
            value={expiring.length === 0 ? "なし" : `${expiring.length} 件`}
            note={expiring[0]?.name}
            tone={expiring.length > 0 ? "rose" : "plain"}
          />
        </div>

        {/* ---------------------------------------------- お金 */}
        <GenreLabel>お金</GenreLabel>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            href="/spending"
            label={`${Number(month.slice(5))}月の支出`}
            value={yen(money.spent)}
            note={
              money.budget != null
                ? money.spent > money.budget
                  ? `予算を ${yen(money.spent - money.budget)} 超過`
                  : `予算まで ${yen(money.budget - money.spent)}`
                : "予算は未設定"
            }
            tone={money.budget != null && money.spent > money.budget ? "rose" : "plain"}
          />
          <StatCard
            href="/spending"
            label="振り分け待ち"
            value={money.unclassified === 0 ? "なし" : `${money.unclassified} 件`}
            note={money.unclassified > 0 ? "夫婦/夫/妻 を決める" : undefined}
            tone={money.unclassified > 0 ? "amber" : "plain"}
          />
          <StatCard
            href="/spending/assets"
            label="純資産"
            value={assets.net == null ? "未入力" : yen(assets.net)}
            // 【いつの数字かを必ず書く】。月初は先月の残高が出ているため
            note={assets.month ? `${Number(assets.month.slice(5))}月末・ローンは除く` : "残高を入れると出ます"}
            tone="plain"
          />
          <StatCard href="/spending/investments" label="投資" value="保有と監視" note="銘柄の一覧へ" tone="plain" />
        </div>

        {/*
          ---------------------------------------------- ほかの画面

          【画面の一覧をここに持たない】
          以前はここに11行の一覧を置いていた。画面が増えるたびに足す場所が
          ここと使い方の2か所になり、片方が古くなる。しかもレシートの明細や
          作った記録のように「入っているのに見る画面が無い」記録は、
          画面の一覧である以上どこにも出てこなかった。
          /records に【記録の目録】を作って、そちらを正本にしてある。
        */}
        <GenreLabel>ほかの画面</GenreLabel>
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <ul>
            <NavRow
              href="/records"
              title="記録"
              desc="残っている記録の全部。健康診断・作った記録・レシートの明細もここから"
            />
            <NavRow href="/recipes/ask" title="AIに相談する" desc="献立を相談して、レシピを登録する" />
            <NavRow href="/handoff" title="チャットから取り込む" desc="Cowork の結果を貼り付けて記録する" />
            <NavRow href="/help" title="使い方" desc="困ったときはここ" last />
          </ul>
        </section>

        {session.signedIn && (
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-12 w-full rounded-2xl border border-neutral-200 bg-white text-sm text-neutral-500 active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:active:bg-neutral-800"
          >
            サインアウト
          </button>
        )}
      </div>
    </main>
  );
}

/**
 * ジャンルの見出し。
 *
 * カードだけを縦に並べると、どこまでが「今日のこと」でどこからが「お金の話」なのかが
 * 読み取れず、全部が同じ重さで目に入る。見出しがあると、探しているジャンルまで
 * 一気に目を飛ばせる。カードそのものより小さく、薄く出すこと(主役はカード)。
 */
function GenreLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 pt-1 text-xs font-bold tracking-wide text-neutral-500 dark:text-neutral-400">
      {children}
    </h2>
  );
}

function Card({
  href,
  title,
  more,
  children,
}: {
  href: string;
  title: string;
  more: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <Link href={href} className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <h3 className="text-sm font-bold">{title}</h3>
        <span className="text-xs text-neutral-400">{more} ›</span>
      </Link>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pb-4 text-sm text-neutral-400 dark:text-neutral-600">{children}</p>;
}

/** 数字を1つだけ大きく出すカード。押すとその画面へ飛ぶ。 */
function StatCard({
  href,
  label,
  value,
  note,
  tone,
}: {
  href: string;
  label: string;
  value: string;
  note?: string;
  tone: "plain" | "emerald" | "amber" | "rose";
}) {
  // 色だけで意味を持たせない。数字と文字を必ず添える。
  const toneClass = {
    plain: "text-neutral-900 dark:text-neutral-100",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
  }[tone];

  return (
    <Link
      href={href}
      className="flex min-h-[5.5rem] flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-3.5 active:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:active:bg-neutral-800"
    >
      <span className="text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
      {/* 金額は3桁区切りで長くなる。折り返さずに縮めて、カードの高さを揃える */}
      <span className={`truncate text-xl font-bold tabular-nums ${toneClass}`}>{value}</span>
      {note && (
        <span className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">{note}</span>
      )}
    </Link>
  );
}

function NavRow({
  href,
  title,
  desc,
  last,
}: {
  href: string;
  title: string;
  desc: string;
  last?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={`flex h-14 items-center justify-between px-4 active:bg-neutral-100 dark:active:bg-neutral-800 ${
          last ? "" : "border-b border-neutral-100 dark:border-neutral-800"
        }`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
            {desc}
          </span>
        </span>
        <span className="ml-2 shrink-0 text-neutral-300 dark:text-neutral-600">›</span>
      </Link>
    </li>
  );
}
