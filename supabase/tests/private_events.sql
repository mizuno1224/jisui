-- ============================================================
-- private_events.sql — 非公開の予定が本当に隠れているかを実測する
--
-- 【いつ使うか】
--   11_schema_v5.sql を流したあと1回。以降、予定まわりを触ったときにも流す。
--   Supabase の SQL Editor に丸ごと貼って Run するだけ。
--
-- 【なぜ要るか】
--   「ポリシーを書いた」と「隠せている」は別物。過去にこのアプリでは、
--   テーブルに RLS を付けたのにビュー経由で家計データが匿名に漏れていた。
--   設定画面が緑でも意味が無い。実際に別人になりすまして叩いて確かめる。
--
-- 【なぜ普通に select しても意味が無いか】
--   SQL Editor は postgres ロールで動く。postgres は BYPASSRLS を持つので
--   RLS を全部素通りして全行見える。「見えるじゃないか」と焦っても無意味だし、
--   「見えるから漏れている」と誤解する。必ずロールを切り替えて試す。
--
-- 【安全性】
--   テスト用のタグ・予定・コメントを作って、最後に必ず消す。
--   途中で失敗しても消えるようにしてある(例外を捕まえて後始末してから投げ直す)。
--   既存のデータには一切触らない。
--
-- 【結果の読み方】
--   ・「すべて合格」と出れば、非公開は効いている。
--   ・どこかで失敗すると、何が起きたかを日本語で書いたエラーが出る。
--     その文面をそのまま持ってくれば原因が分かる。
-- ============================================================

do $$
declare
  v_household uuid;
  v_a uuid;              -- 隠す側(この人の非公開タグを作る)
  v_b uuid;              -- 見られない側
  v_name_a text;
  v_name_b text;
  v_tag bigint;
  v_event bigint;
  v_shared_event bigint;
  v_comment bigint;
  v_seen int;
  v_code text;
begin
  -- ---------------------------------------------------------- 準備
  select hm.household_id into v_household from household_members hm limit 1;
  if v_household is null then
    raise exception '世帯が1つもありません。01_schema.sql と 03_patch_members.sql を先に流してください。';
  end if;

  select user_id, display_name into v_a, v_name_a
    from household_members where household_id = v_household order by user_id limit 1;
  select user_id, display_name into v_b, v_name_b
    from household_members where household_id = v_household and user_id <> v_a
    order by user_id limit 1;

  if v_b is null then
    raise exception '世帯に人が1人しかいません。2人いないと「相手から見えないこと」を試せません。';
  end if;

  raise notice '隠す側: % / 見られない側: %', coalesce(v_name_a, '(名前なし)'), coalesce(v_name_b, '(名前なし)');

  -- A の非公開タグ
  insert into calendar_tags (household_id, name, color, private, owner_id, sort_order)
  values (v_household, '__テスト用の非公開__', 'slate', true, v_a, 999)
  returning id into v_tag;

  -- そのタグを付けた予定(中身は分かりやすい文字列にしておく)
  insert into events (household_id, date, title, memo, location, items, tag_id, created_by)
  values (v_household, current_date, '__テスト_ひみつの予定__', '__テスト_メモ__',
          '__テスト_場所__', '__テスト_持ち物__', v_tag, v_a)
  returning id into v_event;

  insert into event_comments (household_id, event_id, user_id, body)
  values (v_household, v_event, v_a, '__テスト_コメント__')
  returning id into v_comment;

  -- 比較用の、タグなしの共有予定
  insert into events (household_id, date, title, created_by)
  values (v_household, current_date, '__テスト_共有の予定__', v_a)
  returning id into v_shared_event;

  -- ------------------------------------------------ 検査1: 秘密が行に焼き付いたか
  select count(*) into v_seen from events
   where id = v_event and private_owner_id = v_a;
  if v_seen <> 1 then
    raise exception E'検査1 失敗: events.private_owner_id にタグの持ち主が入っていません。\n'
      '  → B章のトリガ events_apply_tag_privacy が付いていない可能性があります。';
  end if;

  -- ------------------------------------------------ 検査2: label にタグ名が残っていないか
  select count(*) into v_seen from events where id = v_event and label is not null;
  if v_seen <> 0 then
    raise exception E'検査2 失敗: 非公開タグの名前が events.label に残っています。\n'
      '  → 後で共有タグに付け替えたとき、タグ名だけが相手に出ます。';
  end if;

  -- ------------------------------------------------ 検査3〜6: B になりすます
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 検査3: 予定が見えないこと
  select count(*) into v_seen from events where id = v_event;
  if v_seen <> 0 then
    execute 'reset role';
    raise exception E'検査3 失敗【重大】: 相手から非公開の予定が見えています(% 件)。\n'
      '  → events の restrictive ポリシー events_private_guard を確認してください。', v_seen;
  end if;

  -- 検査4: コメントが読めないこと
  select count(*) into v_seen from event_comments where event_id = v_event;
  if v_seen <> 0 then
    execute 'reset role';
    raise exception E'検査4 失敗【重大】: 相手から非公開予定のコメントが読めています。\n'
      '  → event_comments_private_guard を確認してください。';
  end if;

  -- 検査5: タグ一覧にも出ないこと(タグ名だけで中身が想像できるため)
  select count(*) into v_seen from calendar_tags where id = v_tag;
  if v_seen <> 0 then
    execute 'reset role';
    raise exception E'検査5 失敗: 相手の非公開タグが一覧に出ています。';
  end if;

  -- 検査6: 共有の予定は今までどおり見えること
  --        (非公開の実装が共有まで巻き込んでいないか)
  select count(*) into v_seen from events where id = v_shared_event;
  if v_seen <> 1 then
    execute 'reset role';
    raise exception E'検査6 失敗: 共有の予定まで見えなくなっています。\n'
      '  → 非公開の判定が広すぎます。共有の予定は2人とも見えなければいけません。';
  end if;

  -- 検査7: 「存在するか」をエラーの違いで探れないこと
  --        隠された予定と、存在しない予定が、同じエラーになるのが正解。
  --        違うエラーが返ると、id を順に試すだけで相手の予定の件数が数えられる。
  begin
    insert into event_comments (household_id, event_id, user_id, body)
    values (v_household, v_event, v_b, '__のぞき見__');
    execute 'reset role';
    raise exception E'検査7 失敗【重大】: 見えないはずの予定にコメントを差し込めました。';
  exception
    when insufficient_privilege then
      v_code := '42501';                       -- これが正解
    when foreign_key_violation then
      execute 'reset role';
      raise exception E'検査7 失敗【重大】: 隠した予定が「外部キー違反(23503)」で返っています。\n'
        '  → 存在しない予定と区別が付くので、id を順に試すだけで\n'
        '     相手の非公開予定の件数と id が割り出せます。\n'
        '  → app_private.event_hidden_from_me の coalesce の既定値を true にしてください。';
    when others then
      execute 'reset role';
      raise;
  end;

  -- 検査8: 存在しない予定も、同じ 42501 で返ること
  begin
    insert into event_comments (household_id, event_id, user_id, body)
    values (v_household, 999999999, v_b, '__のぞき見__');
    execute 'reset role';
    raise exception E'検査8 失敗: 存在しない予定にコメントが入ってしまいました。';
  exception
    when insufficient_privilege then
      null;                                    -- 検査7 と同じエラー = 区別が付かない = 正解
    when foreign_key_violation then
      execute 'reset role';
      raise exception E'検査8 失敗【重大】: 存在しない予定は 23503、隠した予定は 42501 と\n'
        '  エラーが分かれています。この違いで存在を数えられます。';
    when others then
      execute 'reset role';
      raise;
  end;

  execute 'reset role';

  -- ------------------------------------------------ 検査9: A 本人には見えること
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_seen from events where id = v_event;
  if v_seen <> 1 then
    execute 'reset role';
    raise exception E'検査9 失敗: 本人からも非公開の予定が見えません(% 件)。\n'
      '  → 隠しすぎです。入れた本人だけは必ず見えなければいけません。', v_seen;
  end if;

  select count(*) into v_seen from event_comments where event_id = v_event;
  if v_seen <> 1 then
    execute 'reset role';
    raise exception E'検査9 失敗: 本人からコメントが読めません。';
  end if;

  select count(*) into v_seen from calendar_tags where id = v_tag;
  if v_seen <> 1 then
    execute 'reset role';
    raise exception E'検査9 失敗: 本人のタグ一覧に自分の非公開タグが出ません。';
  end if;

  execute 'reset role';

  -- ------------------ 検査10: 使っている非公開タグは消せないこと
  --
  --   消せても秘密は漏れない(検査11 で確かめる)が、消した本人が
  --   「色が戻っただけ」と思っているのに、実際にはその予定が
  --   相手から見えないまま残るという分かりにくい状態になる。
  --   だからトリガで止めてある。
  begin
    delete from calendar_tags where id = v_tag;
    raise exception E'検査10 失敗: 使用中の非公開タグを消せてしまいました。\n'
      '  → calendar_tags_block_used_private_delete トリガが付いていません。';
  exception
    when raise_exception then
      -- トリガが投げたのか、上の「失敗」なのかを見分ける。
      -- 文面に「失敗」とあればこちらが投げたものなので、そのまま上へ流す。
      if position('検査10 失敗' in sqlerrm) > 0 then
        raise;
      end if;
  end;

  -- ------------------ 検査11: それでもタグが外れたとき、秘密が残ること
  --
  --   【ここが今回の設計の要】
  --   外部キーの on delete set null は RLS を通らずに events.tag_id を空にする。
  --   今はトリガで削除を止めているが、この先誰かがトリガを外したり、
  --   持ち主のアカウントが消えて連鎖したりすれば、tag_id は空になる。
  --   そのときに秘密が解ける実装だと、【普通の操作で全部相手に出る】。
  --   最初の設計は実際にこうなっていて、それを直すために
  --   private_owner_id を予定の行に焼き付ける形にした。
  --
  --   tag_id を空にするのは、set null が通るのと同じ道すじ。
  update events set tag_id = null where id = v_event;

  select count(*) into v_seen from events
   where id = v_event and private_owner_id = v_a;
  if v_seen <> 1 then
    raise exception E'検査11 失敗【重大】: タグが外れたら秘密も消えました。\n'
      '  → 非公開の判定をタグ側に持たせています。events.private_owner_id に\n'
      '     焼き付けてください。タグを消すだけで全部漏れます。';
  end if;

  select count(*) into v_seen from events where id = v_event and label is not null;
  if v_seen <> 0 then
    raise exception E'検査11 失敗: タグを外したときに label へタグ名が入りました。';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_seen from events where id = v_event;
  execute 'reset role';
  if v_seen <> 0 then
    raise exception E'検査11 失敗【重大】: タグが外れたあと、相手から予定が見えています。';
  end if;

  -- ---------------------------------------------------------- 後始末
  delete from events where id in (v_event, v_shared_event);   -- コメントは cascade で消える
  delete from calendar_tags where id = v_tag;                 -- 予定が無くなったので消せる

  raise notice '----------------------------------------';
  raise notice 'すべて合格。非公開の予定は相手から見えません。';
  raise notice '  検査1  秘密が予定の行に焼き付いている';
  raise notice '  検査2  タグ名が label に残っていない';
  raise notice '  検査3  相手から予定が見えない';
  raise notice '  検査4  相手からコメントが読めない';
  raise notice '  検査5  相手のタグ一覧に出ない';
  raise notice '  検査6  共有の予定は今までどおり見える';
  raise notice '  検査7  隠した予定の存在をエラーで探れない';
  raise notice '  検査8  存在しない予定と同じエラーになる';
  raise notice '  検査9  本人には必ず見える';
  raise notice '  検査10 使用中の非公開タグは消せない';
  raise notice '  検査11 タグが外れても秘密が残る';
  raise notice '----------------------------------------';

exception
  when others then
    -- 失敗しても後始末はする。テスト用の行を残さない。
    begin
      execute 'reset role';
    exception when others then null;
    end;
    -- 【LIKE を使わない】SQL の LIKE では _ が「任意の1文字」の意味になるので、
    -- '__テスト%' は「任意の2文字 + テスト」に当たる。
    -- 本物の予定を巻き込んで消しかねないので、作った id だけを指す。
    delete from events where id in (v_event, v_shared_event);
    delete from calendar_tags where id = v_tag;
    raise;
end $$;

-- 上の DO ブロックが最後まで通れば、ここが表示される。
-- 途中で止まった場合は赤いエラーが出て、これは表示されない。
select '✅ すべて合格。非公開の予定は相手から見えません。' as 結果,
       '検査の内訳は上の Messages / Notices タブに出ています' as 備考;
