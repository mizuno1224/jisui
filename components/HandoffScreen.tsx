"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  alreadyApplied,
  applyHandoff,
  describeRecord,
  parseHandoff,
  type Handoff,
} from "@/lib/handoff";

/**
 * チャット(Cowork)の結果を、貼り付けてアプリに取り込む画面。
 *
 * 【この画面がある理由】
 * チャットはクラウドで動くので Supabase に直接は届かない。
 * パソコン経由でファイルを渡す道も作ってあるが、
 * デスクトップアプリが起きている必要があり、スマホしか無いときに使えない。
 *
 * 人がコピーして貼るぶんには、どこからでも渡せる。
 * アプリはスマホからでも Supabase に届くので、これでパソコンが要らなくなる。
 */
export function HandoffScreen() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dupKeys, setDupKeys] = useState<string[]>([]);
  const [result, setResult] = useState<{
    ok: string[];
    skipped: string[];
    failed: { what: string; why: string }[];
  } | null>(null);

  const parsed = useMemo(() => (text.trim() ? parseHandoff(text) : null), [text]);
  const handoff: Handoff | null = parsed?.ok ? parsed.value : null;

  // 「この端末で入れ済みか」は IndexedDB を読むので非同期。
  // 効果の中で同期的に setState すると連鎖描画になるため、必ず解決後に入れる。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const keys = handoff ? await alreadyApplied(handoff) : [];
      if (alive) setDupKeys(keys);
    })();
    return () => {
      alive = false;
    };
  }, [handoff]);

  const run = async () => {
    if (!handoff) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await applyHandoff(handoff);
      setResult(r);
      if (r.failed.length === 0) setText("");
    } catch (e) {
      setResult({
        ok: [],
        skipped: [],
        failed: [{ what: "全体", why: e instanceof Error ? e.message : String(e) }],
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="チャットから"
        subtitle="貼り付けて取り込む"
        right={
          <Link
            href="/"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            ホーム
          </Link>
        }
      />

      <div className="space-y-4 px-4 pt-4">
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-bold">使いかた</h2>
          <ol className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300">
            <li>1. チャットでレシートを読ませたり、献立を相談したりする</li>
            <li>
              2. <strong>「受け渡し JSON を出して」</strong>と頼む
            </li>
            <li>3. 出てきた JSON をコピーして、下に貼る</li>
            <li>4. 中身を確かめて「取り込む」</li>
          </ol>
          <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            チャットはクラウドで動くため、データベースに直接は届きません。
            この画面が橋渡しをします。<strong>パソコンは要りません。</strong>
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={'{\n  "kind": "jisui-handoff",\n  "records": [ … ]\n}'}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-800"
          />

          {parsed && !parsed.ok && (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              {parsed.why}
            </p>
          )}

          {handoff && (
            <div className="mt-3">
              <p className="text-xs font-bold">
                これから入れるもの({handoff.records.length} 件)
              </p>
              {handoff.note && (
                <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  覚書: {handoff.note}
                </p>
              )}
              <ul className="mt-1.5 space-y-1">
                {handoff.records.map((r, i) => {
                  const dup = r.key != null && dupKeys.includes(r.key);
                  return (
                    <li
                      key={r.key ?? i}
                      className={`rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
                        dup
                          ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                          : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                      }`}
                    >
                      {describeRecord(r)}
                      {dup && <span className="ml-1 font-bold">— この端末で入れ済み。飛ばします</span>}
                    </li>
                  );
                })}
              </ul>

              <button
                type="button"
                onClick={() => void run()}
                disabled={busy}
                className="mt-3 h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
              >
                {busy ? "取り込み中…" : "取り込む"}
              </button>
            </div>
          )}
        </section>

        {result && (
          <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-sm font-bold">結果</h2>
            <p className="mt-1 text-xs">
              入った {result.ok.length} 件 / 飛ばした {result.skipped.length} 件 / 失敗{" "}
              {result.failed.length} 件
            </p>

            {result.ok.length > 0 && (
              <ul className="mt-2 space-y-1">
                {result.ok.map((t, i) => (
                  <li
                    key={i}
                    className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                  >
                    ✅ {t}
                  </li>
                ))}
              </ul>
            )}
            {result.skipped.length > 0 && (
              <ul className="mt-2 space-y-1">
                {result.skipped.map((t, i) => (
                  <li
                    key={i}
                    className="rounded-lg bg-neutral-100 px-3 py-2 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    — {t}
                  </li>
                ))}
              </ul>
            )}
            {result.failed.length > 0 && (
              <>
                <ul className="mt-2 space-y-1">
                  {result.failed.map((f, i) => (
                    <li
                      key={i}
                      className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                    >
                      ❌ {f.what}
                      <br />
                      {f.why}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  失敗したものは<strong>入っていません</strong>。貼り付けた文章はそのまま
                  残してあるので、直してからもう一度押してください。
                  入ったものは飛ばされるので、二重にはなりません。
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
