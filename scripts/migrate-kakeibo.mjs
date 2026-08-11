/**
 * 手元の家計簿(kakeibo.db)を Supabase へ移すための SQL を作る。
 *
 *   node scripts/migrate-kakeibo.mjs > 10_seed_v4.sql
 *
 * なぜ生成するのか:
 *   手で書き写すと必ず抜けるし、金額を1桁間違えても気づけない。
 *   元のDBから読んで組み立て、件数を最後に検算する。
 *
 * 何度実行しても増えないようにしてある(既にある行は飛ばす)。
 * 途中で失敗しても、PostgreSQL がまとめて取り消すので中途半端には入らない。
 */
import { execFileSync } from "node:child_process";

const DB = String.raw`C:\Users\mmizu\jisui\_引退\家計簿\kakeibo.db`;
const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";

/**
 * sqlite3 を使わず Python 経由で読む(Windows に sqlite3.exe が無いため)。
 *
 * Windows の標準出力は既定が cp932 なので、日本語がそのままだと化けて
 * JSON として読めなくなる。ensure_ascii=True でエスケープさせ、
 * 経路の文字コードに依存しない形で受け取る。
 */
function query(sql) {
  const script = `
import sqlite3, json, sys
c = sqlite3.connect(r"${DB}")
c.row_factory = sqlite3.Row
rows = [dict(r) for r in c.execute(${JSON.stringify(sql)})]
sys.stdout.write(json.dumps(rows, ensure_ascii=True))
`;
  const out = execFileSync("python", ["-c", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined || v === "" ? "null" : Number(v));
const b = (v) => (v ? "true" : "false");

const out = [];
const say = (s) => out.push(s);

say(`-- ============================================================`);
say(`-- 手元の家計簿(kakeibo.db)からの移行データ`);
say(`-- scripts/migrate-kakeibo.mjs が生成。手で編集しない。`);
say(`-- 09_schema_v4.sql の後に実行する。`);
say(`-- 何度実行しても増えない(既にある行は飛ばす)。`);
say(`-- ============================================================`);
say(``);
say(`begin;`);
say(``);

// ---------------------------------------------------- 資産・負債・残高
//
// 手元は assets(年月,項目,金額)という月ごとのスナップショット。
// jisui は accounts(名前の台帳)+ balances(月ごとの残高)に分かれている。
// 項目名から口座を起こし、金額は月ごとの残高として入れ直す。

const assets = query("select year_month, item, amount, as_of, source from assets order by year_month, item");
const liabilities = query("select year_month, item, value, note, as_of from liabilities order by year_month, item");
const bankBalances = query("select year_month, account, balance from balances order by year_month, account");

/** 「現金 楽天銀行」→ 楽天銀行。台帳の名前は口座名だけにする。 */
const accountName = (item) => item.replace(/^現金\s*/, "").trim();

const categoryOf = (item) => {
  if (/^現金/.test(item)) return "預金";
  if (/iDeCo|NISA|証券|投信/.test(item)) return "投資";
  return null;
};

const accounts = new Map(); // name -> {kind, category}
for (const a of assets) {
  accounts.set(accountName(a.item), { kind: "資産", category: categoryOf(a.item) });
}
for (const l of liabilities) {
  accounts.set(l.item, { kind: "負債", category: "ローン" });
}
// balances 側にしか出てこない口座も拾う(月がずれているだけで同じ口座)
for (const r of bankBalances) {
  if (!accounts.has(r.account)) accounts.set(r.account, { kind: "資産", category: "預金" });
}

say(`-- 口座・資産・負債の台帳(${accounts.size}件)`);
say(`-- 同じ名前が既にあれば作らない`);
let order = 0;
for (const [name, meta] of accounts) {
  say(
    `insert into accounts (household_id, name, kind, category, sort_order)\n` +
      `select '${HOUSEHOLD}', ${q(name)}, ${q(meta.kind)}, ${q(meta.category)}, ${order}\n` +
      `where not exists (select 1 from accounts where household_id = '${HOUSEHOLD}' and name = ${q(name)});`,
  );
  order += 10;
}
say(``);

// 月ごとの残高。assets / liabilities / balances の3か所から集める。
// 同じ口座・同じ月が重なったら、後から来たほうで上書きする。
const balanceRows = new Map(); // `${name}|${ym}` -> amount
const putBalance = (name, ym, amount) => balanceRows.set(`${name}|${ym}`, amount);

for (const a of assets) putBalance(accountName(a.item), a.year_month, a.amount);
for (const l of liabilities) putBalance(l.item, l.year_month, l.value);
for (const r of bankBalances) putBalance(r.account, r.year_month, r.balance);

say(`-- 月ごとの残高(${balanceRows.size}件)`);
for (const [key, amount] of balanceRows) {
  const [name, ym] = key.split("|");
  say(
    `insert into balances (household_id, account_id, year_month, amount)\n` +
      `select '${HOUSEHOLD}', a.id, ${q(ym)}, ${amount} from accounts a\n` +
      `where a.household_id = '${HOUSEHOLD}' and a.name = ${q(name)}\n` +
      `on conflict (account_id, year_month) do update set amount = excluded.amount;`,
  );
}
say(``);

// ---------------------------------------------------------- 資産の内訳
const details = query("select item, sub_item, amount, as_of, note from asset_details");
say(`-- 資産の内訳(${details.length}件)`);
for (const d of details) {
  say(
    `insert into asset_details (household_id, item, sub_item, amount, as_of, note) values ` +
      `('${HOUSEHOLD}', ${q(d.item)}, ${q(d.sub_item)}, ${n(d.amount)}, ${q(d.as_of)}, ${q(d.note)})\n` +
      `on conflict (household_id, item, sub_item) do nothing;`,
  );
}
say(``);

// ------------------------------------------------------------- 投資
const holdings = query("select * from holdings");
say(`-- 保有銘柄(${holdings.length}件)`);
for (const h of holdings) {
  say(
    `insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ` +
      `('${HOUSEHOLD}', ${q(h.as_of)}, ${q(h.kind)}, ${q(h.account)}, ${q(h.code)}, ${q(h.name)}, ` +
      `${n(h.quantity)}, ${n(h.acq_price)}, ${n(h.cur_price)}, ${n(h.acq_amount)}, ${n(h.value)}, ${n(h.pnl)}, ${b(h.accumulating)})\n` +
      `on conflict (household_id, as_of, account, name) do nothing;`,
  );
}
say(``);

const watchlist = query("select * from watchlist");
say(`-- 監視銘柄(${watchlist.length}件)`);
for (const w of watchlist) {
  say(
    `insert into watchlist (household_id, code, name, market, memo) values ` +
      `('${HOUSEHOLD}', ${q(w.code)}, ${q(w.name)}, ${q(w.market)}, ${q(w.memo)})\n` +
      `on conflict (household_id, code) do nothing;`,
  );
}
say(``);

const watchHistory = query("select * from watch_history");
say(`-- 監視銘柄の記録(${watchHistory.length}件)`);
for (const w of watchHistory) {
  say(
    `insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ` +
      `('${HOUSEHOLD}', ${q(w.code)}, ${q(w.as_of)}, ${n(w.price)}, ${n(w.per)}, ${n(w.pbr)}, ${n(w.div_yield)}, ` +
      `${n(w.dividend)}, ${n(w.year_high)}, ${n(w.year_low)}, ${q(w.note)})\n` +
      `on conflict (household_id, code, as_of) do nothing;`,
  );
}
say(``);

// -------------------------------------------------------- 将来の見通し
const loans = query("select * from loan_schedule order by year_month");
say(`-- ローン残高の予定(${loans.length}件)`);
for (const l of loans) {
  // 手元は「実績 / 目安」。jisui 側は「実績 / 見込」に揃える。
  const kind = l.kind === "実績" ? "実績" : "見込";
  say(
    `insert into loan_schedule (household_id, year_month, balance, kind, note) values ` +
      `('${HOUSEHOLD}', ${q(l.year_month)}, ${n(l.balance)}, ${q(kind)}, ${q(l.note)})\n` +
      `on conflict (household_id, year_month) do nothing;`,
  );
}
say(``);

const salary = query("select * from salary_table order by age");
say(`-- 俸給表(${salary.length}件)`);
for (const s of salary) {
  say(
    `insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ` +
      `('${HOUSEHOLD}', ${n(s.age)}, ${n(s.grade_no)}, ${n(s.monthly_salary)}, ${n(s.bonus_summer)}, ${n(s.bonus_winter)}, ` +
      `${n(s.retire_rate_self)}, ${n(s.retire_rate_teinen)}, ${n(s.retire_rate_komu)}, ${q(s.note)})\n` +
      `on conflict (household_id, age) do nothing;`,
  );
}
say(``);

const todos = query("select * from todos order by id");
say(`-- やること(${todos.length}件)`);
for (const t of todos) {
  say(
    `insert into todos (household_id, title, detail, status, created_at, done_at)\n` +
      `select '${HOUSEHOLD}', ${q(t.title)}, ${q(t.detail)}, ${q(t.status)}, ${q(t.created_at)}, ${q(t.done_at)}\n` +
      `where not exists (select 1 from todos where household_id = '${HOUSEHOLD}' and title = ${q(t.title)});`,
  );
}
say(``);

say(`commit;`);
say(``);
say(`-- ============================================================`);
say(`-- 検算: 左が移した件数、右が手元にあった件数。全部そろっていれば成功。`);
say(`-- ============================================================`);
say(`select`);
say(`  (select count(*) from accounts      where household_id = '${HOUSEHOLD}') as 口座,       ${accounts.size} as 元の口座,`);
say(`  (select count(*) from balances      where household_id = '${HOUSEHOLD}') as 残高,       ${balanceRows.size} as 元の残高,`);
say(`  (select count(*) from asset_details where household_id = '${HOUSEHOLD}') as 内訳,       ${details.length} as 元の内訳,`);
say(`  (select count(*) from holdings      where household_id = '${HOUSEHOLD}') as 保有銘柄,   ${holdings.length} as 元の保有銘柄,`);
say(`  (select count(*) from watchlist     where household_id = '${HOUSEHOLD}') as 監視銘柄,   ${watchlist.length} as 元の監視銘柄,`);
say(`  (select count(*) from watch_history where household_id = '${HOUSEHOLD}') as 株価記録,   ${watchHistory.length} as 元の株価記録,`);
say(`  (select count(*) from loan_schedule where household_id = '${HOUSEHOLD}') as ローン予定, ${loans.length} as 元のローン予定,`);
say(`  (select count(*) from salary_table  where household_id = '${HOUSEHOLD}') as 俸給表,     ${salary.length} as 元の俸給表,`);
say(`  (select count(*) from todos         where household_id = '${HOUSEHOLD}') as やること,   ${todos.length} as 元のやること;`);

process.stdout.write(out.join("\n") + "\n");
