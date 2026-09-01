"use client";

// 記録の目録(/records)に出す件数だけを数える。
//
// 【行を読まずに数える】
// 目録には20近い表が並ぶ。useTable で1つずつ読むと、この画面を開くたびに
// 取引250件・やること104件…を全部ダウンロードすることになる。数を出すだけなのに、
// アプリでいちばん重い画面ができあがってしまう。
// PostgREST の head + count=exact は【本文なしで件数だけ】返すので、
// 20表ぶん投げても中身は転送されない。
//
// 【まず前回の数を出す】
// 件数は IndexedDB に控える。次に開いたときは、通信の前に前回の数が出る。
// 圏外でも目録が空にならない(この作りは use-table.ts と同じ考え方)。
// 数字は数秒古いことがあるが、目録で見たいのは「何がどれだけ残っているか」であって
// 1件の増減ではない。
import { useEffect, useState } from "react";
import * as local from "./local-db";
import { getSnapshot as getSession, init as initSession } from "./store";
import { getSupabase } from "./supabase/client";

const CACHE_KEY = "record_counts";
const REQUEST_TIMEOUT_MS = 8_000;

export type Counts = Record<string, number | null>;

export function useRecordCounts(tables: readonly string[]): { counts: Counts; loading: boolean } {
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);

  // 表の一覧は画面ごとに固定なので、文字列にして依存に使う
  // (配列をそのまま渡すと、描き直しのたびに別物と見なされて数え直しになる)
  const key = tables.join(",");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const cached = await local.getMeta<Counts>(CACHE_KEY);
      if (!cancelled && cached) {
        setCounts(cached);
        setLoading(false);
      }

      await initSession();
      const supabase = getSupabase();
      if (!supabase || !getSession().householdId || !navigator.onLine) {
        if (!cancelled) setLoading(false);
        return;
      }

      const list = key.split(",");
      const results = await Promise.all(
        list.map(async (table) => {
          const { count, error } = await supabase
            .from(table)
            .select("id", { count: "exact", head: true })
            .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
          // 【表がまだ無い場合を潰さない】。20_checkup.sql を流す前は
          // checkup が存在せずエラーになる。null のままにして、
          // 画面側で「まだ使えません」と出せるようにする。
          return [table, error ? null : (count ?? 0)] as const;
        }),
      );
      if (cancelled) return;

      const next = Object.fromEntries(results) as Counts;
      setCounts(next);
      setLoading(false);
      await local.setMeta(CACHE_KEY, next);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { counts, loading };
}
