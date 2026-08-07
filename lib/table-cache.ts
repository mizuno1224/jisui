"use client";

/**
 * 「この表は古くなった」という印だけを持つ小さな置き場。
 *
 * 以前は書き込みのたびに writeCache(table, []) でキャッシュを空配列に
 * 置き換えていた。useTable の判定が cached?.length だったため空配列は
 * 「キャッシュ無し」と同じ扱いになり、この状態で圏外になると
 * 「この月の記録はありません」「予定なし」と出た。サーバには入っているのに
 * 消えたように見えるのが一番困る。
 *
 * だからキャッシュは消さない。代わりに印を立て、次に読むときに
 * 通信を1回強制するだけにする。
 */

const tokens = new Map<string, number>();
const listeners = new Set<() => void>();

export function markStale(table: string) {
  tokens.set(table, (tokens.get(table) ?? 0) + 1);
  for (const l of listeners) l();
}

export function staleToken(table: string): number {
  return tokens.get(table) ?? 0;
}

export function subscribeStale(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
