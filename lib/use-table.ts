"use client";

// 読み取り中心のデータ(レシピ・材料・献立・調理記録・取引など)を読む共通処理。
//
// 買い物リストや在庫と違って、アプリからの書き換えは少ない。
// そのぶん作りは簡単でよいが、「まず手元のキャッシュを出してから取りに行く」点は同じ。
// 圏外でレシピが開けないと、台所で困る。
import { useCallback, useEffect, useRef, useState } from "react";
import * as local from "./local-db";
import {
  getSnapshot as getSession,
  init as initSession,
  subscribe as subscribeSession,
} from "./store";
import { getSupabase } from "./supabase/client";
import { staleToken, subscribeStale } from "./table-cache";

const REQUEST_TIMEOUT_MS = 8_000;
/** 直前に取れていれば取り直さない間隔。相手の変更に追いつく速さとの兼ね合い。 */
const FRESH_FOR_MS = 60_000;

export type TableState<T> = {
  rows: T[];
  /** 一度も表示できていない状態。キャッシュが出た時点で false になる。 */
  loading: boolean;
  error: string | null;
  /** キャッシュを表示中で、サーバからの取得がまだ終わっていない */
  stale: boolean;
  /** 保存した直後など、今すぐ取り直したいときに呼ぶ */
  refetch: () => void;
  /** 楽観更新。往復を待たずに画面へ反映したいときに使う */
  patch: (next: T) => void;
  remove: (id: number) => void;
};

export type TableOptions = {
  select?: string;
  orderBy?: string;
  ascending?: boolean;
};

type Identified = { id: number };

export function useTable<T extends Identified>(
  table: string,
  options: TableOptions = {},
): TableState<T> {
  const { select = "*", orderBy, ascending = true } = options;
  const [state, setState] = useState<{
    rows: T[];
    loading: boolean;
    error: string | null;
    stale: boolean;
  }>({ rows: [], loading: true, error: null, stale: true });

  const lastFetchedAt = useRef(0);
  const cancelled = useRef(false);

  const fetchFresh = useCallback(
    async (force = false) => {
      const supabase = getSupabase();
      if (!supabase || !getSession().householdId || !navigator.onLine) {
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      if (!force && Date.now() - lastFetchedAt.current < FRESH_FOR_MS) return;

      let query = supabase
        .from(table)
        .select(select)
        .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      if (orderBy) query = query.order(orderBy, { ascending });

      const { data, error } = await query;
      if (cancelled.current) return;
      if (error) {
        // 取れなくても、出しているキャッシュは消さない
        setState((s) => ({ ...s, loading: false, error: error.message }));
        return;
      }
      const rows = (data ?? []) as unknown as T[];
      lastFetchedAt.current = Date.now();
      await local.writeCache(table, rows);
      if (cancelled.current) return;
      setState({ rows, loading: false, error: null, stale: false });
    },
    [table, select, orderBy, ascending],
  );

  useEffect(() => {
    cancelled.current = false;

    const run = async () => {
      // 1. 手元のキャッシュで即描く。0件で保存されている表もあるので undefined で判定する
      const cached = await local.readCache<T>(table);
      if (!cancelled.current && cached !== undefined) {
        setState({ rows: cached, loading: false, error: null, stale: true });
      }
      // 2. ログイン状態が確定してからサーバへ
      await initSession();
      if (!cancelled.current) await fetchFresh(true);
    };
    void run();

    // 相手の変更や、しばらく閉じていた間の変更に追いつくきっかけ。
    // これが無いと、iPhone のホーム画面アプリは何日も同じ内容を出し続ける。
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchFresh();
    };
    const onOnline = () => void fetchFresh(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    let wasSignedIn = getSession().signedIn;
    const unsubscribeSession = subscribeSession(() => {
      const nowSignedIn = getSession().signedIn;
      if (nowSignedIn && !wasSignedIn) void fetchFresh(true);
      wasSignedIn = nowSignedIn;
    });

    // 書き込み側が「古くなった」と言ってきたら、間隔を無視して取り直す
    let token = staleToken(table);
    const unsubscribeStale = subscribeStale(() => {
      const next = staleToken(table);
      if (next !== token) {
        token = next;
        void fetchFresh(true);
      }
    });

    return () => {
      cancelled.current = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      unsubscribeSession();
      unsubscribeStale();
    };
  }, [table, fetchFresh]);

  const refetch = useCallback(() => void fetchFresh(true), [fetchFresh]);

  /** 保存した行で手元を差し替える。往復を待たずに画面が動く。 */
  const patch = useCallback((next: T) => {
    setState((s) => {
      const exists = s.rows.some((r) => r.id === next.id);
      return {
        ...s,
        rows: exists ? s.rows.map((r) => (r.id === next.id ? next : r)) : [...s.rows, next],
      };
    });
  }, []);

  const remove = useCallback((id: number) => {
    setState((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== id) }));
  }, []);

  return { ...state, refetch, patch, remove };
}
