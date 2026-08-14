"""明らかな二重計上だけを、自動でまとめる。

【「明らか」の線引き ― ここを間違えると本物の支出が消える】
最初は「同じ日・同じ金額・店名が正規化して一致」で消そうとした。**危険だった。**
同じ料金所を往復すれば、同じ日・同じ金額・同じ店名のETCが2件出る。
実データにも memo「同日同額2件目」という行があり、その規則では消えていた。
店名の一致だけでは「明らか」にならない。

そこで、次の【すべて】を満たすものだけを消す。

  ・同じ日・同じ金額・店名を正規化すると完全に一致する
  ・その組に【古い行】と【あとから入った行】の両方がある
  ・消すのは、あとから入った行だけ

これは「すでに記録済みの明細を、店名の綴り違い(全角スペースの数など)で
もう一度取り込んでしまったぶん」を取り消す、という意味になる。
取り込み前の状態に戻すだけなので、本物の支出は減らない。

  例) ETC 6/16 … 古い行が2件(往復)、今日の取り込みで1件追加 → 今日の1件だけ消す

【消す前に中身を寄せる】
古いほうに手で書いたメモ(「記念写真」)、新しいほうに取り込みの情報
(カード名・利用者)が入る。単に消すと情報が減るので、残すほうへ寄せる。

【使い方】
  python scripts/merge-obvious-duplicates.py                 下見。何も書かない
  python scripts/merge-obvious-duplicates.py --apply         実際にまとめる
  python scripts/merge-obvious-duplicates.py --since=2026-08-13  この日以降を「あとから」とみなす
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "cowork", "jisui"))
sys.stdout.reconfigure(encoding="utf-8")
import db  # noqa: E402

APPLY = "--apply" in sys.argv
SINCE = next(
    (a.split("=", 1)[1] for a in sys.argv if a.startswith("--since=")),
    None,
)
j = db.Jisui()

rows = [t for t in j.select("transactions", "*") if not t.get("dup_ok")]

# --since が無ければ、いちばん新しい取り込み日を「あとから」とみなす。
if SINCE is None:
    days = sorted({(t.get("imported_at") or "")[:10] for t in rows if t.get("imported_at")})
    if len(days) < 2:
        print("取り込みが1回ぶんしかないので、二重の判定ができません。")
        sys.exit(0)
    SINCE = days[-1]
print(f"「あとから入った」とみなす取り込み日: {SINCE} 以降\n")

groups: dict[tuple, list[dict]] = {}
for t in rows:
    key = (t["date"], t["amount"], db._normalize_merchant(t["merchant_raw"]))
    groups.setdefault(key, []).append(t)

plans, skipped = [], []
for key, same in groups.items():
    if len(same) < 2:
        continue
    old = [t for t in same if (t.get("imported_at") or "")[:10] < SINCE]
    new = [t for t in same if (t.get("imported_at") or "")[:10] >= SINCE]
    if not old or not new:
        # 全部が古い(=もともと複数あった本物)か、全部が新しい(=明細に本当に複数行ある)。
        # どちらも二重ではない。触らない。
        skipped.append((key, same))
        continue
    old.sort(key=lambda t: t["id"])
    keep = old[0]
    memo = (keep.get("memo") or "").strip()
    for d in new:
        m = (d.get("memo") or "").strip()
        if m and m not in memo:
            memo = f"{memo} / {m}" if memo else m
    plans.append((keep, new, memo, len(old)))

print(f"=== 取り消す(今日の取り込みが二重に入れたぶん) {len(plans)} 組 ===")
total = 0
for keep, drop, memo, n_old in plans:
    total += sum(d["amount"] for d in drop)
    print(f"  {keep['amount']:>9,}円  {keep['date']}  {keep['merchant_raw'][:32]}")
    print(f"      もとから {n_old} 件 → 今日 {len(drop)} 件増えた。増えたぶんを消す")
    for d in drop:
        print(f"        消す id={d['id']}  memo={(d.get('memo') or '')[:44]!r}")
    if memo != (keep.get("memo") or "").strip():
        print(f"      → id={keep['id']} の memo に寄せる")
print(f"\n  消す合計: {total:,}円")

print(f"\n=== 触らない(二重ではない) {len(skipped)} 組 ===")
for key, same in skipped[:6]:
    d, amt, _ = key
    when = {("旧" if (t.get("imported_at") or "")[:10] < SINCE else "新") for t in same}
    print(f"  {amt:>7,}円 {d}  {same[0]['merchant_raw'][:26]}  {len(same)}件(全部{'/'.join(sorted(when))})")
if len(skipped) > 6:
    print(f"  … ほか {len(skipped) - 6} 組")

if not APPLY:
    print("\n--apply が無いので何も書いていません。")
    sys.exit(0)

print("\n=== 実行 ===")
ok, ng = [], []
for keep, drop, memo, _ in plans:
    try:
        if memo != (keep.get("memo") or "").strip():
            j.update("transactions", {"memo": memo}, id=f"eq.{keep['id']}")
        for d in drop:
            j.delete("transactions", id=f"eq.{d['id']}")
        ok.append(f"{keep['amount']:,}円 {keep['date']} {keep['merchant_raw'][:22]} … {len(drop)}件を消した")
    except Exception as e:
        ng.append(f"id={keep['id']}: {type(e).__name__}: {e}")

for s in ok:
    print("  OK  " + s)
for s in ng:
    print("  ×   " + s)
print(f"\n→ まとめた {len(ok)} 組 / 失敗 {len(ng)}")
