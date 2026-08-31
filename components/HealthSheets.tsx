"use client";

import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { formatDate } from "@/lib/dates";
import {
  DRINK_PRESETS,
  MEMBERS,
  formatHours,
  sleepHours,
  type ActivityLog,
  type AlcoholLog,
  type HealthProfile,
  type Member,
  type SleepLog,
  type Vitals,
} from "@/lib/health";
import {
  saveActivity,
  saveAlcohol,
  saveHealthProfile,
  saveSleep,
  saveVitals,
} from "@/lib/mutations";

/*
 * 健康の入力。
 *
 * 【設計の芯は「入力させないこと」】
 * 健康アプリが続かない理由はただ一つ、入力が面倒だから。
 * 機能を増やすより入力回数を減らすほうを常に優先する。
 *
 *   体重 … 前回値から始まるスピナー。動かさず保存すれば1タップ
 *   睡眠 … 就寝と起床の2つだけ。翌朝まとめて入れられる
 *   飲酒 … プリセットを押すだけ。休肝日は専用のボタン1つ
 *
 * 野菜量と塩分の欄はここに無い。**献立から自動で出る**ので入力させない。
 */

// ------------------------------------------------------------ 共通の部品

function SheetHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{note}</p>}
    </div>
  );
}

function SaveRow({
  saving,
  error,
  onSave,
  onClose,
  label = "保存する",
}: {
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
  label?: string;
}) {
  return (
    <>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-12 flex-1 rounded-xl border border-neutral-200 text-sm font-bold text-neutral-500 dark:border-neutral-700"
        >
          やめる
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="h-12 flex-[2] rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "保存中…" : label}
        </button>
      </div>
    </>
  );
}

/** 保存の作法を1か所に。どのシートも「押す→閉じる」か「理由を出す」しかしない。 */
function useSaving(onDone: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    void (async () => {
      try {
        await fn();
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    })();
  };
  return { saving, error, run };
}

const inputClass =
  "h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="text-xs font-bold text-neutral-500 dark:text-neutral-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

/** 空欄は null。0 と「入れていない」を混ぜない。 */
const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

// ---------------------------------------------------------------- 体重

export function WeightSheet({
  date,
  member,
  today,
  previous,
  onClose,
}: {
  date: string;
  member: Member;
  today: Vitals | undefined;
  /** 直近の記録。今日の欄が空のとき、ここから始める */
  previous: Vitals | undefined;
  onClose: () => void;
}) {
  const start = today?.weight_kg ?? previous?.weight_kg ?? null;
  const [weight, setWeight] = useState<number | null>(start);
  const [fat, setFat] = useState(today?.body_fat_pct?.toString() ?? "");
  const { saving, error, run } = useSaving(onClose);

  /*
   * 【前回値から始めるスピナー】
   * 数字を打たせない。体重は前回から 0.1〜0.5kg しか動かないので、
   * 前回値を初期値にすれば、動かさずに保存するだけで済む日が多い。
   * キーボードを出さずに済むぶん、続く。
   */
  const step = (delta: number) =>
    setWeight((w) => Math.round(((w ?? 60) + delta) * 10) / 10);

  return (
    <Sheet onClose={onClose}>
      <SheetHead
        title={`${member}の体重`}
        note={`${formatDate(date)}${start != null && today?.weight_kg == null ? " ・ 前回の値から始めています" : ""}`}
      />

      <div className="flex items-center justify-center gap-4 rounded-2xl bg-neutral-50 py-5 dark:bg-neutral-800/60">
        <button
          type="button"
          aria-label="0.1kg 減らす"
          onClick={() => step(-0.1)}
          className="flex size-14 items-center justify-center rounded-full bg-white text-2xl font-bold text-neutral-700 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
        >
          −
        </button>
        <span className="w-32 text-center text-4xl font-bold tabular-nums">
          {weight?.toFixed(1) ?? "—"}
          <span className="ml-1 text-base font-medium text-neutral-500">kg</span>
        </span>
        <button
          type="button"
          aria-label="0.1kg 増やす"
          onClick={() => step(0.1)}
          className="flex size-14 items-center justify-center rounded-full bg-white text-2xl font-bold text-neutral-700 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
        >
          ＋
        </button>
      </div>
      <div className="mt-2 flex justify-center gap-2">
        {[-1, -0.5, 0.5, 1].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => step(d)}
            className="h-9 rounded-full bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
      </div>

      <Field label="体脂肪率(%)・入れなくてよい">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={fat}
          onChange={(e) => setFat(e.target.value)}
          className={inputClass}
        />
      </Field>

      <SaveRow
        saving={saving}
        error={error}
        onClose={onClose}
        onSave={() =>
          run(() => saveVitals(date, member, { weight_kg: weight, body_fat_pct: num(fat) }))
        }
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------- 睡眠

const REST_LABELS = ["1 だるい", "2", "3 ふつう", "4", "5 すっきり"];

export function SleepSheet({
  date,
  member,
  row,
  previous,
  onClose,
}: {
  date: string;
  member: Member;
  row: SleepLog | undefined;
  previous: SleepLog | undefined;
  onClose: () => void;
}) {
  // 就寝・起床の時刻はほぼ毎日同じなので、前日の値から始める
  const [bed, setBed] = useState(row?.bedtime?.slice(0, 5) ?? previous?.bedtime?.slice(0, 5) ?? "23:00");
  const [wake, setWake] = useState(row?.wake_time?.slice(0, 5) ?? previous?.wake_time?.slice(0, 5) ?? "06:30");
  const [rest, setRest] = useState<number | null>(row?.rest_feeling ?? null);
  const { saving, error, run } = useSaving(onClose);

  const hours = sleepHours(bed, wake);

  return (
    <Sheet onClose={onClose}>
      <SheetHead title={`${member}の睡眠`} note={`${formatDate(date)}に起きたぶん。翌朝まとめて入れてよい`} />

      <div className="flex items-end gap-2">
        <Field label="寝た時刻">
          <input type="time" value={bed} onChange={(e) => setBed(e.target.value)} className={inputClass} />
        </Field>
        <Field label="起きた時刻">
          <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <p className="mt-2 text-center text-sm font-bold tabular-nums">{formatHours(hours)}</p>

      {/*
       * 【睡眠休養感】
       * 厚労省の睡眠ガイドは、時間だけでなくこの主観指標を重視している。
       * 「6時間寝たが休まっていない」を拾えないと、時間だけの管理になる。
       */}
      <p className="mt-4 text-xs font-bold text-neutral-500 dark:text-neutral-400">
        睡眠休養感(起きたときに休まった感じ)
      </p>
      <div className="mt-1.5 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRest(rest === n ? null : n)}
            className={`h-12 flex-1 rounded-xl text-xs font-bold ${
              rest === n
                ? "bg-emerald-600 text-white"
                : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {REST_LABELS[n - 1]}
          </button>
        ))}
      </div>

      <SaveRow
        saving={saving}
        error={error}
        onClose={onClose}
        onSave={() =>
          // hours は生成列なので送らない。DB が同じ式で計算する
          run(() => saveSleep(date, member, { bedtime: bed, wake_time: wake, rest_feeling: rest }))
        }
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------- 活動

export function ActivitySheet({
  date,
  member,
  row,
  onClose,
}: {
  date: string;
  member: Member;
  row: ActivityLog | undefined;
  onClose: () => void;
}) {
  const [steps, setSteps] = useState(row?.steps?.toString() ?? "");
  const [active, setActive] = useState(row?.active_minutes?.toString() ?? "");
  const [exercise, setExercise] = useState(row?.exercise_minutes?.toString() ?? "");
  const [strength, setStrength] = useState(row?.strength_training ?? false);
  const { saving, error, run } = useSaving(onClose);

  return (
    <Sheet onClose={onClose}>
      <SheetHead
        title={`${member}の活動`}
        note="iPhoneの「ショートカット」から自動で入れる道は、まだ用意していません"
      />

      <Field label="歩数">
        <input type="number" inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value)} className={inputClass} />
      </Field>
      <Field label="身体活動(分)・3メッツ以上。速歩き・掃除・階段など">
        <input type="number" inputMode="numeric" value={active} onChange={(e) => setActive(e.target.value)} className={inputClass} />
      </Field>
      <Field label="うち運動(分)・息が弾む程度">
        <input type="number" inputMode="numeric" value={exercise} onChange={(e) => setExercise(e.target.value)} className={inputClass} />
      </Field>

      <button
        type="button"
        onClick={() => setStrength((v) => !v)}
        className={`mt-4 flex h-12 w-full items-center justify-between rounded-xl px-4 text-sm font-bold ${
          strength ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
        }`}
      >
        筋トレをした
        <span className="text-xs font-normal">{strength ? "はい" : "いいえ"}</span>
      </button>

      <SaveRow
        saving={saving}
        error={error}
        onClose={onClose}
        onSave={() =>
          run(() =>
            saveActivity(date, member, {
              steps: num(steps),
              active_minutes: num(active),
              exercise_minutes: num(exercise),
              strength_training: strength,
            }),
          )
        }
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------- 飲酒

export function AlcoholSheet({
  date,
  member,
  row,
  onClose,
}: {
  date: string;
  member: Member;
  row: AlcoholLog | undefined;
  onClose: () => void;
}) {
  const [grams, setGrams] = useState(row?.pure_alcohol_g ?? 0);
  const [memo, setMemo] = useState(row?.drinks_memo ?? "");
  const { saving, error, run } = useSaving(onClose);

  const add = (d: (typeof DRINK_PRESETS)[number]) => {
    setGrams((g) => Math.round((g + d.g) * 10) / 10);
    setMemo((m) => (m ? `${m} / ${d.label}` : d.label));
  };

  return (
    <Sheet onClose={onClose}>
      <SheetHead title={`${member}の飲酒`} note={`${formatDate(date)}・押すたびに足していきます`} />

      <p className="text-center text-4xl font-bold tabular-nums">
        {grams}
        <span className="ml-1 text-base font-medium text-neutral-500">g</span>
      </p>
      <p className="mt-0.5 text-center text-[11px] text-neutral-500 dark:text-neutral-400">
        純アルコール量。1日23g未満が目安(がん予防法)
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {DRINK_PRESETS.map((d) => (
          <button
            key={d.label}
            type="button"
            onClick={() => add(d)}
            className="h-12 rounded-xl bg-neutral-100 px-2 text-xs font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            {d.label}
            <span className="ml-1 font-normal text-neutral-500">+{d.g}g</span>
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setGrams(0);
            setMemo("");
          }}
          className="h-12 flex-1 rounded-xl bg-emerald-50 text-sm font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
        >
          休肝日(0にする)
        </button>
      </div>

      <Field label="何を飲んだか">
        <input value={memo} onChange={(e) => setMemo(e.target.value)} className={inputClass} />
      </Field>

      <SaveRow
        saving={saving}
        error={error}
        onClose={onClose}
        onSave={() => run(() => saveAlcohol(date, member, { pure_alcohol_g: grams, drinks_memo: memo || null }))}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------- ふたりのこと

/**
 * 生年月日と身長。
 *
 * 【この2つが無いと機能の半分が動かない】
 * 生年月日 … がん検診の対象年齢と次回期限の計算に要る
 * 身長     … BMI に要る
 * だから健康画面の一番上で、空のあいだは案内を出し続ける。
 */
export function HealthProfileSheet({
  profiles,
  onClose,
}: {
  profiles: HealthProfile[];
  onClose: () => void;
}) {
  const [member, setMember] = useState<Member>("夫");
  const current = profiles.find((p) => p.member === member);
  const [birth, setBirth] = useState(current?.birth_date ?? "");
  const [sex, setSex] = useState<"男" | "女" | "">(current?.sex ?? "");
  const [height, setHeight] = useState(current?.height_cm?.toString() ?? "");
  const [smoking, setSmoking] = useState(current?.smoking ?? "吸わない");
  const [piroli, setPiroli] = useState(current?.piroli_status ?? "未検査");
  const { saving, error, run } = useSaving(onClose);

  // 人を切り替えたら、その人の値に入れ替える
  const switchTo = (m: Member) => {
    const p = profiles.find((x) => x.member === m);
    setMember(m);
    setBirth(p?.birth_date ?? "");
    setSex(p?.sex ?? "");
    setHeight(p?.height_cm?.toString() ?? "");
    setSmoking(p?.smoking ?? "吸わない");
    setPiroli(p?.piroli_status ?? "未検査");
  };

  return (
    <Sheet onClose={onClose}>
      <SheetHead title="ふたりのこと" note="検診の期限とBMIの計算に使います。ほかには使いません" />

      <div className="flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
        {MEMBERS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchTo(m)}
            className={`h-10 flex-1 rounded-lg text-sm font-bold ${
              member === m ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <Field label="生年月日(がん検診の対象年齢の計算に要ります)">
        <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} className={inputClass} />
      </Field>
      <Field label="性別(乳がん・子宮頸がん検診の対象を決めます)">
        <div className="flex gap-1.5">
          {(["男", "女"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSex(sex === s ? "" : s)}
              className={`h-12 flex-1 rounded-xl text-sm font-bold ${
                sex === s ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>
      <Field label="身長(cm)・BMI の計算に要ります">
        <input type="number" inputMode="decimal" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} className={inputClass} />
      </Field>
      <Field label="喫煙">
        <select value={smoking} onChange={(e) => setSmoking(e.target.value as typeof smoking)} className={inputClass}>
          <option>吸わない</option>
          <option>過去に吸っていた</option>
          <option>吸う</option>
        </select>
      </Field>
      <Field label="ピロリ菌(陽性なら除菌。1回で終わります)">
        <select value={piroli} onChange={(e) => setPiroli(e.target.value as typeof piroli)} className={inputClass}>
          <option>未検査</option>
          <option>陰性</option>
          <option>陽性</option>
          <option>除菌済</option>
        </select>
      </Field>

      <SaveRow
        saving={saving}
        error={error}
        onClose={onClose}
        onSave={() =>
          run(() =>
            saveHealthProfile(member, {
              birth_date: birth || null,
              sex: sex || null,
              height_cm: num(height),
              smoking,
              piroli_status: piroli,
            }),
          )
        }
      />
    </Sheet>
  );
}
