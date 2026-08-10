"use client";

import Link from "next/link";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { daysUntil, todayISO, weekdayOf, WEEKDAY_LABELS } from "@/lib/dates";
import { occursOn } from "@/lib/event-labels";
import { tagStyle } from "@/lib/tags";
import { getServerSnapshot, getSnapshot, init, signOut, subscribe } from "@/lib/store";
import {
  getServerSnapshot as invServerSnapshot,
  getSnapshot as invSnapshot,
  init as invInit,
  subscribe as invSubscribe,
} from "@/lib/inventory-store";
import { useTable } from "@/lib/use-table";
import type {
  CalendarEvent,
  CalendarTag,
  Chore,
  ChoreLog,
  MealPlan,
  Todo,
} from "@/lib/types";

/** 期限がこの日数以内なら「もうすぐ切れる」として数える。 */
const EXPIRY_SOON_DAYS = 3;

/**
 * ホーム。
 *
 * 【何のための画面か】
 * 2つある。
 *   1. 今日1日ぶんを1画面にまとめる。開いてすぐ「今日は何があるか」が分かる。
 *   2. 全部のページへの入口になる。タブは6つしか置けないが、
 *      画面は10以上ある。家事の設定・資産・投資・やること・タグ・使い方は
 *      どのタブの隅にあるか覚えていないと辿り着けなかった。ここに全部並べる。
 *
 * 【重い集計をしない】
 * 家計の合計や在庫の全件走査はしない。開いた瞬間に出ることを優先する。
 * 詳しく見たい人はタブへ行く。
 */
export function HomeScreen() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const today = todayISO();

  // 在庫は useTable ではなくストアから読む。
  // useTable が扱えるのは id が数値の表だけで、在庫は一時 id(文字列)を
  // 使うオフライン書き込み対応のため、専用ストアを持っている。
  const inventorySnapshot = useSyncExternalStore(
    invSubscribe,
    invSnapshot,
    invServerSnapshot,
  );

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

  const tagById = useMemo(
    () => new Map(tags.rows.map((t) => [t.id, t])),
    [tags.rows],
  );

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

      <div className="space-y-3 px-4 pt-3">
        {/* ---------------------------------------------- 今日の予定 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <Link href="/plan" className="flex items-center justify-between px-4 pt-3.5 pb-1">
            <h2 className="text-sm font-bold">今日の予定</h2>
            <span className="text-xs text-neutral-400">カレンダー ›</span>
          </Link>
          {todayEvents.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-neutral-400 dark:text-neutral-600">
              予定なし
            </p>
          ) : (
            <ul className="px-4 pb-3.5">
              {todayEvents.map((e) => {
                const style = tagStyle(tagById.get(e.tag_id ?? -1), e.label);
                return (
                  <li key={e.id} className="flex items-center gap-2 py-1.5">
                    <span className={`size-2.5 shrink-0 rounded-full ${style.bar}`} />
                    <span className="w-11 shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      {e.start_time ? e.start_time.slice(0, 5) : "終日"}
                    </span>
                    <span className="truncate text-sm">{e.title}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---------------------------------------------- 今日の献立 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <Link href="/plan" className="flex items-center justify-between px-4 pt-3.5 pb-1">
            <h2 className="text-sm font-bold">今日の献立</h2>
            <span className="text-xs text-neutral-400">決める ›</span>
          </Link>
          {todayMeals.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-neutral-400 dark:text-neutral-600">まだ決めていない</p>
          ) : (
            <ul className="px-4 pb-3.5">
              {todayMeals.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="w-11 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                    {m.slot}
                  </span>
                  <span className="truncate">{m.name ?? "(未定)"}</span>
                  {m.status === "実施" && (
                    <span className="ml-auto shrink-0 text-[10px] font-bold text-emerald-600">
                      作った
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------------------------------------------- 数字だけのカード */}
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
            value={
              todayChores.total === 0 ? "なし" : `${todayChores.done}/${todayChores.total}`
            }
            tone={
              todayChores.total > 0 && todayChores.done < todayChores.total ? "amber" : "plain"
            }
          />
          <StatCard
            href="/inventory"
            label="期限が近い"
            value={expiring.length === 0 ? "なし" : `${expiring.length} 件`}
            note={expiring[0]?.name}
            tone={expiring.length > 0 ? "rose" : "plain"}
          />
        </div>

        {/* ---------------------------------------------- 全ページへの入口 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 pb-1 text-sm font-bold">ほかの画面</h2>
          <ul>
            <NavRow href="/plan/todos" title="やること" desc="サブタスク・繰り返しつき" />
            <NavRow href="/plan/chores" title="家事の設定" desc="曜日ごと・毎月n日" />
            <NavRow href="/plan/tags" title="予定のタグ" desc="色分けと、非公開の設定" />
            <NavRow href="/spending/assets" title="資産と負債" desc="口座・ローン・給与" />
            <NavRow href="/spending/investments" title="投資" desc="保有銘柄・監視銘柄" />
            <NavRow href="/recipes" title="レシピ" desc="材料と在庫の突き合わせ" />
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
      <span className={`text-xl font-bold ${toneClass}`}>{value}</span>
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
