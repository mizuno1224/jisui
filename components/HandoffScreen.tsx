"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  alreadyApplied,
  applyHandoff,
  describeRecord,
  parseHandoff,
  type Handoff,
  type HandoffRecord,
} from "@/lib/handoff";
import { yen } from "@/lib/dates";
import { LOCATIONS, type Location } from "@/lib/types";

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
  const [dupKeys, setDupKeys] = useState<string[]>([]);
  const [result, setResult] = useState<{
    ok: string[];
    skipped: string[];
    failed: { what: string; why: string }[];
  } | null>(null);

  const parsed = useMemo(() => (text.trim() ? parseHandoff(text) : null), [text]);
  const pasted: Handoff | null = parsed?.ok ? parsed.value : null;

  /**
   * 在庫行の直し。records の何番目かをキーに、置き場所と「入れない」を覚える。
   *
   * 【貼った文字列そのものは書き換えない】
   * 直すたびに textarea を書き換えると、途中で貼り直したくなったときに
   * 元が分からなくなる。直しは別に持ち、取り込む直前に重ねる。
   */
  const [invEdits, setInvEdits] = useState<Record<number, InvEdit[]>>({});
  /** どのレコードの内訳を開いているか */
  const [openDetail, setOpenDetail] = useState<number | null>(null);

  /**
   * 貼り直したら直しは捨てる。別のレシートに前の直しが残ると事故になる。
   *
   * 効果(useEffect)で消さない。効果の中で setState すると描画が連鎖するうえ、
   * 「文字が変わったら」の判定が1描画ぶん遅れる。**文字を入れ替える側で捨てる。**
   */
  const replaceText = (next: string) => {
    setText(next);
    setInvEdits({});
    setOpenDetail(null);
  };

  /** 直しを重ねた、実際に取り込むもの */
  const handoff: Handoff | null = useMemo(() => {
    if (!pasted) return null;
    if (Object.keys(invEdits).length === 0) return pasted;
    return {
      ...pasted,
      records: pasted.records.map((r, i) => {
        const edits = invEdits[i];
        if (!edits) return r;
        const inv = (r.args["inventory"] as Record<string, unknown>[] | undefined) ?? [];
        return {
          ...r,
          args: {
            ...r.args,
            inventory: inv
              .map((row, j) => ({ ...row, location: edits[j]?.location ?? row.location }))
              .filter((_, j) => !edits[j]?.skip),
          },
        };
      }),
    };
  }, [pasted, invEdits]);

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
      if (r.failed.length === 0) replaceText("");
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
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .readText()
                .then((t) => replaceText(t))
                .catch(() =>
                  setText((v) =>
                    v === "" ? "" : v,
                  ),
                );
            }}
            className="mb-3 h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white active:bg-emerald-700"
          >
            クリップボードから貼る
          </button>
          <p className="mb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            うまくいかないときは、下の欄を長押しして「ペースト」を選んでください。
          </p>

          <textarea
            value={text}
            onChange={(e) => replaceText(e.target.value)}
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

                      {hasDetail(r) && (
                        <button
                          type="button"
                          onClick={() => setOpenDetail(openDetail === i ? null : i)}
                          className="mt-1.5 block h-9 rounded-lg bg-white px-3 text-[11px] font-bold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100"
                        >
                          {openDetail === i ? "内訳を閉じる" : "内訳を見る・置き場所を直す"}
                        </button>
                      )}
                      {openDetail === i && (
                        <ReceiptDetail
                          record={r}
                          edits={invEdits[i]}
                          onChange={(next) => setInvEdits((cur) => ({ ...cur, [i]: next }))}
                        />
                      )}
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

// --------------------------------------------------- レシートの内訳を見る

/** 在庫1行ぶんの直し。置き場所を変えたか、在庫には入れないか */
type InvEdit = { location?: Location; skip?: boolean };

type ReceiptItem = { item?: string; price?: number };
type ReceiptInv = {
  name?: string;
  qty?: number;
  unit?: string;
  location?: string;
  expiry?: string | null;
};

/** 内訳を出せるのは、明細か在庫を持っているレコードだけ */
function hasDetail(r: HandoffRecord): boolean {
  const items = (r.args["items"] as ReceiptItem[] | undefined) ?? [];
  const inv = (r.args["inventory"] as ReceiptInv[] | undefined) ?? [];
  return items.length > 0 || inv.length > 0;
}

/**
 * レシート1枚の中身。
 *
 * 【なぜ貼る前に見せるのか】
 * 読み取ったのはチャットで、打ったのは人ではない。20点のレシートで
 * 置き場所を1つ間違えると、豆腐が氷温に入って凍る。取り込んでから直すより、
 * 入る前に直すほうが早い。**菓子のように在庫に要らないものも、ここで外せる。**
 *
 * 【合計は「合わせにいかない」】
 * 外税のレシートは、明細の合計(税抜)と支払額(税込)が必ずずれる。
 * 割引が明細に載らない店もある。ずれを警告にすると毎回赤くなって意味を失うので、
 * 両方の数字と差を出すだけにして、判断は人に任せる。
 */
function ReceiptDetail({
  record,
  edits,
  onChange,
}: {
  record: HandoffRecord;
  edits: InvEdit[] | undefined;
  onChange: (next: InvEdit[]) => void;
}) {
  const items = (record.args["items"] as ReceiptItem[] | undefined) ?? [];
  const inv = (record.args["inventory"] as ReceiptInv[] | undefined) ?? [];
  const amount = Number(record.args["amount"] ?? 0);
  const itemSum = items.reduce((s, i) => s + (Number(i.price) || 0), 0);

  const editOf = (j: number): InvEdit => edits?.[j] ?? {};
  const setEdit = (j: number, patch: InvEdit) => {
    const next = inv.map((_, k) => (k === j ? { ...editOf(k), ...patch } : editOf(k)));
    onChange(next);
  };
  const keptCount = inv.filter((_, j) => !editOf(j).skip).length;

  return (
    <div className="mt-2 rounded-lg bg-white p-3 dark:bg-neutral-900">
      {items.length > 0 && (
        <>
          <p className="text-[11px] font-bold">明細 {items.length} 件</p>
          <ul className="mt-1 divide-y divide-neutral-100 dark:divide-neutral-800">
            {items.map((it, j) => (
              <li key={j} className="flex justify-between gap-2 py-1 text-[11px]">
                <span className="min-w-0 flex-1 truncate">{it.item ?? "(名前なし)"}</span>
                <span className="shrink-0 tabular-nums">
                  {it.price == null ? "—" : yen(Number(it.price))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            明細の合計 {yen(itemSum)} / レシートの合計 {yen(amount)}
            {itemSum !== amount && `(差 ${yen(Math.abs(amount - itemSum))})`}
            <br />
            外税のレシートや、明細に載らない割引があると差が出ます。
            <strong>家計に入るのはレシートの合計のほう</strong>です。
          </p>
        </>
      )}

      {inv.length > 0 && (
        <>
          <p className="mt-3 text-[11px] font-bold">
            在庫に入れるもの {keptCount} / {inv.length} 件
          </p>
          <ul className="mt-1 space-y-2">
            {inv.map((row, j) => {
              const e = editOf(j);
              const loc = (e.location ?? row.location ?? "冷蔵") as Location;
              return (
                <li
                  key={j}
                  className={`rounded-lg border border-neutral-200 p-2 dark:border-neutral-700 ${
                    e.skip ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                      {row.name ?? "(名前なし)"}
                      <span className="ml-1 font-normal text-neutral-500 dark:text-neutral-400">
                        {row.qty ?? ""}
                        {row.unit ?? ""}
                        {row.expiry ? ` · 期限 ${row.expiry}` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setEdit(j, { skip: !e.skip })}
                      className="h-8 shrink-0 rounded-lg bg-neutral-100 px-2 text-[11px] font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    >
                      {e.skip ? "戻す" : "入れない"}
                    </button>
                  </div>
                  {!e.skip && (
                    <div className="mt-1.5 flex gap-1">
                      {LOCATIONS.map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setEdit(j, { location: l })}
                          className={`h-8 flex-1 rounded-md text-[11px] font-bold ${
                            loc === l
                              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                              : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            肉と魚は<strong>氷温</strong>、葉物と根菜は<strong>野菜</strong>、
            玉ねぎ・いも・未開封の調味料は<strong>常温</strong>。
            切ってある野菜と豆腐は<strong>冷蔵</strong>(氷温に入れると凍ります)。
          </p>
        </>
      )}
    </div>
  );
}
