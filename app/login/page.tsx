"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

/** Supabase のエラー文をそのまま出しても分からないので、日本語に置き換える。 */
function readableError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "メールアドレスかパスワードが違います。";
  }
  if (m.includes("email not confirmed")) {
    return "このユーザーはまだ確認が済んでいません。Supabase の Authentication → Users で確認済みにしてください。";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "試行が多すぎます。少し時間を置いてからもう一度お試しください。";
  }
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "通信できませんでした。電波の良い場所でもう一度お試しください。";
  }
  return message;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
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
          ホームに戻る
        </Link>
      </main>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setBusy(false);
      setError(readableError(error.message));
      return;
    }
    // ホームへ。ログイン状態はこの端末に保存されるので、次からは自動で開く。
    router.replace("/");
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-bold">くらし</h1>
        <p className="mt-1 text-sm text-neutral-500">
          最初の1回だけログインします。次からはそのまま開きます。
        </p>

        <form onSubmit={submit} className="mt-8">
          <label htmlFor="email" className="block text-xs font-medium text-neutral-500">
            メールアドレス
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            placeholder="you@example.com"
            className="mt-1 h-14 w-full rounded-xl border border-neutral-300 bg-white px-4 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-900"
          />

          <label
            htmlFor="password"
            className="mt-4 block text-xs font-medium text-neutral-500"
          >
            パスワード
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            enterKeyHint="go"
            className="mt-1 h-14 w-full rounded-xl border border-neutral-300 bg-white px-4 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-900"
          />

          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="mt-6 h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            {busy ? "確認中…" : "ログイン"}
          </button>

          {error && (
            <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </p>
          )}
        </form>

        <Link
          href="/help"
          className="mt-8 block text-sm font-semibold text-emerald-700 underline dark:text-emerald-400"
        >
          はじめての方へ(使い方)
        </Link>

        <p className="mt-4 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          パスワードを忘れたときは、Supabase の Authentication → Users から
          対象のユーザーを開き、新しいパスワードを設定してください。
        </p>
      </div>
    </main>
  );
}
