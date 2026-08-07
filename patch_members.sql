-- ============================================================
-- 追加パッチ(schema.sql の後に実行する。任意)
--
-- schema.sql の own_membership ポリシーは「自分の行」しか返さないため、
-- アプリから相手の display_name が読めず、設計書 3-2 の
-- 「誰がチェックしたかを薄く表示」が『パートナー』の固定表示になる。
-- 同じ世帯のメンバーだけ見えるように差し替える。
--
-- my_household_ids() は security definer(RLS を迂回する)なので、
-- household_members のポリシーから参照しても再帰しない。
-- ============================================================

drop policy if exists own_membership on household_members;

create policy household_members_visible on household_members for select
  using (household_id in (select my_household_ids()));
