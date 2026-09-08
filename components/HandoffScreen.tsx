"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  appliedFlags,
  applyHandoff,
  describeRecord,
  parseHandoff,
  type Handoff,
} from "@/lib/handoff";
import { buildHandoffPrompt } from "@/lib/handoff-prompt";
import { useTable } from "@/lib/use-table";
import type { ExpenseRule } from "@/lib/types";

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
  const params = useSearchParams();
  /*
   * URL に ?d=… が付いていたら、それを最初の中身にする。
   *
   * iPhone の「ショートカット」から、コピーした JSON を
   * このアドレスに付けて開けば、貼る操作が要らなくなる。
   * 長い文字列を載せるので base64 にしてある。
   *
   * 効果の中で setState せず、最初の値として渡す。
   * 効果で入れると、描画のあとにもう一度描画が走る。
   */
  const [text, setText] = useState(() => decodeParam(params.get("d")));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  /** 何番目の記録が「この端末で入れ済み」か。鍵は無いことがあるので番号で持つ。 */
  const [dupAt, setDupAt] = useState<boolean[]>([]);
  const [result, setResult] = useState<{
    ok: string[];
    skipped: string[];
    failed: { what: string; why: string }[];
  } | null>(null);

  const parsed = useMemo(() => (text.trim() ? parseHandoff(text) : null), [text]);
  const handoff: Handoff | null = parsed?.ok ? parsed.value : null;

  /*
   * チャットに渡す依頼文。
   *
   * 分類辞書を混ぜるので、この画面でだけ expense_rules を読む。
   * 67行ほどの小さい表で、レシートの本文のように重くはならない。
   * 辞書を渡さないと、チャットが店ごとに違う費目を付けてきて、
   * 月次の比較が意味を失う(cowork/jisui/KAKEIBO.md と同じ決まり)。
   */
  const rules = useTable<ExpenseRule>("expense_rules", { orderBy: "keyword" });
  const prompt = useMemo(() => buildHandoffPrompt({ rules: rules.rows }), [rules.rows]);

  /*
   * 【クリップボードは、無いことも断られることもある】
   *
   * navigator.clipboard は安全な接続(https / localhost)でしか生えない。
   * 家の中の http://192.168… で開くと **丸ごと undefined** で、
   * そのまま .writeText を呼べば TypeError が飛んで画面が止まる。
   * iPhone では許可が下りずに拒否されることもある。
   *
   * 前は失敗を握りつぶしていたので、押しても何も起きない
   * 「壊れているのか、効いたのか分からない」ボタンになっていた。
   * 使えないときは【必ずそう言って、手でコピーする道を示す】。
   */
  const copyPrompt = async () => {
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
      setCopyError(
        "コピーできませんでした。下の「中身を見る」を開いて、枠の中を長押しして選んでからコピーしてください。",
      );
    }
  };

  const pasteFromClipboard = async () => {
    setPasteError(null);
    try {
      if (!navigator.clipboard?.readText) throw new Error("clipboard unavailable");
      const t = await navigator.clipboard.readText();
      if (!t.trim()) {
        setPasteError("クリップボードが空でした。チャットで JSON をコピーしてから押してください。");
        return;
      }
      setText(t);
    } catch {
      setPasteError("読み取れませんでした。下の欄を長押しして「ペースト」を選んでください。");
    }
  };

  // 「この端末で入れ済みか」は IndexedDB を読むので非同期。
  // 効果の中で同期的に setState すると連鎖描画になるため、必ず解決後に入れる。
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!handoff) {
        if (alive) setDupAt([]);
        return;
      }
      const flags = await appliedFlags(handoff);
      if (alive) setDupAt(flags);
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
        {/* ------------------------------------------------ 手順1 */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-bold">1. 依頼文をコピーする</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            記録の書き方・費目の一覧・店名の辞書をまとめた文章です。
            これを渡せば、<strong>スキルを積んでいないチャットでも</strong>
            貼り込める形で返してくれます。
          </p>

          <button
            type="button"
            onClick={() => void copyPrompt()}
            className="mt-3 h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white active:bg-emerald-700"
          >
            {copied ? "コピーしました" : "依頼文をコピー"}
          </button>
          {copyError && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {copyError}
            </p>
          )}

          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-neutral-500 dark:text-neutral-400">
              中身を見る({prompt.length.toLocaleString()}文字・辞書 {rules.rows.length} 件)
            </summary>
            <textarea
              readOnly
              value={prompt}
              rows={12}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded-xl border border-neutral-300 bg-neutral-50 p-3 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-800"
            />
          </details>
        </section>

        {/* ------------------------------------------------ 手順2 */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-bold">2. チャットに貼って、読ませる</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            スマホの Claude アプリを開いて、いまコピーしたものを貼り付けて送ります。
            そのあと、レシートの写真や、記録したいことを渡してください。
          </p>
          <ul className="mt-2 space-y-1 text-[11px] text-neutral-600 dark:text-neutral-300">
            <li>・レシートの写真を送る(何枚でも)</li>
            <li>・「牛乳と卵を買い物リストに入れて」</li>
            <li>・「20日の10時半から歯医者」</li>
          </ul>
          <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            チャットはクラウドで動くため、データベースに直接は届きません。
            この画面が橋渡しをします。<strong>パソコンは要りません。</strong>
          </p>
        </section>

        {/* ------------------------------------------------ 手順3 */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-bold">3. 返ってきた返事を貼る</h2>
          <p className="mb-3 mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            チャットの返事を<strong>まるごと</strong>貼って構いません。
            前後の説明は読み飛ばして、JSON の部分だけを拾います。
          </p>
          <button
            type="button"
            onClick={() => void pasteFromClipboard()}
            className="mb-3 h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white active:bg-emerald-700"
          >
            クリップボードから貼る
          </button>
          {pasteError ? (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {pasteError}
            </p>
          ) : (
            <p className="mb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              うまくいかないときは、下の欄を長押しして「ペースト」を選んでください。
            </p>
          )}

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
                  const dup = dupAt[i] === true;
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

/** ?d= の中身を読む。base64 でも素のままでも受ける。読めなければ空。 */
function decodeParam(d: string | null): string {
  if (!d) return "";
  try {
    return decodeURIComponent(escape(atob(d)));
  } catch {
    return d;
  }
}
