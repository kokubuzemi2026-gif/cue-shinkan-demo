-- T6: 団体所属者は所属団体だけを読める
-- T7: 団体外ユーザーは団体データを読めない
-- T11: 一般利用者が団体をverifiedにできない（statusのクライアント変更経路が存在しない）
-- T12: direct INSERT/UPDATE/DELETEで権限を迂回できない（organizations/memberships分）
-- F6: update_organization_profileの権限・検証・status不変
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000201', 'demo-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000202', 'demo-admin@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000203', 'demo-member@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000204', 'demo-outsider@stu.kobe-u.ac.jp', now(), now(), now());

-- ownerがF5で団体を作成
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
set local role authenticated;
create temp table org1 as select public.create_organization('RLSテスト団体', '説明') as id;
reset role;

-- admin/memberを追加（postgres・運営相当の直接操作）
insert into public.organization_memberships (organization_id, user_id, role, member_label)
select id, '00000000-0000-0000-0000-000000000202', 'admin', '担当者-TESTAD' from org1;
insert into public.organization_memberships (organization_id, user_id, role, member_label)
select id, '00000000-0000-0000-0000-000000000203', 'member', '担当者-TESTME' from org1;

-- ---- owner: 所属団体が見え、直接DMLはすべて拒否される ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.organizations),
  1,
  'T6: ownerは所属団体を読める'
);
select throws_ok(
  $$update public.organizations set name = '書換' $$,
  '42501', null,
  'T12: organizationsを直接UPDATEできない（grantなし）'
);
select throws_ok(
  $$update public.organizations set status = 'verified'$$,
  '42501', null,
  'T11: statusを直接UPDATEでverifiedにできない'
);
select throws_ok(
  $$insert into public.organizations (name) values ('直接作成')$$,
  '42501', null,
  'T12: organizationsを直接INSERTできない'
);
select throws_ok(
  $$delete from public.organizations$$,
  '42501', null,
  'T12: organizationsを直接DELETEできない'
);
select throws_ok(
  $$insert into public.organization_memberships (organization_id, user_id, role, member_label)
    select id, '00000000-0000-0000-0000-000000000204', 'owner', '担当者-EVIL01' from org1$$,
  '42501', null,
  'T12: membershipsを直接INSERTできない'
);
select lives_ok(
  $$select public.update_organization_profile((select id from org1), '改名した団体', '新しい説明')$$,
  'F6: ownerはプロフィールを更新できる'
);
reset role;

select is(
  (select name from public.organizations where id = (select id from org1)),
  '改名した団体',
  'F6: nameが更新されている'
);
select is(
  (select status from public.organizations where id = (select id from org1)),
  'pending'::public.org_status,
  'T11/F6: F6経由でもstatusはpendingのまま変わらない'
);

-- ---- admin: F6可 / member: F6不可 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000202","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.update_organization_profile((select id from org1), '管理者が改名', '')$$,
  'F6: adminもプロフィールを更新できる'
);
select throws_ok(
  $$select public.update_organization_profile((select id from org1), '', '')$$,
  'invalid_org_name',
  'F6: 空白のみの団体名は拒否される'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000203","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.organizations),
  1,
  'T6: memberも所属団体を読める'
);
select throws_ok(
  $$select public.update_organization_profile((select id from org1), 'メンバーが改名', '')$$,
  'not_authorized',
  'F6: memberはプロフィールを更新できない'
);
reset role;

-- ---- 非所属ユーザー: 団体データが一切見えない・操作できない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000204","role":"authenticated"}', true);
set local role authenticated;
select is_empty(
  $$select 1 from public.organizations$$,
  'T7: 非所属ユーザーに団体は見えない'
);
select is_empty(
  $$select 1 from public.organization_memberships$$,
  'T7: 非所属ユーザーに所属行は見えない'
);
select throws_ok(
  $$select public.update_organization_profile((select id from org1), '外部者が改名', '')$$,
  'not_authorized',
  'T7: 非所属ユーザーはF6を実行できない'
);
reset role;

select * from finish();
rollback;
