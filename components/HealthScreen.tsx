"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { WeightChart } from "@/components/WeightChart";
import {
  ActivitySheet,
  AlcoholSheet,
  HealthProfileSheet,
  SleepSheet,
  WeightSheet,
} from "@/components/HealthSheets";
import { addDays, formatDate, todayISO } from "@/lib/dates";
import {
  MEMBERS,
  SIGNAL_STYLE,
  SCREENING_PLANS,
  atLeast,
  atMost,
  bmi,
  bmiState,
  formatHours,
  metsHours,
  saltMax,
  screeningStatus,
  targetOf,
  type ActivityLog,
  type AlcoholLog,
  type HealthProfile,
  type HealthTarget,
  type Member,
  type Screening,
  type Signal,
  type SleepLog,
  type Vitals,
} from "@/lib/health";
import { useTable } from "@/lib/use-table";
import type { MealPlan, Recipe } from "@/lib/types";

/**
 * 健康。
 *
 * 【この画面の決まり】
 *   ・診断をしない。基準を外れたときも「目安から外れています」までに留める
 *   ・独自の健康スコアを作らない。出典のある基準だけを並べる
 *   ・**減量前提にしない。** 体重は目標「帯」で見せ、下回れば「増やす」と言う
 *   ・日単位で一喜一憂させない。ガイドの基準自体が週単位なので、週も必ず出す
 *   ・数字より「足りているか」が一目で分かること
 *
 * 【野菜と塩分の欄に入力が無い理由】
 * 献立から自動で出るため。レシピに veg_g / salt_g を持たせてあるので、
 * 献立を確定した時点でその日の値が決まる。埋まらない日は
 * 「まだ献立を確定していない日」だと読める。それも情報である。
 */

const PERSON_KEY = "jisui.health.member";

/*
 * どちらの人を見ているか。**端末ごとに覚える**(2台を2人で使うため)。
 *
 * 【effect の中で setState して読まない】
 * それをすると描き直しが連鎖するうえ、最初の1回だけ「夫」が見えてから
 * 「妻」に入れ替わるちらつきが出る。store.ts / inventory-store.ts と同じ
 * useSyncExternalStore の形にして、サーバ描画は既定値、
 * 手元に着いてから覚えている値を読む、という筋にする。
 */
let memberCache: Member | null = null;
const memberListeners = new Set<() => void>();

function getMember(): Member {
  if (memberCache === null) {
    try {
      const saved = localStorage.getItem(PERSON_KEY);
      memberCache = saved === "妻" ? "妻" : "夫";
    } catch {
      memberCache = "夫";
    }
  }
  return memberCache;
}

/** サーバ側では localStorage が無い。既定の「夫」で描いて、手元で入れ替える。 */
const getServerMember = (): Member => "夫";

function subscribeMember(fn: () => void) {
  memberListeners.add(fn);
  return () => memberListeners.delete(fn);
}

function chooseMember(m: Member) {
  memberCache = m;
  try {
    localStorage.setItem(PERSON_KEY, m);
  } catch {
    /* 覚えられなくても、この画面を開いているあいだは効く */
  }
  for (const fn of memberListeners) fn();
}

function useMember(): [Member, (m: Member) => void] {
  const member = useSyncExternalStore(subscribeMember, getMember, getServerMember);
  return [member, chooseMember];
}

type SheetKind = "体重" | "睡眠" | "活動" | "飲酒" | "ふたり" | null;

export function HealthScreen() {
  const today = todayISO();
  const [member, setMember] = useMember();
  const [sheet, setSheet] = useState<SheetKind>(null);

  const profiles = useTable<HealthProfile>("health_profile");
  const vitals = useTable<Vitals>("vitals", { orderBy: "date" });
  const sleep = useTable<SleepLog>("sleep_log", { orderBy: "date" });
  const activity = useTable<ActivityLog>("activity_log", { orderBy: "date" });
  const alcohol = useTable<AlcoholLog>("alcohol_log", { orderBy: "date" });
  const targets = useTable<HealthTarget>("health_targets");
  const screenings = useTable<Screening>("screening");
  const plans = useTable<MealPlan>("meal_plan");
  const recipes = useTable<Recipe>("recipes");

  /*
   * 【まだ SQL を流していないときに、壊れた画面を出さない】
   * 表そのものが無いと PostgREST は「そんな表は無い」と返す。
   * 空の健康画面を見せても何をすればよいか分からないので、
   * 流すべきファイル名を出す。これが無いと問い合わせになる。
   */
  const notInstalled = profiles.error != null && profiles.rows.length === 0;

  const profile = useMemo(
    () => profiles.rows.find((p) => p.member === member),
    [profiles.rows, member],
  );
  const myScreenings = useMemo(
    () => screenings.rows.filter((s) => s.member === member),
    [screenings.rows, member],
  );

  const vitalRows = useMemo(
    () => vitals.rows.filter((r) => r.member === member).sort((a, b) => a.date.localeCompare(b.date)),
    [vitals.rows, member],
  );
  const sleepRows = useMemo(
    () => sleep.rows.filter((r) => r.member === member).sort((a, b) => a.date.localeCompare(b.date)),
    [sleep.rows, member],
  );
  const activityRows = useMemo(
    () => activity.rows.filter((r) => r.member === member),
    [activity.rows, member],
  );
  const alcoholRows = useMemo(
    () => alcohol.rows.filter((r) => r.member === member),
    [alcohol.rows, member],
  );

  const todayVital = vitalRows.find((r) => r.date === today);
  const lastVital = [...vitalRows].reverse().find((r) => r.weight_kg != null);
  const todaySleep = sleepRows.find((r) => r.date === today);
  const lastSleep = sleepRows[sleepRows.length - 1];
  const todayActivity = activityRows.find((r) => r.date === today);
  const todayAlcohol = alcoholRows.find((r) => r.date === today);

  // ---------------------------------------------------------- 目標値
  const bmiTarget = targetOf(targets.rows, "bmi");
  const sleepTarget = targetOf(targets.rows, "sleep");
  const activeTarget = targetOf(targets.rows, "active");
  const stepsTarget = targetOf(targets.rows, "steps");
  const vegTarget = targetOf(targets.rows, "veg");
  const alcoholTarget = targetOf(targets.rows, "alcohol");
  const metsTarget = targetOf(targets.rows, "mets");
  const strengthTarget = targetOf(targets.rows, "strength");
  const saltLimit = saltMax(targets.rows, member, profile?.sex ?? null);

  // ------------------------------------------- 献立からの野菜量・塩分(入力ゼロ)
  const meal = useMemo(() => {
    const byId = new Map(recipes.rows.map((r) => [r.id, r]));
    const list = plans.rows.filter((p) => p.date === today && p.status !== "中止");
    let veg = 0;
    let salt = 0;
    let known = 0;
    for (const p of list) {
      const r = p.recipe_id != null ? byId.get(p.recipe_id) : undefined;
      // 【栄養が未登録のレシピを 0 として足さない】。足すと「野菜0g」と
      // 出てしまい、記録していないだけなのに目安を外したように見える。
      if (r && (r.veg_g != null || r.salt_g != null)) {
        veg += Number(r.veg_g ?? 0);
        salt += Number(r.salt_g ?? 0);
        known += 1;
      }
    }
    return { veg, salt, known, total: list.length, missing: list.length - known };
  }, [plans.rows, recipes.rows, today]);

  // ---------------------------------------------------------- 今週
  const week = useMemo(() => {
    const from = addDays(today, -6);
    const inRange = (d: string) => d >= from && d <= today;
    const acts = activityRows.filter((r) => inRange(r.date));
    const sleeps = sleepRows.filter((r) => inRange(r.date));
    const drinks = alcoholRows.filter((r) => inRange(r.date));
    const activeMin = acts.reduce((s, r) => s + (r.active_minutes ?? 0), 0);
    return {
      from,
      mets: metsHours(activeMin),
      strengthDays: acts.filter((r) => r.strength_training).length,
      sleepDays: sleeps.filter((r) => (r.hours ?? 0) >= (sleepTarget.min ?? 6)).length,
      sleepRecorded: sleeps.length,
      // 【記録のある日だけを分母にする】。行が無い日は「飲まなかった」ではなく
      // 「入れていない」。休肝日として数えると、使わないほど成績が良くなる。
      restDays: drinks.filter((r) => Number(r.pure_alcohol_g) === 0).length,
      drinkRecorded: drinks.length,
    };
  }, [activityRows, sleepRows, alcoholRows, today, sleepTarget.min]);

  // ---------------------------------------------------------- 検診の直近
  const nextCheckup = useMemo(
    () =>
      SCREENING_PLANS.map((plan) =>
        screeningStatus(plan, profile, myScreenings.find((r) => r.kind === plan.kind), today),
      )
        .filter((s) => s.state === "受ける時期" || s.state === "期限が過ぎている" || s.state === "もうすぐ")
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)),
    [myScreenings, profile, today],
  );

  // ---------------------------------------------------------- 今日の6つ
  const weight = todayVital?.weight_kg ?? null;
  const bmiValue = bmi(weight != null ? Number(weight) : null, profile?.height_cm != null ? Number(profile.height_cm) : null);
  const bmiJudge = bmiState(bmiValue, bmiTarget.min ?? 21, bmiTarget.max ?? 25);

  const chartPoints = vitalRows
    .filter((r) => r.weight_kg != null)
    .slice(-30)
    .map((r) => ({ date: r.date, weight: Number(r.weight_kg) }));

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="健康"
        subtitle={<>{formatDate(today)}</>}
        right={
          <button
            type="button"
            onClick={() => setSheet("ふたり")}
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            ふたりのこと
          </button>
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
            </button>
          ))}
        </div>
      </ScreenHeader>

      <div className="space-y-3 px-4 pt-3">
        {notInstalled && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            健康の表がまだありません。Supabase の SQL Editor で
            <b> supabase/19_health.sql </b>
            を実行してください。
          </p>
        )}

        {!notInstalled && (!profile?.birth_date || !profile?.height_cm) && (
          <button
            type="button"
            onClick={() => setSheet("ふたり")}
            className="w-full rounded-xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
          >
            <b>{member}の生年月日と身長</b>が入っていません。
            <span className="block text-xs">
              生年月日はがん検診の期限、身長は BMI に要ります。入れると出ます ›
            </span>
          </button>
        )}

        {/* ------------------------------------------------ 今日 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 pb-1 text-sm font-bold">今日</h2>
          <ul className="pb-1">
            <TodayRow
              label="体重"
              value={weight != null ? `${Number(weight).toFixed(1)}kg` : "—"}
              sub={bmiValue != null ? `BMI ${bmiValue}` : undefined}
              note={bmiJudge.note}
              signal={weight == null ? "記録がない" : bmiJudge.signal}
              onClick={() => setSheet("体重")}
            />
            <TodayRow
              label="睡眠"
              value={formatHours(todaySleep?.hours ?? null)}
              sub={todaySleep?.rest_feeling ? `休養感 ${todaySleep.rest_feeling}` : undefined}
              note={`${sleepTarget.min}時間以上が目安`}
              signal={atLeast(todaySleep?.hours ?? null, sleepTarget.min ?? 6)}
              onClick={() => setSheet("睡眠")}
            />
            <TodayRow
              label="歩数・活動"
              value={todayActivity?.steps != null ? `${todayActivity.steps.toLocaleString("ja-JP")}歩` : "—"}
              sub={todayActivity?.active_minutes != null ? `活動 ${todayActivity.active_minutes}分` : undefined}
              note={`3メッツ以上を1日${activeTarget.min}分以上・${stepsTarget.min?.toLocaleString("ja-JP")}歩`}
              signal={atLeast(todayActivity?.active_minutes ?? null, activeTarget.min ?? 60)}
              onClick={() => setSheet("活動")}
            />
            {/* 野菜と塩分は献立から。押しても入力欄は出ない(出す必要が無い) */}
            <TodayRow
              label="野菜"
              value={meal.known > 0 ? `${Math.round(meal.veg)}g` : "—"}
              sub={`目安 ${vegTarget.min}g`}
              note={
                meal.total === 0
                  ? "今日の献立がまだ決まっていません"
                  : meal.known === 0
                    ? `献立${meal.total}品とも栄養が未登録です`
                    : meal.missing > 0
                      ? `献立${meal.total}品のうち${meal.missing}品は栄養が未登録`
                      : "献立から自動で出しています"
              }
              signal={meal.known === 0 ? "記録がない" : atLeast(meal.veg, vegTarget.min ?? 350)}
              href="/plan"
            />
            <TodayRow
              label="塩分"
              value={meal.known > 0 ? `${meal.salt.toFixed(1)}g` : "—"}
              sub={`${saltLimit}g 未満`}
              note={meal.known === 0 ? "献立から自動で出します" : "献立から自動で出しています"}
              signal={meal.known === 0 ? "記録がない" : atMost(meal.salt, saltLimit)}
              href="/plan"
            />
            <TodayRow
              label="飲酒"
              value={todayAlcohol ? (Number(todayAlcohol.pure_alcohol_g) === 0 ? "休肝日" : `${todayAlcohol.pure_alcohol_g}g`) : "—"}
              sub={`${alcoholTarget.max}g 未満`}
              note={
                week.drinkRecorded > 0
                  ? `記録のある${week.drinkRecorded}日のうち休肝日 ${week.restDays}日`
                  : "この1週間の記録がありません"
              }
              signal={todayAlcohol ? atMost(Number(todayAlcohol.pure_alcohol_g), alcoholTarget.max ?? 23) : "記録がない"}
              onClick={() => setSheet("飲酒")}
              last
            />
          </ul>
        </section>

        {/* ------------------------------------------------ 今週 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">この7日</h2>
          <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            {formatDate(week.from)} 〜 {formatDate(today)}・
            <b>日ごとに一喜一憂しないこと。</b>ガイドの基準そのものが週単位です
          </p>
          <div className="grid grid-cols-2 gap-px bg-neutral-100 dark:bg-neutral-800">
            {/*
              【3メッツで数えていることを書く】
              活動を毎日60分やっても 60分x7日 = 7時間 x 3メッツ = 21 にしかならず、
              週23に届かない。ガイドの 3メッツ以上 の「以上」を切り捨てて
              いちばん低く見積もっているためで、速歩き(4)や掃除(3.5)を
              まじめに数えれば届く。何で数えたかを書かないと、
              毎日達成しているのに黄色が出る理由が分からない。
            */}
            <WeekCell
              label="身体活動"
              value={`${week.mets} / ${metsTarget.min}`}
              unit="メッツ・時(3メッツで計算)"
              signal={atLeast(week.mets, metsTarget.min ?? 23)}
            />
            <WeekCell
              label="筋トレ"
              value={`${week.strengthDays} / ${strengthTarget.min}`}
              unit="日"
              signal={atLeast(week.strengthDays, strengthTarget.min ?? 2)}
            />
            {/*
              【この2つに信号を出さない】
              「睡眠6時間以上」も「休肝日」も、1日あたりの目安には出典があるが、
              **週に何日ならよいかの出典は無い。** ここで線を引くと、それは
              出典のない独自基準になる。数だけを出して、判断は人に任せる。
            */}
            <WeekCell
              label={`睡眠${sleepTarget.min}時間以上`}
              value={week.sleepRecorded === 0 ? "—" : `${week.sleepDays} / ${week.sleepRecorded}`}
              unit={week.sleepRecorded === 0 ? "記録なし" : "日(記録のある日ぶん)"}
            />
            <WeekCell
              label="休肝日"
              value={week.drinkRecorded === 0 ? "—" : `${week.restDays} / ${week.drinkRecorded}`}
              unit={week.drinkRecorded === 0 ? "記録なし" : "日(記録のある日ぶん)"}
            />
          </div>
        </section>

        {/* ------------------------------------------------ 体重 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white pb-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
            <h2 className="text-sm font-bold">体重</h2>
            <button
              type="button"
              onClick={() => setSheet("体重")}
              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white"
            >
              今日の体重を入れる
            </button>
          </div>
          {chartPoints.length === 0 ? (
            <p className="px-4 pb-3 text-sm text-neutral-400 dark:text-neutral-600">
              まだ記録がありません。1タップで前回と同じ値を入れられます。
            </p>
          ) : (
            <>
              <p className="px-4 pb-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                緑の帯は <b>BMI {bmiTarget.min}〜{bmiTarget.max}</b>。
                {profile?.height_cm
                  ? "帯の中にいるかを見ます。下回っていれば増やすのが正解です。"
                  : "身長を入れると帯が出ます。"}
              </p>
              <WeightChart
                points={chartPoints}
                heightCm={profile?.height_cm != null ? Number(profile.height_cm) : null}
                bmiMin={bmiTarget.min ?? 21}
                bmiMax={bmiTarget.max ?? 25}
              />
            </>
          )}
        </section>

        {/* ------------------------------------------------ 検診 */}
        <Link
          href="/health/checkups"
          className="block overflow-hidden rounded-2xl border border-neutral-200 bg-white active:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
            <h2 className="text-sm font-bold">検診・予防接種</h2>
            <span className="text-xs text-neutral-400">一覧 ›</span>
          </div>
          {!profile?.birth_date ? (
            <p className="px-4 pb-3.5 text-sm text-neutral-400 dark:text-neutral-600">
              生年月日を入れると、対象年齢と次回の期限が出ます
            </p>
          ) : nextCheckup.length === 0 ? (
            <p className="px-4 pb-3.5 text-sm text-neutral-500 dark:text-neutral-400">
              いま期限が近いものはありません
            </p>
          ) : (
            <ul className="px-4 pb-3.5">
              {nextCheckup.slice(0, 3).map((s) => (
                <li key={s.plan.kind} className="flex items-center gap-2 py-1 text-sm">
                  <span className={`size-2.5 shrink-0 rounded-full ${s.state === "もうすぐ" ? "bg-amber-500" : "bg-rose-500"}`} />
                  <span className="truncate">{s.plan.kind}</span>
                  <span className="ml-auto shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                    {s.state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Link>

        {/* ------------------------------------------------ 健康診断
            検診(これから受ける)とは別に、受けた結果を置く画面への入口。
            【ここでは中身を読まない】。この画面は既に8つの表を読んでいる。
            最新の受診を出すために9つ目を足すほどの用は無く、
            件数と中身は /records と /health/exams が受け持つ。 */}
        <Link
          href="/health/exams"
          className="block overflow-hidden rounded-2xl border border-neutral-200 bg-white active:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
            <h2 className="text-sm font-bold">健康診断</h2>
            <span className="text-xs text-neutral-400">結果を見る ›</span>
          </div>
          <p className="px-4 pb-3.5 text-sm text-neutral-500 dark:text-neutral-400">
            健診・人間ドック・血液検査の結果と、年ごとの推移
          </p>
        </Link>

        {/* ------------------------------------------------ 出典 */}
        <details className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <summary className="cursor-pointer px-4 py-3.5 text-sm font-bold">
            この画面の基準と出典
          </summary>
          <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <p className="mb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              数値はすべて公的ガイドラインから取っています。
              <b>出典のない基準は置きません。</b>
            </p>
            <ul className="space-y-2">
              {(targets.rows.length > 0
                ? targets.rows.filter((t) => t.member === "共通" || t.member === member)
                : []
              ).map((t) => (
                <li key={`${t.key}-${t.member}`} className="text-xs">
                  <span className="font-bold">{t.label}</span>
                  <span className="ml-1.5 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {t.min_value != null && `${t.min_value}${t.unit ?? ""}以上`}
                    {t.min_value != null && t.max_value != null && " / "}
                    {t.max_value != null && `${t.max_value}${t.unit ?? ""}まで`}
                    {t.period && t.period !== "なし" && `(1${t.period})`}
                  </span>
                  <span className="block text-neutral-400 dark:text-neutral-500">{t.source}</span>
                </li>
              ))}
              {targets.rows.length === 0 && (
                <li className="text-xs text-neutral-400">
                  19_health.sql を流すと、出典つきの一覧がここに出ます。
                </li>
              )}
            </ul>
            <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
              このアプリは診断をしません。目安から外れていても、それは
              「気になるときは受診を」という意味です。
            </p>
          </div>
        </details>
      </div>

      {sheet === "体重" && (
        <WeightSheet date={today} member={member} today={todayVital} previous={lastVital} onClose={() => setSheet(null)} />
      )}
      {sheet === "睡眠" && (
        <SleepSheet date={today} member={member} row={todaySleep} previous={lastSleep} onClose={() => setSheet(null)} />
      )}
      {sheet === "活動" && (
        <ActivitySheet date={today} member={member} row={todayActivity} onClose={() => setSheet(null)} />
      )}
      {sheet === "飲酒" && (
        <AlcoholSheet date={today} member={member} row={todayAlcohol} onClose={() => setSheet(null)} />
      )}
      {sheet === "ふたり" && (
        <HealthProfileSheet profiles={profiles.rows} onClose={() => setSheet(null)} />
      )}
    </main>
  );
}

/**
 * 今日の1項目。
 *
 * 【色だけで意味を持たせない】。丸の色と一緒に、必ず言葉でも状態を書く。
 * 緑と橙は色覚特性で近く、台所の明るさでも見分けにくい。
 */
function TodayRow({
  label,
  value,
  sub,
  note,
  signal,
  onClick,
  href,
  last,
}: {
  label: string;
  value: string;
  sub?: string;
  note?: string;
  signal: Signal;
  onClick?: () => void;
  href?: string;
  last?: boolean;
}) {
  const style = SIGNAL_STYLE[signal];
  const body = (
    <>
      <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${style.dot}`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
          <span className="text-lg font-bold tabular-nums">{value}</span>
          {sub && <span className="text-xs text-neutral-500 dark:text-neutral-400">{sub}</span>}
        </span>
        <span className={`block text-[11px] ${style.text}`}>
          {signal === "記録がない" ? (note ?? "記録がありません") : `${signal}・${note ?? ""}`}
        </span>
      </span>
      <span className="shrink-0 self-center text-neutral-300 dark:text-neutral-600">›</span>
    </>
  );
  const cls = `flex w-full items-start gap-2.5 px-4 py-2.5 text-left active:bg-neutral-100 dark:active:bg-neutral-800 ${
    last ? "" : "border-b border-neutral-100 dark:border-neutral-800"
  }`;
  return (
    <li>
      {href ? (
        <Link href={href} className={cls}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={cls}>
          {body}
        </button>
      )}
    </li>
  );
}

/** signal を渡さないときは丸を描かない。出典のある基準がある項目にだけ付ける。 */
function WeekCell({
  label,
  value,
  unit,
  signal,
}: {
  label: string;
  value: string;
  unit: string;
  signal?: Signal;
}) {
  const style = signal ? SIGNAL_STYLE[signal] : null;
  return (
    <div className="bg-white px-4 py-3 dark:bg-neutral-900">
      <span className="flex items-center gap-1.5">
        {style && <span className={`size-2 shrink-0 rounded-full ${style.dot}`} />}
        <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">{label}</span>
      </span>
      <span className="mt-0.5 block text-lg font-bold tabular-nums">{value}</span>
      <span className="block text-[10px] text-neutral-400 dark:text-neutral-500">{unit}</span>
    </div>
  );
}
