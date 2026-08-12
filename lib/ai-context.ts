import type {
  CookLog,
  Equipment,
  MealPlan,
  Pantry,
  Preference,
  Recipe,
  ShoppingItem,
} from "@/lib/types";
import type { InventoryItem } from "@/lib/types";
import { daysUntil, todayISO } from "@/lib/dates";

/**
 * AI に献立やレシピを相談するとき、貼り付けるための文章を作る。
 *
 * 【なぜアプリの中で作るのか】
 * チャット(Cowork)はクラウドで動くと Supabase に届かないうえ、
 * パソコンのデスクトップアプリも要る。スマホしか手元に無いときに使えない。
 *
 * そこで「相談に必要なものを全部書き出した文章」をアプリが作り、
 * スマホの Claude アプリに貼ってもらう。
 * 追加の課金なしに、スマホだけで相談できるようにするための回り道。
 *
 * 【中身は cowork/jisui/db.py の context() と揃える】
 * 揃えておかないと、チャットで相談したときとスマホで相談したときで
 * 提案の質が変わる。「苦手を使わない」「無い器具を使わない」
 * 「常備品は買い物リストに載せない」は、どちらから相談しても守られてほしい。
 */
export function buildAiContext(args: {
  inventory: InventoryItem[];
  pantry: Pantry[];
  preferences: Preference[];
  equipment: Equipment[];
  cookLog: CookLog[];
  mealPlan: MealPlan[];
  shopping: ShoppingItem[];
  recipes: Recipe[];
}): string {
  const today = todayISO();
  const L: string[] = [];
  const push = (s = "") => L.push(s);

  push("# 献立の相談");
  push();
  push(`今日は ${today} です。この家の状況を全部書き出します。`);
  push("これを踏まえて相談に乗ってください。");
  push();

  // ---- 守ってほしいこと。最初に置く。後ろに置くと読み飛ばされる。
  push("## 必ず守ってほしいこと");
  push();
  const dislikes = args.preferences.filter((p) => p.kind === "苦手").map((p) => p.item);
  push(
    dislikes.length > 0
      ? `1. **苦手なものは絶対に使わないでください: ${dislikes.join("、")}**`
      : "1. 苦手な食材は登録されていません",
  );
  push("2. **下の「調理器具」に無い器具を使うレシピは出さないでください。**");
  push("   「オーブンで」と書かれても、家に無ければ作れません");
  push("3. **「常備品」にあるものは買い物リストに載せないでください。**");
  push("   米は実家からもらうので、絶対に載せないでください");
  push("4. 手順は初心者向けに「なぜそうするか」まで書いてください。");
  push("   「適量」「少々」は、何グラム・小さじ何杯かを必ず書いてください");
  push("5. 妻は少食ですが増量したいので、量ではなくカロリー密度で調整してください");
  push("   (油・ナッツ・チーズを足す方向で)");
  push();

  // ---- 期限が近いものを先に見せる。使い切りが一番の目的なので。
  const expiring = args.inventory
    .filter((i) => i.expiry && daysUntil(i.expiry) <= 4)
    .sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));
  if (expiring.length > 0) {
    push("## 先に使い切りたいもの(期限が近い)");
    push();
    for (const i of expiring) {
      const d = daysUntil(i.expiry!);
      push(`- ${i.name} ${fmtQty(i)} — ${d < 0 ? "期限切れ" : `あと${d}日`}(${i.location})`);
    }
    push();
  }

  push("## 冷蔵庫にあるもの");
  push();
  if (args.inventory.length === 0) push("(登録なし)");
  for (const i of args.inventory) push(`- ${i.name} ${fmtQty(i)}(${i.location})`);
  push();

  push("## 常備品(買い物リストに載せないもの)");
  push();
  push(args.pantry.length === 0 ? "(登録なし)" : args.pantry.map((p) => p.name).join("、"));
  push();

  push("## 調理器具(これ以外は家にありません)");
  push();
  if (args.equipment.length === 0) push("(登録なし)");
  for (const e of args.equipment) push(`- ${e.name}${e.memo ? ` — ${e.memo}` : ""}`);
  push();

  const others = args.preferences.filter((p) => p.kind !== "苦手");
  if (others.length > 0) {
    push("## 好み・方針");
    push();
    for (const p of others) push(`- [${p.kind}] ${p.item}${p.memo ? ` — ${p.memo}` : ""}`);
    push();
  }

  push("## 最近作ったもの(続けて同じものにならないように)");
  push();
  const recent = args.cookLog.slice(0, 14);
  if (recent.length === 0) push("(記録なし)");
  for (const c of recent) push(`- ${c.date} ${c.name ?? ""}`);
  push();

  // 【「予定」だけを渡す】
  // 以前は「中止でないもの」を渡していた。作り終わった献立(実施)まで
  // 「これから作るもの」として渡してしまい、AI が「もう決まっているから
  // 別のものを」と判断していた。済んだものは「直近に作ったもの」で伝わる。
  const upcoming = args.mealPlan.filter((m) => m.date >= today && m.status === "予定");
  push("## これからの献立(決まっているぶん)");
  push();
  if (upcoming.length === 0) push("(まだ決まっていません)");
  for (const m of upcoming) push(`- ${m.date} ${m.slot} ${m.name ?? "(未定)"}`);
  push();

  const notBought = args.shopping.filter((s) => s.status === "未購入");
  if (notBought.length > 0) {
    push("## 買い物リストに入っているもの(まだ買っていない)");
    push();
    for (const s of notBought) push(`- ${s.item}${s.qty ? ` ${s.qty}` : ""}`);
    push();
  }

  push("## 作れるレシピ(登録済み)");
  push();
  if (args.recipes.length === 0) push("(登録なし)");
  for (const r of args.recipes) {
    const bits = [r.category, r.protein, r.time_min ? `${r.time_min}分` : null].filter(Boolean);
    push(`- ${r.name}${bits.length ? `(${bits.join(" / ")})` : ""}`);
  }
  push();

  push("---");
  push();
  push("## お願い");
  push();
  push("上を踏まえて献立を提案してください。新しいレシピを作る場合は、");
  push("**次の形でそのまま貼り付けられるように**書いてください。");
  push("アプリの「レシピを追加」にこのまま貼り付けます。");
  push();
  push("```");
  push("# レシピ名");
  push("");
  push("## 基本情報");
  push("- 2人分 / 調理時間 約○分");
  push("- 使う器具: (上の調理器具から)");
  push("");
  push("## 材料(2人分)");
  push("- 材料名 数量単位");
  push("");
  push("## 手順");
  push("");
  push("### 1. 見出し(かかる時間)");
  push("やること。**なぜそうするのか**も書く。");
  push("```");

  return L.join("\n");
}

function fmtQty(i: InventoryItem): string {
  if (i.qty == null) return "";
  return `${i.qty}${i.unit ?? ""}`;
}

/**
 * 貼り付けられたレシピ本文から、名前と材料を読み取る。
 *
 * 完璧に読める必要はない。読めたぶんを初期値として埋め、
 * 人が直せるようにするのが目的。読めなければ空のままにして、
 * 勝手に間違った値を入れない。
 */
export function parseRecipeMarkdown(md: string): {
  name: string;
  timeMin: number | null;
  ingredients: { name: string; qty: number | null; unit: string | null }[];
} {
  const lines = md.split("\n");

  // 名前は最初の「# 」
  const h1 = lines.find((l) => /^#\s+/.test(l));
  const name = h1 ? h1.replace(/^#\s+/, "").trim() : "";

  // 調理時間は「約20分」「20分」のいずれか最初に出たもの
  const timeLine = lines.find((l) => /調理時間|分\b/.test(l));
  const timeMatch = timeLine?.match(/(\d+)\s*分/);
  const timeMin = timeMatch ? Number(timeMatch[1]) : null;

  // 材料は「## 材料」から次の見出しまでの「- 」
  const start = lines.findIndex((l) => /^##\s*材料/.test(l));
  const ingredients: { name: string; qty: number | null; unit: string | null }[] = [];
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^#{1,3}\s/.test(l)) break;
      const m = l.match(/^\s*[-*]\s+(.+)$/);
      if (!m) continue;
      const body = m[1].trim();
      // 「豚ロース 300g」「玉ねぎ 1個」「醤油 大さじ1」に対応する。
      // 数量が読めなければ名前だけ入れる。間違った数量を入れるより空のほうがよい。
      const q =
        body.match(/^(.+?)\s+(?:(大さじ|小さじ|カップ)\s*([\d.]+)|([\d.]+)\s*(\S*))$/) ?? null;
      if (!q) {
        ingredients.push({ name: body, qty: null, unit: null });
        continue;
      }
      const label = q[1].trim();
      if (q[2]) ingredients.push({ name: label, qty: Number(q[3]), unit: q[2] });
      else ingredients.push({ name: label, qty: Number(q[4]), unit: q[5] || null });
    }
  }
  return { name, timeMin, ingredients };
}
