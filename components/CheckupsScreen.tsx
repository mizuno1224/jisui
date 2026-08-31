"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { formatDate, todayISO } from "@/lib/dates";
import {
  DUE_STYLE,
  INFECTION_CHECKS,
  MEMBERS,
  SCREENING_PLANS,
  VACCINE_PLANS,
  ageOn,
  nextDueAfter,
  screeningStatus,
  type HealthProfile,
  type Member,
  type Screening,
  type Vaccination,
} from "@/lib/health";
import { saveScreening, saveTodo, saveVaccination } from "@/lib/mutations";
import { useTable } from "@/lib/use-table";
import type { Todo } from "@/lib/types";

/**
 * 検診・予防接種。
 *
 * 【この画面が、健康の機能で長期的に一番効く】
 * 食事の最適化より、大腸がん検診を毎年受けるほうが寿命への効果は大きい。
 * だから「受けた日を入れるだけで次回が決まる」ことに全部を寄せてある。
 *
 * 期限は生年月日から自動で出る。受けたことがなければ
 * 「対象年齢になる日」が期限になり、そこを過ぎていれば赤く出る。
 *
 * 【勝手に「やること」を作らない】
 * 依頼書は「対象年齢に達する年に自動でやることを立てる」ことを望んでいて、
 * それが値打ちだという指摘はそのとおりである。ただし画面を開いただけで
 * 行が増えると、開くたびに増えていないかを人が疑うことになるし、
 * 消した意思も次に開いた瞬間に踏み潰される。
 * そこで【1タップで立てられるボタン】にした。押した回数だけ立つので、
 * 何が起きたのかが目に見える。
 */

const NOTE = "このアプリは診断をしません。期限は目安です。気になるときは受診してください。";

export function CheckupsScreen() {
  const today = todayISO();
  const [member, setMember] = useState<Member>("夫");
  const [message, setMessage] = useState<string | null>(null);

  const profiles = useTable<HealthProfile>("health_profile");
  const screenings = useTable<Screening>("screening");
  const vaccines = useTable<Vaccination>("vaccination");
  const todos = useTable<Todo>("todos");

  const profile = profiles.rows.find((p) => p.member === member);
  const age = ageOn(profile?.birth_date ?? null, today);

  const rows = useMemo(() => {
    const mine = screenings.rows.filter((s) => s.member === member);
    return SCREENING_PLANS.map((plan) => ({
      plan,
      row: mine.find((r) => r.kind === plan.kind),
      status: screeningStatus(plan, profile, mine.find((r) => r.kind === plan.kind), today),
    })).sort((a, b) => {
      // 期限の近い順。対象外は最後に回す
      const rank = (s: string) => (s === "対象外" ? 1 : 0);
      const d = rank(a.status.state) - rank(b.status.state);
      return d !== 0 ? d : (a.status.daysLeft ?? 9e9) - (b.status.daysLeft ?? 9e9);
    });
  }, [screenings.rows, profile, member, today]);

  const say = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 3000);
  };

  const record = async (kind: string, doneOn: string, plan?: (typeof SCREENING_PLANS)[number]) => {
    try {
      // 次回の期限は lib/health.ts の nextDueAfter だけが決める。
      // ここで別に計算すると、画面に出ている期限と保存される期限がずれる。
      await saveScreening(member, kind, {
        last_done_on: doneOn,
        next_due_on: plan ? nextDueAfter(plan, doneOn) : null,
      });
      say(plan ? `${kind}を記録しました。次回は ${formatDate(nextDueAfter(plan, doneOn))} ごろ` : `${kind}を記録しました`);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
  };

  const makeTodo = async (title: string, dueDate: string | null) => {
    // 同じやることが既にあれば作らない。押し間違いで並ぶのを防ぐ
    if (todos.rows.some((t) => t.title === title && t.status === "open")) {
      say("同じやることが既にあります");
      return;
    }
    try {
      await saveTodo({ title, dueDate, detail: NOTE });
      say(`やることに入れました: ${title}`);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="健康"
        subtitle="検診・予防接種"
        right={
          <Link
            href="/health"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            もどる
          </Link>
        }
      >
        <div className="mt-2 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
          {MEMBERS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMember(m)}
              className={`h-10 flex-1 rounded-lg text-sm font-bold ${
                member === m ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
              }`}
            >
              {m}
              {age != null && member === m && (
                <span className="ml-1 text-xs font-normal text-neutral-500">{age}歳</span>
              )}
            </button>
          ))}
        </div>
      </ScreenHeader>

      {message && (
        <p className="mx-4 mt-3 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          {message}
        </p>
      )}

      <div className="space-y-3 px-4 pt-3">
        {!profile?.birth_date && (
          <Link
            href="/health"
            className="block rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
          >
            <b>{member}の生年月日</b>が入っていません。対象年齢も次回の期限も出せません。
            <span className="block text-xs">健康タブの「ふたりのこと」から入れてください ›</span>
          </Link>
        )}

        {/* -------------------------------------------------- がん検診 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">がん検診</h2>
          <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            対象年齢と間隔は国立がん研究センター がん情報サービスによります
          </p>
          <ul>
            {rows.map(({ plan, row, status }) => (
              <li key={plan.kind} className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-[15px] font-semibold">{plan.kind}</span>
                    <span className="ml-2 text-[11px] text-neutral-500 dark:text-neutral-400">{plan.note}</span>
                    <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                      {row?.last_done_on ? `前回 ${formatDate(row.last_done_on)}` : "受けた記録がありません"}
                      {status.dueOn && status.state !== "対象外" && ` ・ 次回 ${formatDate(status.dueOn)}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${DUE_STYLE[status.state]}`}>
                    {status.state}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                    受けた日
                    <input
                      type="date"
                      defaultValue={row?.last_done_on ?? ""}
                      onChange={(e) => e.target.value && void record(plan.kind, e.target.value, plan)}
                      className="h-9 rounded-lg border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-800"
                    />
                  </label>
                  {(status.state === "受ける時期" || status.state === "期限が過ぎている" || status.state === "もうすぐ") && (
                    <button
                      type="button"
                      onClick={() => void makeTodo(`${plan.kind}検診を受ける(${member})`, status.dueOn)}
                      className="h-9 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-bold text-white"
                    >
                      やることに入れる
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* -------------------------------------------------- 感染 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">感染</h2>
          <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            「日本人のためのがん予防法」の6番目。
            <b>間隔の出典が無いので、期限は自動で出しません。</b>受けた日だけ残します
          </p>
          <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <span className="text-[15px] font-semibold">ピロリ菌</span>
            <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold dark:bg-neutral-800">
              {profile?.piroli_status ?? "未検査"}
            </span>
            <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              陽性なら除菌。<Link href="/health" className="underline">ふたりのこと</Link>で状態を変えられます
            </p>
          </div>
          {INFECTION_CHECKS.filter((c) => c.kind !== "ピロリ菌検査").map((c) => {
            const row = screenings.rows.find((s) => s.member === member && s.kind === c.kind);
            return (
              <div key={c.kind} className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
                <span className="text-[15px] font-semibold">{c.kind}</span>
                <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                  {row?.last_done_on ? `受けた日 ${formatDate(row.last_done_on)}` : c.note}
                </p>
                <input
                  type="date"
                  defaultValue={row?.last_done_on ?? ""}
                  onChange={(e) => e.target.value && void record(c.kind, e.target.value)}
                  className="mt-2 h-9 rounded-lg border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-800"
                />
              </div>
            );
          })}
        </section>

        {/* -------------------------------------------------- 予防接種 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 pb-2 text-sm font-bold">予防接種</h2>
          <ul>
            {VACCINE_PLANS.map((v) => {
              const row = vaccines.rows.find((r) => r.member === member && r.kind === v.kind);
              const reached = v.startAge == null || (age != null && age >= v.startAge);
              return (
                <li key={v.kind} className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-[15px] font-semibold">{v.kind}</span>
                      <span className="ml-2 text-[11px] text-neutral-500 dark:text-neutral-400">{v.note}</span>
                      <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                        {row?.done_on ? `前回 ${formatDate(row.done_on)}` : "受けた記録がありません"}
                      </p>
                    </div>
                    {!reached && (
                      <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-500 dark:bg-neutral-800">
                        まだ対象外
                      </span>
                    )}
                  </div>
                  <input
                    type="date"
                    defaultValue={row?.done_on ?? ""}
                    onChange={(e) =>
                      e.target.value &&
                      void saveVaccination(member, v.kind, { done_on: e.target.value })
                        .then(() => say(`${v.kind}を記録しました`))
                        .catch((err) => say(err instanceof Error ? err.message : String(err)))
                    }
                    className="mt-2 h-9 rounded-lg border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-800"
                  />
                </li>
              );
            })}
          </ul>
        </section>

        <p className="px-1 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">{NOTE}</p>
      </div>
    </main>
  );
}
