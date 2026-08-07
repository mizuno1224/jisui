"use client";

import Link from "next/link";
import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = getSupabase();

  if (!supabase) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-lg font-bold">ローカルモードで動いています</p>
        <p className="text-sm text-neutral-500">
          Supabase の環境変数が未設定のため、この端末の中だけでリストを扱います。
          2人で共有するには <code>.env.local</code> を設定してください。
        </p>
        <Link href="/" className="mt-2 text-sm font-semibold text-emerald-700 underline">
          リストに戻る
        </Link>
      </main>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-bold">jisui</h1>
        <p className="mt-1 text-sm text-neutral-500">
          メールに届くリンクからログインします。パスワードはありません。
        </p>

        {sent ? (
          <div className="mt-8 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            <p className="font-semibold">{email} にリンクを送りました。</p>
            <p className="mt-1">
              スマホでこのアプリを使う場合は、<b>スマホのメールアプリ</b>からリンクを開いてください。
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8">
            <label className="block text-xs font-medium text-neutral-500">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              className="mt-1 h-14 w-full rounded-xl border border-neutral-300 bg-white px-4 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="mt-4 h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
            >
              {busy ? "送信中…" : "ログインリンクを送る"}
            </button>
            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
