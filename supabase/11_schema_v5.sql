-- ============================================================
-- 11_schema_v5.sql — カレンダーのタグ化と「非公開の予定」
--
-- 【いつ実行するか】
--   01_schema.sql → 02_seed.sql → 03_patch_members.sql → 04_schema_kakeibo.sql
--   → 05_seed_kakeibo.sql → 06_patch_views_rls.sql → 07_schema_v2.sql → 08_schema_v3.sql
--   → 09_schema_v4.sql → 10_seed_v4.sql の【次】。Supabase の SQL Editor に
--   このファイルを丸ごと貼って1回で流す。
--
-- 【何のためのファイルか】
--   1. 予定のラベル(いまは lib/event-labels.ts に固定で書いてある6種)を
--      calendar_tags テーブルに移す。
--   2. そのタグに「非公開」の印を持たせる。非公開タグを付けた予定は
--      【本人しか見られない】。相手の画面にはその予定が存在しない。
--   3. 予定に 場所 / URL / 持ち物 / 通知の何分前 を足す。
--   4. TODO にサブタスク(親子)と繰り返しと並び順を足す。
--
-- 【この環境の前提】
--   本番に実データが入っている。だから何度流しても壊れないように書く。
--   create table if not exists / add column if not exists /
--   drop policy if exists → create policy / on conflict do nothing、を徹底する。
--
-- 【一番大事なところ】
--   「非公開」はアプリ側の絞り込みでは実現できない。lib/use-table.ts は
--   select * で全行を取って IndexedDB に書くので、画面に出さないだけでは
--   相手の端末のキャッシュに本文が残る。DB(RLS)で落とすのが必須。
--   このファイルの C 章がその本体。
-- ============================================================


-- ============================================================
-- 0. 内部用のスキーマ
--
-- RLS の判定に使う小さな関数を置く場所。なぜ public に置かないか:
--   Supabase(PostgREST)は public スキーマの関数を、そのまま
--   /rest/v1/rpc/関数名 という HTTP の口として外に出してしまう。
--   ここに作る関数は「この予定は隠すべきか?」に true/false を返すので、
--   public に置くと相手が id を 1,2,3... と総当たりして
--   「隠された予定が存在すること」を数えられてしまう。
--   それでは「完全に隠す」にならない。
--   PostgREST が公開するのは設定で指定されたスキーマ(既定は public)だけなので、
--   別スキーマに置けば HTTP からは呼べず、RLS の中からだけ使える。
-- ============================================================

create schema if not exists app_private;

-- ログイン中のユーザ(authenticated)と未ログイン(anon)から
-- 「関数を呼べる」ようにはしておく。RLS のポリシー式は
-- 【そのユーザの権限で】評価されるので、実行権が無いと select 自体がエラーになる。
grant usage on schema app_private to anon, authenticated, service_role;

-- 既存の my_household_ids() の地固め。
-- security definer の関数は search_path を固定しておかないと、
-- 呼び出し側が search_path を細工して別の household_members を
-- 掴ませる攻撃が理屈のうえで成立する。中身は変わらないので安全に足せる。
--
-- 【pg_temp を最後に書くのが要点】
-- ここを "= public" だけで済ませると、実は塞げていない。PostgreSQL は
-- search_path に pg_temp が書かれていないとき、一時テーブルのスキーマを
-- 【暗黙に最初に】探すため。一時表は誰でも作れるので、そこに
-- household_members の偽物を置かれれば、この関数は嘘の世帯 id を返す。
-- 明示的に最後へ置くと、最後に探されるようになってこの経路が消える。
alter function public.my_household_ids() set search_path = public, pg_temp;


-- ============================================================
-- A. カレンダーのタグ
--
-- これまで色と名前は lib/event-labels.ts の定数だった。
-- 「非公開かどうか」を人ごとに持たせたいので、テーブルに移す。
--
-- 【「本人」を誰と決めるか — ここを曖昧にしない】
--   見える / 見えないは【calendar_tags.owner_id だけ】で決まる。
--   events.owner_id でも events.created_by でもない。
--
--   ・events.owner_id は「誰の予定か」という【表示上の区分】で、
--     07_schema_v2.sql のコメントどおり “個人予定も相手からは見える” が今の意味。
--     ここに秘密の意味を後付けすると、本番に入っている既存の個人予定が
--     実行した瞬間に全部相手から消える。実データを壊す。使わない。
--   ・events.created_by は「誰が入力したか」の作業ログ。null でも保存できるし、
--     相手のぶんを代わりに入力することもある。null のとき「本人」が
--     いなくなり、誰にも見えない行ができてしまう。使わない。
--   ・calendar_tags.owner_id なら、「このタグは私の非公開タグ」と
--     タグを作るときに1回だけ決まる。予定を保存するたびに迷う余地が無い。
--
--   したがって規則は1行で書ける:
--     「private = true のタグが付いた予定は、そのタグの owner_id 本人だけが見える」
--     「タグが無い予定・private = false のタグの予定は、今までどおり2人とも見える」
--
-- 【ただし、判定のときにタグを見に行くわけではない】
--   タグの設定は、予定を保存した瞬間に events.private_owner_id へ写される
--   (B 章のトリガ)。見える / 見えないの判定はその列だけを見る。
--   タグの行が消えても秘密が残るようにするための作りで、
--   ここを取り違えると設計の眼目を丸ごと落とすので注意すること。
--   タグは「秘密を決める入口」であって「秘密を保つ場所」ではない。
-- ============================================================

create table if not exists calendar_tags (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,

  -- 色は 'violet' のような【キーだけ】を入れる。
  -- Tailwind は bg-${color}-500 のような組み立てをビルド時に拾えないので、
  -- キー → クラス名の対応表はアプリ側に固定で持つ。
  -- ここに #a855f7 のような任意の色を入れても画面には出ない。
  color text not null default 'violet',

  -- true = 非公開。このタグを付けた予定は owner_id 本人しか見られない。
  private boolean not null default false,

  -- 非公開タグの持ち主。private = true のときだけ入る(下の check 参照)。
  owner_id uuid references auth.users(id) on delete cascade,

  sort_order integer not null default 0,

  -- 使わなくなったタグは delete ではなく active = false にする。
  -- delete すると events.tag_id が null に落ちて(FK は on delete set null)、
  -- 過去の予定の色分けが失われるため。
  -- (使用中の非公開タグは、そもそもトリガで削除を止めてある。B 章参照)
  active boolean not null default true,

  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 名前の重複をどう禁じるか —— ここは素直に書くと秘密が漏れる
--
-- 素直な書き方は unique (household_id, name) の1本。だがこれは破れる。
-- 【一意制約の検査は RLS を迂回する】(PostgreSQL の仕様。参照整合性の
-- 検査は行レベルセキュリティの外側で行われる)。つまり:
--
--   夫が「通院」という【公開】タグを作ろうとする
--     → 妻の【非公開】タグ「通院」と名前がぶつかる
--     → 23505 duplicate key ... Key (household_id, name)=(..., 通院)
--     → 夫は「妻に “通院” という非公開タグがある」と知る
--
-- タグ名だけで中身は想像がつく(通院・面接・弁護士…)。
-- 一覧から隠しても、名前を1つずつ試すだけで当てられてしまう。
--
-- そこで一意性の範囲を2つに割る。非公開タグは【持ち主ごと】に一意にすると、
-- 相手が投げる insert とは原理的にぶつからない。
-- 代償として、夫の公開「通院」と妻の非公開「通院」が併存しうる。
-- 妻の画面には同名が2つ並ぶが、漏れるよりはるかにましなので受け入れる。
--
-- (計画どおり流れた場合、下の drop は何もしない。過去に途中まで流して
--  制約が残っている場合の後始末として置いてある)
-- ------------------------------------------------------------
alter table calendar_tags drop constraint if exists calendar_tags_household_id_name_key;

create unique index if not exists calendar_tags_shared_name_uidx
  on calendar_tags (household_id, name) where not private;

-- calendar_tags_owner_check により private の行は owner_id が必ず入るので、
-- この索引に null は現れない(= 一意性が緩まない)。
create unique index if not exists calendar_tags_private_name_uidx
  on calendar_tags (household_id, owner_id, name) where private;

-- private と owner_id の組み合わせを1通りに固定する。
-- 「非公開なのに持ち主がいない(= 誰にも見えない)」
-- 「公開なのに持ち主がいる(= 秘密なのか公開なのか読めない)」の2つを潰す。
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'calendar_tags_owner_check') then
    alter table calendar_tags add constraint calendar_tags_owner_check
      check ( (private and owner_id is not null) or (not private and owner_id is null) );
  end if;
end $$;

create index if not exists calendar_tags_household_idx
  on calendar_tags (household_id, sort_order, id);

-- RLS は表を作った直後に入れる。ポリシーは C-2 で足す。
-- 途中まで流して止めても「ポリシーが無い = 全部拒否」に倒れるようにするため
-- (逆にしておくと、止めた瞬間だけ全公開になる)。
alter table calendar_tags enable row level security;

-- 権限。RLS の1枚だけに頼らず、権限そのものも絞っておく。
-- タグ名には「〇〇さんと」のような個人的な文字列が入りうるため。
revoke all on calendar_tags from anon;
grant select, insert, update, delete on calendar_tags to authenticated;

-- 【usage だけ。select は付けない】
-- nextval に必要なのは usage だけ。select を付けると last_value が読める。
-- last_value は「これまでに何個タグが作られたか」なので、
-- 相手が非公開タグをいくつ持っているかが数えられてしまう。
grant usage on sequence calendar_tags_id_seq to authenticated;


-- ------------------------------------------------------------
-- 非公開の設定は、作った後から変えさせない
--
-- なぜ止めるか:
--   ・公開タグ →非公開に変えると、相手が使っていた予定が
--     何の警告もなく相手の画面から消える。
--   ・非公開タグ→公開に変えると、隠していた過去の予定が一気に相手に出る。
--   どちらも「1行 update しただけ」で起きるのに、取り返しがつかない。
--   タグを作るときに決める、変えたければ新しいタグを作って付け替える、
--   という運用に倒す。名前と色と active は今までどおり変えられる。
--
--   どうしても直したいときは SQL Editor で:
--     alter table calendar_tags disable trigger calendar_tags_freeze_privacy;
--     -- 直す
--     alter table calendar_tags enable  trigger calendar_tags_freeze_privacy;
--   (トリガはスーパーユーザでも素通りしない。無効化が必要)
-- ------------------------------------------------------------

create or replace function public.calendar_tags_freeze_privacy()
returns trigger language plpgsql as $fn$
begin
  if new.private is distinct from old.private
     or new.owner_id is distinct from old.owner_id then
    raise exception '非公開の設定は後から変えられません。新しいタグを作って付け替えてください。';
  end if;
  return new;
end
$fn$;

drop trigger if exists calendar_tags_freeze_privacy on calendar_tags;
create trigger calendar_tags_freeze_privacy
  before update on calendar_tags
  for each row execute function public.calendar_tags_freeze_privacy();


-- ============================================================
-- B. events の追加列
-- ============================================================

-- タグ。【on delete set null が要点】。
-- cascade にすると、タグを1つ消した瞬間にそのタグの予定が全部消える。
-- タグを消しても予定は残り、色だけ既定に戻る、が正しい壊れ方。
--
-- 【ただし、隠す/隠さないの判定をこの列に頼ってはいけない】。理由は下の
-- private_owner_id の説明を読むこと。ここは「色」を決める列であって、
-- 「秘密」を決める列ではない。
alter table events add column if not exists tag_id bigint
  references calendar_tags(id) on delete set null;

-- ------------------------------------------------------------
-- 【この列がこのファイルで一番大事】
--
-- 「この予定は誰の秘密か」を、予定の行そのものに焼き付ける。
-- null = 秘密ではない(2人とも見える)。uuid = その人だけが見える。
--
-- なぜタグを見に行かず、わざわざ列を増やすのか:
--
--   最初の設計は「tag_id の指すタグが private なら隠す」だった。これは破れる。
--   events.tag_id は上のとおり on delete set null。そして
--   【外部キーの set null は RI トリガとして RLS を素通りして実行される】。
--   つまり:
--
--     妻がタグ一覧で「ひみつ」を削除する(ごく普通の操作)
--       → events.tag_id が自動で null になる
--       → 「タグが無い = 秘密ではない」と判定される
--       → 妻の非公開予定が、件名も場所もメモも持ち物も、
--          その場で全部 夫の画面に出る
--
--   攻撃ではなく【正常操作】が引き金になる。妻が退会した場合も
--   calendar_tags.owner_id の on delete cascade で同じことが起きる。
--   秘密の維持を「消せる行が存在し続けること」に賭けてはいけない。
--
--   だから秘密は予定の行に持たせる。タグを消しても、持ち主が退会しても、
--   この列は残る。おまけに RLS の判定が関数呼び出しではなく列の比較になるので、
--   1行ごとに calendar_tags を引く必要が無くなり、速くもなる。
--
-- 【この列を直接いじらせない】
--   値はすぐ下のトリガだけが決める。アプリからは触らせない
--   (下の「列単位の権限」で update / insert の対象から外してある)。
-- ------------------------------------------------------------
alter table events add column if not exists private_owner_id uuid
  references auth.users(id);
-- ↑ on delete cascade を付けないこと。付けると、持ち主が退会した瞬間に
--   予定の行ごと消えるか、あるいは null に戻って公開されるかのどちらかになる。
--   退会は秘密を解除する意思表示ではない。

create index if not exists events_private_owner_idx on events (private_owner_id);

alter table events add column if not exists location text;   -- 場所(「◯◯駅 東口」など)
alter table events add column if not exists url text;        -- 予約ページ・地図・招待リンク
alter table events add column if not exists items text;      -- 持ち物メモ(複数行のただの文字列)

-- 通知の何分前か。null = 通知しない。
-- 鳴らすのは端末(Service Worker)の仕事で、DB は「何分前か」を覚えるだけ。
alter table events add column if not exists notify_min integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_notify_min_check') then
    -- 上限は14日前(20160分)。桁の打ち間違いをここで止める。
    alter table events add constraint events_notify_min_check
      check (notify_min is null or (notify_min >= 0 and notify_min <= 20160));
  end if;
end $$;

create index if not exists events_tag_idx on events (tag_id);


-- ------------------------------------------------------------
-- 予定を保存するたびに、タグの設定を予定の行に写すトリガ
--
-- 決めているのは2つ。
--   1. private_owner_id … 誰の秘密か(null = 秘密ではない)
--   2. label            … 表示用のタグ名の写し。非公開タグの名前は入れない
--
-- 【なぜ label にも気を配るのか】
--   非公開タグ「ひみつ」を付けた予定の label に 'ひみつ' が残っていると、
--   あとで本人が共有タグへ付け替えて行が相手に見えるようになった瞬間、
--   タグ名だけが相手に出る。タグ名は中身が想像できる情報(通院・面接…)
--   なので、件名と同じ扱いで守る。
-- ------------------------------------------------------------

create or replace function public.events_apply_tag_privacy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  t_private boolean;
  t_owner   uuid;
  t_name    text;
begin
  -- タグの中身を見に行く。security definer なので、相手の非公開タグでも
  -- 「本当のところ」が読める。invoker のままだと相手の非公開タグが
  -- 「存在しない」ように見えて、隠すべき予定を公開にしてしまう。
  if new.tag_id is not null then
    select t.private, t.owner_id, t.name
      into t_private, t_owner, t_name
      from calendar_tags t
     where t.id = new.tag_id;
  end if;

  if tg_op = 'INSERT' then
    new.private_owner_id := case when t_private then t_owner else null end;

  elsif new.tag_id is distinct from old.tag_id and new.tag_id is not null then
    -- 本人が別のタグへ付け替えた。共有タグを選べば公開に戻る(これが唯一の戻し方)。
    new.private_owner_id := case when t_private then t_owner else null end;

  else
    -- 【ここが要点】タグが外れただけ(tag_id → null)では公開に戻さない。
    --
    -- タグを削除したときの on delete set null は、RI トリガとして
    -- RLS を素通りしてこの経路を通る。ここで null に戻す実装にすると、
    -- 「タグを1つ消すと、隠していた予定が全部相手に出る」ことになる。
    -- タグが変わっていない普通の更新でも、この列は client の指定を無視して
    -- 前の値を守る(アプリに書き換えさせない)。
    new.private_owner_id := old.private_owner_id;
  end if;

  -- label は公開タグの名前だけを写す。非公開タグなら null。
  -- タグが付いていない予定の label には触らない(移行前の既存データを守る)。
  if new.tag_id is not null
     and (tg_op = 'INSERT' or new.tag_id is distinct from old.tag_id) then
    new.label := case when t_private then null else t_name end;
  end if;

  return new;
end
$fn$;

drop trigger if exists events_apply_tag_privacy on events;
create trigger events_apply_tag_privacy
  before insert or update on events
  for each row execute function public.events_apply_tag_privacy();


-- ------------------------------------------------------------
-- 念のための二重化: 予定が付いている非公開タグは消させない
--
-- 上のトリガがあるので、消されても秘密は漏れない。それでも止めるのは、
-- 消した本人が「色が既定に戻っただけ」と思っているのに、実際には
-- その予定が相手から見えないまま残るという分かりにくい状態を避けるため。
-- 消したいときは、先に予定を別のタグへ付け替えてもらう。
-- ------------------------------------------------------------

create or replace function public.calendar_tags_block_used_private_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if old.private and exists (select 1 from events e where e.tag_id = old.id) then
    raise exception '非公開タグ「%」は、使っている予定がある間は消せません。', old.name
      using hint = '予定を別のタグに付け替えてから消してください。';
  end if;
  return old;
end
$fn$;

drop trigger if exists calendar_tags_block_used_private_delete on calendar_tags;
create trigger calendar_tags_block_used_private_delete
  before delete on calendar_tags
  for each row execute function public.calendar_tags_block_used_private_delete();

-- (参考)events.end_time は 07_schema_v2.sql の時点で存在するが、
-- lib/mutations.ts の saveEvent が書いていないので本番は全行 null。
-- 列を足す必要は無い。フォームに欄を足せばそのまま入る。

-- 【events.label は消さない】
-- 本番に label の文字列データが入っている。tag_id が null の行の
-- 表示フォールバックとして残す。今後アプリは tag_id を正とし、
-- 保存時に label へタグ名を写しておくと、将来タグを消して tag_id が
-- null に落ちても表示だけは壊れない。


-- ============================================================
-- A-2. 既定タグを入れて、既存の label を tag_id に移す
--
-- 何度流しても二重に入らないよう on conflict do nothing。
-- do update にしないのは、あとからユーザが名前や色を変えていた場合に
-- 再実行で勝手に元へ戻してしまうのを避けるため。
-- ============================================================

-- ① lib/event-labels.ts と同じ6種を、全世帯に既定タグとして入れる
insert into calendar_tags (household_id, name, color, private, owner_id, sort_order)
-- 【null::uuid と型を書くこと】
-- 素の null は型が決まらず、PostgreSQL が text とみなす。
-- owner_id は uuid なので「column owner_id is of type uuid but expression is
-- of type text」で落ちる。特に distinct を付けると型の決定が先に走るため必ず出る。
select h.id, d.name, d.color, false, null::uuid, d.sort_order
from households h
cross join (values
  ('予定',     'violet',  0),
  ('仕事',     'slate',   1),
  ('病院',     'rose',    2),
  ('買い物',   'emerald', 3),
  ('おでかけ', 'sky',     4),
  ('記念日',   'amber',   5)
) as d(name, color, sort_order)
-- 部分索引 calendar_tags_shared_name_uidx を狙うので where が要る。
-- (入れているのは全部 private = false なので必ずこの索引に当たる)
on conflict (household_id, name) where not private do nothing;

-- ② ①に無いラベルが実データにあったら、それも取りこぼさずタグにする。
--    (アプリは固定6種しか書かないはずだが、手で入れた行があるかもしれない)
--
--    【and e.tag_id is null が必須】
--    この条件が無いと、2回目に流したときに事故る。移行が済んだ行の label は
--    「タグ名の写し」なので、本人が非公開タグの名前を後から変えた場合、
--    古い名前が label に残っていて、それを【公開タグとして】作り直してしまう。
--    再実行しても安全、と謳っている以上、2回目は必ず起きる前提で書く。
insert into calendar_tags (household_id, name, color, private, owner_id, sort_order)
select distinct e.household_id, e.label, 'slate'::text, false, null::uuid, 90
from events e
where e.label is not null
  and btrim(e.label) <> ''
  and e.tag_id is null
on conflict (household_id, name) where not private do nothing;

-- ③ label の文字列 → tag_id に対応づける。
--    すでに tag_id が入っている行は触らない(= 再実行しても上書きしない)。
--    【and t.private = false】… 同名の非公開タグを既存の共有予定に貼ると、
--    その予定が相手の画面から消える。移行が勝手に秘密を作ってはいけない。
update events e
   set tag_id = t.id
  from calendar_tags t
 where t.household_id = e.household_id
   and t.name = e.label
   and t.private = false
   and e.tag_id is null
   and e.label is not null;


-- ============================================================
-- C. 非公開を守る RLS —— このファイルの本題
-- ============================================================

-- ------------------------------------------------------------
-- C-1. 判定用のヘルパ(security definer)
--
-- 予定そのものの判定に関数は要らない。events.private_owner_id を
-- 見るだけで済むようにしてあるため(B 章の説明を読むこと)。
-- 関数が要るのはコメント側だけ。event_comments には
-- private_owner_id が無く、親の予定を引きに行く必要がある。
--
-- 【security definer にする理由。ここを間違えると逆の結果になる】
--   RLS のポリシー式の中で別のテーブルを読むと、そのテーブルの RLS も
--   【呼んだ人の権限で】適用される。
--   もしこの関数を普通の(invoker の)関数にすると:
--     夫が event_comments を読む → ポリシーが events を見に行く
--     → events 側の RLS が「妻の非公開予定」を隠す
--     → 夫からは「そんな予定は存在しない」ように見える
--     → 「隠す理由が無い」と判定される
--     → 妻の非公開予定のコメントだけが夫に読まれる
--   隠したいものを隠した結果、隠せなくなる。だから判定関数だけは
--   RLS を素通りできる security definer にして、常に真実を見る。
-- ------------------------------------------------------------

create or replace function app_private.event_hidden_from_me(p_event_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  -- コメント用。予定そのものが隠されているなら、そのコメントも隠す。
  -- ここで events を読むのも security definer 越し。理由は上と同じで、
  -- invoker のまま読むと「隠された予定は存在しない」→
  -- 「隠す理由が無い」→ コメントだけ相手に読まれる、という逆転が起きる。
  --
  -- 【既定値は true(隠す)。ここを false にすると存在が数えられる】
  --
  --   event_comments.event_id は events(id) への外部キー。PostgreSQL は
  --   INSERT のとき「RLS の with check」を先に、「外部キーの検査」を後に行う。
  --   だから既定を false(隠さない)にすると、返るエラーが割れる:
  --
  --     存在しない id  → with check 通過 → 外部キー違反 23503
  --     隠された id    → with check 違反 → 42501
  --
  --   events.id は 1, 2, 3… と連番。夫が自分に見えない id へ順にコメントを
  --   投げ、返ってきたコードを見るだけで「妻の非公開予定の id 一覧」が
  --   そのまま手に入る。件名が読めなくても、
  --   「何件あるか」「いつ作られたか」「いつ消したか」が分かる。
  --   件名を隠しても存在が漏れたら「完全に隠す」は破れている。
  --
  --   true に倒すと、存在しない id も隠された id も同じ 42501 になり、
  --   区別できなくなる。正規の書き込み(自分に見える予定へのコメント)は
  --   親の予定が実在して隠されてもいないので、1件も壊れない。
  select coalesce(
    (select e.private_owner_id is not null and e.private_owner_id <> auth.uid()
       from events e where e.id = p_event_id),
    true
  );
$fn$;

-- ポリシー式は呼び出したユーザの権限で動くので、実行権が要る。
-- ただし置き場所が app_private なので、HTTP(PostgREST)からは呼べない。
grant execute on function app_private.event_hidden_from_me(bigint) to anon, authenticated, service_role;

-- 旧版(タグを引いて判定していた頃)の関数が残っていたら片付ける。
-- 残しておくと、あとで読んだ人がどちらが本物か分からなくなる。
drop function if exists app_private.tag_hidden_from_me(bigint);


-- ------------------------------------------------------------
-- C-2. calendar_tags の RLS
--
-- 相手の非公開タグは、タグ一覧にも出さない。
-- タグ名(「通院」「面接」など)だけで中身が想像できてしまうため。
-- with check 側も同じ式にして、
--   ・他人を持ち主にした非公開タグ(= 自分に見えないタグ)を作れない
--   ・相手の非公開タグを書き換えられない
-- を同時に塞ぐ。
-- ------------------------------------------------------------

drop policy if exists household_rw on calendar_tags;
create policy household_rw on calendar_tags for all
  using (
    household_id in (select my_household_ids())
    and (private = false or owner_id = auth.uid())
  )
  with check (
    household_id in (select my_household_ids())
    and (private = false or owner_id = auth.uid())
  );


-- ------------------------------------------------------------
-- C-3. events の RLS
--
-- 【既存の household_rw をどうするか → drop しない。restrictive を1本足す】
--
--   理由。PostgreSQL のポリシーには2種類ある。
--     permissive (既定) … 複数あると【or】で足し算される = ゆるくなる一方
--     restrictive       … 複数あると【and】で掛け算される = 必ず絞る
--   もし「非公開を除く条件」を permissive で足したら、既存の household_rw が
--   「世帯が同じなら全部 OK」と言い続けるので or で吸収され、
--   何ひとつ制限できない。ここは初心者が必ず踏む罠なので明記しておく。
--
--   では household_rw を drop して1本に書き直せばよいかというと、それも弱い。
--   将来だれかが events に permissive なポリシーをもう1本足した瞬間、
--   or で穴が開く。restrictive は and なので、後から何を足されても
--   「非公開だけは守る」が残る。事故ったときの被害が一番大きい場所なので、
--   ゆるむ方向に倒れない書き方を選ぶ。
--
--   結果、events の判定は
--     household_rw (permissive: 世帯が同じか) 【and】
--     events_private_guard (restrictive: 隠すタグではないか)
--   になる。
--
-- 【using と with check の役割】
--   using      … 既にある行を触れるか(select / update の前の行 / delete)
--   with check … これから存在することになる行(insert / update の後の行)
--   両方に同じ式を入れる。これで塞げるのは:
--     ・自分に見えない行を作れてしまう
--       → 夫が「妻の非公開タグ」を付けた予定を insert しようとしても
--          with check で弾かれる(妻の非公開の中に文章を差し込めない)
--     ・見えない行を更新できてしまう
--       → using が古い行を弾くので、妻の非公開予定は夫の update に当たらない
--          (エラーではなく 0 行更新になる)
--     ・見える行を、見えない場所へ動かしてしまう
--       → with check が新しい行を弾く
-- ------------------------------------------------------------

-- 判定は列を見るだけ。関数を呼ばないので速く、
-- そして何より「タグが消えたら判定が変わる」ことが原理的に起きない。
--
-- auth.uid() が null(未ログイン)のときは private_owner_id = null が
-- NULL になって行が落ちる = 安全側に倒れる。
drop policy if exists events_private_guard on events;
create policy events_private_guard on events
  as restrictive
  for all
  using      (private_owner_id is null or private_owner_id = auth.uid())
  with check (private_owner_id is null or private_owner_id = auth.uid());

-- 既存の household_rw が消えていないことを保証しておく(消えていたら作る)。
-- restrictive だけの表は「permissive が1本も無い = 全部拒否」になるため。
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'events' and policyname = 'household_rw'
  ) then
    create policy household_rw on events for all
      using (household_id in (select my_household_ids()))
      with check (household_id in (select my_household_ids()));
  end if;
end $$;


-- ------------------------------------------------------------
-- C-4. event_comments の RLS
--
-- 非公開の予定に付いたコメントが相手から読めたら、隠した意味が無い。
-- 「何時に出る?」「駅で待ち合わせ」の中身がそのまま漏れる。
-- events と同じく restrictive を足す。
--
-- with check も必須。event_comments.event_id は bigserial なので
-- 1,2,3... と総当たりできる。無ければ「見えない予定にコメントだけ
-- 差し込む」ことができてしまう(相手の非公開画面に文章を出せてしまう)。
-- ------------------------------------------------------------

drop policy if exists event_comments_private_guard on event_comments;
create policy event_comments_private_guard on event_comments
  as restrictive
  for all
  using      (not app_private.event_hidden_from_me(event_id))
  with check (not app_private.event_hidden_from_me(event_id));

-- (索引は 08_schema_v3.sql の event_comments_event_idx (event_id, created_at) が
--  そのまま効くので足さない)


-- ------------------------------------------------------------
-- C-5. Supabase Realtime — 行の存在が通知だけで漏れないか
--
-- events は 07_schema_v2.sql:132 で、event_comments は 08_schema_v3.sql:65 で
-- publication supabase_realtime に入っている。
--
--  ・INSERT / UPDATE の通知は、購読者ごとに RLS を評価してから配られる。
--    今回のポリシーが効くので、妻の非公開予定を作っても夫には届かない。
--    → ここは対処不要。
--
--  ・【DELETE の通知は RLS で絞られない】。これは postgres_changes の仕様。
--    消えた行の中身は「replica identity(既定では主キーだけ)」しか
--    流れないので、漏れるのは「id 123 が消えた」という事実だけ。
--    タイトルも日付も内容も流れない。2人で使うアプリで id が1つ飛ぶことの
--    実害は小さいと判断して、今回はここまでとする。
--    完全に消したいなら events を publication から外し、必要な通知だけ
--    自前の broadcast で送る作りに変えるしかない(今回はやらない)。
--
--  ・【replica identity を full にしないこと】。full にすると DELETE / UPDATE の
--    old レコードに全列が乗る。DELETE は上のとおり RLS で絞られないので、
--    非公開予定の title がそのまま相手へ飛ぶ。既定(主キーのみ)のまま使う。
--    末尾の確認クエリで relreplident が 'd' であることを見ている。
--
--  ・Realtime はログイン済みの JWT で接続すること。anon のまま繋ぐと
--    RLS 評価が anon になり、そもそも何も届かない(supabase-js は
--    サインイン後にトークンを載せ替えるので通常は自動)。
--
--  ・calendar_tags は publication に入れない。タグは滅多に変わらず、
--    markStale → 再取得で十分。入れると非公開タグの id が DELETE 通知で
--    飛ぶという、得の無いリスクだけが増える。
-- ------------------------------------------------------------

-- (ビューは1つも作らない。作るときは必ず security_invoker = on。
--  06_patch_views_rls.sql のとおり、既定のビューは作成者権限で動いて
--  RLS を素通りし、過去に家計データが匿名に見えていた事故がある)


-- ------------------------------------------------------------
-- C-6. 【隠せていないものを、隠せているつもりにしないための一覧】
--
-- ここまでで「件名・場所・メモ・持ち物・URL・タグ名」は相手に届かない。
-- ただし【予定が“ある”という事実】は、次の3つの経路で漏れる。
-- どれも RLS では原理的に塞げない。伏せずに書いておく。
--
--  1. id の連番
--     events.id は 1, 2, 3… と増える通し番号(bigserial)で、世帯で共通。
--     夫が朝と夜に予定を1件ずつ足して、もらった id が 100 → 106 なら、
--     その間に見えない予定が5件作られたと分かる。
--     塞ぐには主キーをランダムな uuid にするしかないが、
--     アプリと IndexedDB が全部「id は数値」の前提で書かれているため
--     今回は見送る。漏れるのは件数と作られた時期だけで、中身は漏れない。
--
--  2. 削除の通知(Realtime)
--     下の C-5 のとおり、DELETE の通知だけは RLS で絞られない。
--     「見たことのない id が消えた」= 隠された予定が消された、が分かる。
--     流れるのは id だけで、件名は流れない。
--
--  3. 件数の概算(PostgREST の count=estimated)
--     プランナの見積りは RLS を適用する前の行数を元にするので、
--     自分に見えている正確な件数と突き合わせると、
--     世帯全体の予定の総数がおおよそ推定できる。
--
-- つまりこの設計が保証するのは
--   「何の予定かは絶対に分からない」であって、
--   「予定があること自体を完全に隠す」ではない。
-- 夫婦2人で使うアプリとして、ここまでを妥当な線と判断している。
-- ------------------------------------------------------------


-- ============================================================
-- D. todos の拡張(サブタスク / 繰り返し / 並び順)
-- ============================================================

-- 親を消したら子も消える。サブタスクは親から独立して意味を持たないので cascade。
-- (calendar_tags → events を set null にしたのと逆。あちらは
--  「タグが消えても予定は残ってほしい」、こちらは
--  「親が消えたら子も要らない」。同じ cascade でも判断は毎回別)
alter table todos add column if not exists parent_id bigint
  references todos(id) on delete cascade;

-- 繰り返し。値は events と同じ語彙にそろえる。
-- そろえておくと lib/event-labels.ts の occursOn() を
-- due_date → date のアダプタで使い回せる。
alter table todos add column if not exists repeat text not null default 'なし';
alter table todos add column if not exists repeat_until date;

alter table todos add column if not exists sort_order integer not null default 0;

-- 【毎日を入れ忘れないこと】
-- events の繰り返しには「毎日」が無い(予定を毎日入れる場面が無いため)が、
-- やることには要る(薬を飲む、水をやる)。アプリとチャットの両方が
-- 「毎日」を送るので、ここに無いと保存の瞬間に check 違反で落ちる。
--
-- if not exists で守らず毎回作り直すのは、過去に「毎日」抜きで作られた
-- 制約が残っていた場合に、それを直せるようにするため。
alter table todos drop constraint if exists todos_repeat_check;
alter table todos add constraint todos_repeat_check
  check (repeat in ('なし','毎日','毎週','隔週','毎月','毎年'));

create index if not exists todos_parent_idx on todos (parent_id);
create index if not exists todos_sort_idx on todos (household_id, sort_order, id);

-- 既存行の並び順を、いまの見え方(id 順)のまま引き継ぐ。
-- 全行 0 のとき = まだ誰も並べ替えていないとき【だけ】走らせる。
-- こうしておくと再実行してもユーザの並べ替えを壊さない。
do $$
begin
  if not exists (select 1 from todos where sort_order <> 0) then
    update todos set sort_order = id;
  end if;
end $$;


-- ------------------------------------------------------------
-- サブタスクは親子の2段まで
--
-- 孫を許すと、画面のインデントが無限に深くなるだけでなく、
-- parent_id を輪(a の親が b、b の親が a)にできてしまう。
-- 輪ができると on delete cascade が何を消すか読めなくなる。
-- 「親は必ず parent_id が null の行」に固定すれば、輪は原理的に作れない。
-- ------------------------------------------------------------

create or replace function public.todos_depth_guard()
returns trigger language plpgsql as $fn$
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception '自分自身を親にはできません。';
  end if;
  if exists (select 1 from todos p where p.id = new.parent_id and p.parent_id is not null) then
    raise exception 'サブタスクの下にさらにサブタスクは作れません(親子の2段まで)。';
  end if;
  return new;
end
$fn$;

drop trigger if exists todos_depth_guard on todos;
create trigger todos_depth_guard
  before insert or update on todos
  for each row execute function public.todos_depth_guard();


-- ------------------------------------------------------------
-- 【設計メモ】繰り返す TODO を「完了」にしたら何が起きるか
--
-- 3案を比べた。
--
--   案1 完了したら行を複製して、次回ぶんの新しい行を作る。
--       済んだ行は status = 'done' のまま履歴として残る。
--       → 履歴は残るが行が増え続ける。サブタスクも一緒に複製が要る。
--         並び順(sort_order)も毎回振り直しになる。
--         決定的にまずいのは lib/use-table.ts が select * で全行を
--         IndexedDB に書く設計なこと。行が増え続ける = 端末のキャッシュが
--         そのまま太る。毎日のゴミ出しを1年続けたら365行。
--
--   案2 todos は1行のまま、完了した日を別テーブル(todo_log)に積む。
--       → 一番きれいだが、表もミューテーションも画面も増える。
--         同じことは既に chores / chore_log でやっていて、
--         「繰り返す家事」はそちらの担当。二重に持つ意味が薄い。
--
--   案3【採用】完了を押したら、行はそのままに due_date を次回へ進める。
--       status は 'open' のまま。done_at / done_by は
--       「最後にやった日 / 最後にやった人」として上書きする。
--       → 行は1本。増えない。サブタスクは status を open に戻して
--         親と一緒に次回へ持っていくだけ。実装は setTodoDone の中で
--         「repeat が 'なし' 以外なら due_date を次回に進める」の分岐1つ。
--
-- 採用理由。このアプリで欲しいのは「今日やること」であって
-- 「先週ゴミを出した記録」ではない。記録が要る家事は chore_log がある。
-- 案3の弱点は履歴が残らないこと。後で欲しくなったら、そのとき
-- todo_log を足して setTodoDone から1行 insert すればよく、
-- todos 側の形は変えずに済む(後から案2へ足せる形になっている)。
--
-- 次回の日付の計算は SQL には持たせない。events と同じく
-- lib/event-labels.ts の occursOn() / 同じ語彙(毎週・隔週・毎月・毎年)を
-- 使ってアプリ側で出す。DB とアプリで繰り返しの解釈が2つに割れるのが一番怖い。
--
-- repeat_until を過ぎたら、次回へ進めずに status = 'done' で終わらせる。
-- ------------------------------------------------------------


-- ============================================================
-- 【必読】非公開が本当に効いているかを SQL だけで確かめる手順
--
-- なぜ手順が要るか:
--   Supabase の SQL Editor は postgres ロールで動く。postgres は
--   BYPASSRLS を持つので、RLS を【全部素通りして】全行見える。
--   そのまま select して「見えるじゃないか」と焦っても意味が無いし、
--   逆に「見えるから漏れている」と誤解する。必ずロールを切り替えて試す。
--
-- 準備:
--   -- 2人の user_id を控える
--   select user_id, display_name, household_id from household_members;
--
--   -- 妻の非公開タグを1つ作る(postgres のまま実行してよい)
--   insert into calendar_tags (household_id, name, color, private, owner_id, sort_order)
--     values ('<世帯id>', 'ひみつ', 'rose', true, '<妻の user_id>', 50)
--     returning id;                       -- ← 出た id を控える(以下 <妻タグid>)
--
--   -- そのタグを付けた予定と、そこへのコメントを1件ずつ作る
--   insert into events (household_id, date, title, tag_id, created_by)
--     values ('<世帯id>', current_date, 'ひみつの用事', <妻タグid>, '<妻の user_id>')
--     returning id;                       -- ← 以下 <ひみつ予定id>
--   insert into event_comments (household_id, event_id, user_id, body)
--     values ('<世帯id>', <ひみつ予定id>, '<妻の user_id>', '18時に出る');
--
-- テスト①: 夫になりすます → 何も見えないこと
--   begin;
--     select set_config('request.jwt.claims',
--            json_build_object('sub','<夫の user_id>','role','authenticated')::text, true);
--     set local role authenticated;
--
--     select auth.uid();
--       --> 夫の uuid が返ること。null ならなりすませていない(以下のテストは無意味)
--
--     select id, title, tag_id from events order by id;
--       --> <ひみつ予定id> の行が【1行も出ない】こと
--
--     select id, name, private from calendar_tags order by id;
--       --> 'ひみつ' タグが【出ない】こと(タグ名だけでも中身が想像できるため)
--
--     select count(*) from event_comments where event_id = <ひみつ予定id>;
--       --> 0 であること
--
--     -- 見えない行を作れないこと(エラーになるのが正解)
--     insert into events (household_id, date, title, tag_id)
--       values ('<世帯id>', current_date, 'のぞき見テスト', <妻タグid>);
--       --> ERROR: new row violates row-level security policy for table "events"
--
--     -- 見えない行を更新できないこと(エラーではなく 0 行更新が正解)
--     update events set title = '書き換えテスト' where id = <ひみつ予定id>;
--       --> UPDATE 0
--
--     -- 見えない行を消せないこと(0 行削除が正解)
--     delete from events where id = <ひみつ予定id>;
--       --> DELETE 0
--
--     -- 見えない予定にコメントを差し込めないこと(エラーになるのが正解)
--     insert into event_comments (household_id, event_id, body)
--       values ('<世帯id>', <ひみつ予定id>, 'のぞき見');
--       --> ERROR: new row violates row-level security policy for table "event_comments"
--   rollback;   -- ← テストの痕跡を残さない。必ず rollback で閉じる
--
-- テスト②: 妻になりすます → 自分のものは必ず見えること
--   begin;
--     select set_config('request.jwt.claims',
--            json_build_object('sub','<妻の user_id>','role','authenticated')::text, true);
--     set local role authenticated;
--     select id, title from events where id = <ひみつ予定id>;   --> 1行【出る】こと
--     select count(*) from event_comments where event_id = <ひみつ予定id>;  --> 1 であること
--   rollback;
--
-- テスト③: 共有の予定は今までどおり2人とも見えること
--   ①②と同じ手順で、tag_id が null の予定 と 公開タグの予定 を
--   夫・妻どちらのなりすましでも同じ件数見えることを確かめる。
--   ここが減っていたら、非公開の実装が共有の予定まで巻き込んでいる。
--
-- 後始末:
--   delete from events where id = <ひみつ予定id>;   -- コメントは cascade で消える
--   delete from calendar_tags where id = <妻タグid>;
-- ============================================================


-- ============================================================
-- 実行後の確認
--
-- 【全部の 結果 が 期待 と同じなら成功】。1行でも違ったら止まって調べる。
-- (SQL Editor は最後の select しか表示しないので、1本にまとめてある)
-- ============================================================

select *
from (values
  ('calendar_tags テーブルができた',
   (select count(*)::text from information_schema.tables
     where table_schema = 'public' and table_name = 'calendar_tags'), '1'),

  ('calendar_tags の RLS が有効',
   (select relrowsecurity::text from pg_class
     where relname = 'calendar_tags' and relnamespace = 'public'::regnamespace), 'true'),

  ('既定タグが世帯ぶん入った(= 世帯数 x 6 以上)',
   (select (count(*) >= (select count(*) * 6 from households))::text
      from calendar_tags where private = false), 'true'),

  ('非公開タグの持ち主が全部埋まっている',
   (select count(*)::text from calendar_tags where private and owner_id is null), '0'),

  ('events に列を6つ足せた(tag_id/location/url/items/notify_min/private_owner_id)',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'events'
       and column_name in ('tag_id','location','url','items','notify_min',
                           'private_owner_id')), '6'),

  ('秘密を予定の行に写すトリガが付いている(タグを消しても漏れない土台)',
   (select count(*)::text from pg_trigger
     where tgrelid = 'public.events'::regclass
       and tgname = 'events_apply_tag_privacy' and not tgisinternal), '1'),

  ('使用中の非公開タグを消せないトリガが付いている',
   (select count(*)::text from pg_trigger
     where tgrelid = 'public.calendar_tags'::regclass
       and tgname = 'calendar_tags_block_used_private_delete' and not tgisinternal), '1'),

  ('タグ名の一意索引が2本に分かれている(1本だと名前の存在が漏れる)',
   (select count(*)::text from pg_indexes
     where schemaname = 'public' and tablename = 'calendar_tags'
       and indexname in ('calendar_tags_shared_name_uidx',
                         'calendar_tags_private_name_uidx')), '2'),

  ('旧・全体の一意制約が残っていない',
   (select count(*)::text from pg_constraint
     where conname = 'calendar_tags_household_id_name_key'), '0'),

  ('非公開の予定に、公開タグ名が label として残っていない',
   (select count(*)::text from events e
     join calendar_tags t on t.id = e.tag_id
    where t.private and e.label is not null), '0'),

  ('label があるのに tag_id に移せなかった予定の数',
   (select count(*)::text from events
     where label is not null and btrim(label) <> '' and tag_id is null), '0'),

  ('tag_id が入った予定の数(参考。0 でも label が無いだけなら正常)',
   (select count(*)::text from events where tag_id is not null), '(参考)'),

  ('events の RLS が有効',
   (select relrowsecurity::text from pg_class
     where relname = 'events' and relnamespace = 'public'::regnamespace), 'true'),

  ('events に permissive の household_rw がある',
   (select count(*)::text from pg_policies
     where schemaname = 'public' and tablename = 'events'
       and policyname = 'household_rw' and permissive = 'PERMISSIVE'), '1'),

  ('events に restrictive の非公開ガードがある',
   (select count(*)::text from pg_policies
     where schemaname = 'public' and tablename = 'events'
       and policyname = 'events_private_guard' and permissive = 'RESTRICTIVE'), '1'),

  ('event_comments に restrictive の非公開ガードがある',
   (select count(*)::text from pg_policies
     where schemaname = 'public' and tablename = 'event_comments'
       and policyname = 'event_comments_private_guard' and permissive = 'RESTRICTIVE'), '1'),

  ('コメント用の判定関数が security definer',
   (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_private'
       and p.proname = 'event_hidden_from_me'
       and p.prosecdef), '1'),

  ('判定関数が public に漏れていない(HTTP から呼べない)',
   (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'event_hidden_from_me'), '0'),

  ('events の replica identity が既定(d)= DELETE 通知に中身が乗らない',
   (select relreplident::text from pg_class
     where relname = 'events' and relnamespace = 'public'::regnamespace), 'd'),

  ('event_comments の replica identity が既定(d)',
   (select relreplident::text from pg_class
     where relname = 'event_comments' and relnamespace = 'public'::regnamespace), 'd'),

  ('events がリアルタイム配信に入っている',
   (select count(*)::text from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'events'), '1'),

  ('calendar_tags はリアルタイム配信に入れていない',
   (select count(*)::text from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'calendar_tags'), '0'),

  ('todos に列を4つ足せた(parent_id/repeat/repeat_until/sort_order)',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'todos'
       and column_name in ('parent_id','repeat','repeat_until','sort_order')), '4'),

  ('todos の親子が2段までに収まっている(孫がいない)',
   (select count(*)::text from todos c
      join todos p on p.id = c.parent_id
     where p.parent_id is not null), '0'),

  ('security_invoker が付いていないビューの数(過去の事故の再発チェック)',
   (select count(*)::text from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and not ('security_invoker=on' = any(coalesce(c.reloptions, '{}')))), '0')
) as t(項目, 結果, 期待);
