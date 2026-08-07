"use client";

// 読み取り中心のデータ(レシピ・材料・献立・調理記録・取引)を読むための共通処理。
//
// 買い物リストや在庫と違って、アプリからの書き換えは少ない。
// そのぶん作りは簡単でよいが、「まず手元のキャッシュを出してから取りに行く」点は同じ。
// 圏外でレシピが開けないと、台所で困る。
import { useEffect, useState } from "react";
import * as local from "./local-db";
import {
  getSnapshot as getSession,
  init as initSession,
  subscribe as subscribeSession,
} from "./store";
import { getSupabase } from "./supabase/client";

const REQUEST_TIMEOUT_MS = 20_000;

export type TableState<T> = {
  rows: T[];
  /** 一度も表示できていない状態。キャッシュが出た時点で false になる。 */
  loading: boolean;
  error: string | null;
  /** キャッシュを表示中で、サーバからの取得がまだ終わっていない */
  stale: boolean;
};

export type TableOptions = {
  select?: string;
  orderBy?: string;
  ascending?: boolean;
};

export function useTable<T>(table: string, options: TableOptions = {}): TableState<T> {
  const { select = "*", orderBy, ascending = true } = options;
  const [state, setState] = useState<TableState<T>>({
    rows: [],
    loading: true,
    error: null,
    stale: true,
  });

  useEffect(() => {
    let cancelled = false;

    const fetchFresh = async () => {
      const supabase = getSupabase();
      if (!supabase || !getSession().signedIn || !navigator.onLine) {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
        return;
      }
      let query = supabase
        .from(table)
        .select(select)
        .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      if (orderBy) query = query.order(orderBy, { ascending });

      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        setState((s) => ({ ...s, loading: false, error: error.message }));
        return;
      }
      const rows = (data ?? []) as T[];
      await local.writeCache(table, rows);
      if (cancelled) return;
      setState({ rows, loading: false, error: null, stale: false });
    };

    const run = async () => {
      // 1. 手元のキャッシュで即描く
      const cached = await local.readCache<T>(table);
      if (!cancelled && cached?.length) {
        setState({ rows: cached, loading: false, error: null, stale: true });
      }
      // 2. ログイン状態が確定してからサーバへ
      await initSession();
      if (cancelled) return;
      await fetchFresh();
    };

    void run();

    // ログインが後から通った場合にも取りに行く
    let wasSignedIn = getSession().signedIn;
    const unsubscribe = subscribeSession(() => {
      const nowSignedIn = getSession().signedIn;
      if (nowSignedIn && !wasSignedIn) void fetchFresh();
      wasSignedIn = nowSignedIn;
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [table, select, orderBy, ascending]);

  return state;
}
