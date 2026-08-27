-- T18: 最後のownerを失う操作を拒否する
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000801', 'demo-lastowner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000802', 'demo-secondowner@stu.kobe-u.ac.jp', now(), now(), now());

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000801","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
set local role authenticated;
create temp table lorg as select public.create_organization('最終ownerテスト団体') as id;
reset role;

-- ---- 唯一のownerはdemoteも削除もできない（運営権限のpostgresでも拒否される） ----
select throws_ok(
  $$update public.organization_memberships set role = 'member'
     where organization_id = (select id from lorg)
       and user_id = '00000000-0000-0000-0000-000000000801'$$,
  'last_owner',
  'T18: 唯一のownerをmemberへdemoteできない'
);
select throws_ok(
  $$delete from public.organization_memberships
     where organization_id = (select id from lorg)
       and user_id = '00000000-0000-0000-0000-000000000801'$$,
  'last_owner',
  'T18: 唯一のownerを削除できない'
);

-- ---- ownerが2人いれば片方の操作は可能。残り1人になれば再び拒否 ----
insert into public.organization_memberships (organization_id, user_id, role, member_label)
select id, '00000000-0000-0000-0000-000000000802', 'owner', '担当者-OWNER2' from lorg;

select lives_ok(
  $$update public.organization_memberships set role = 'member'
     where organization_id = (select id from lorg)
       and user_id = '00000000-0000-0000-0000-000000000801'$$,
  'T18: 他にownerがいればdemoteできる'
);
select throws_ok(
  $$delete from public.organization_memberships
     where organization_id = (select id from lorg)
       and user_id = '00000000-0000-0000-0000-000000000802'$$,
  'last_owner',
  'T18: 残った唯一のownerは削除できない'
);
select lives_ok(
  $$update public.organization_memberships set role = 'owner'
     where organization_id = (select id from lorg)
       and user_id = '00000000-0000-0000-0000-000000000801'$$,
  'T18: ownerへの昇格は制限されない'
);
select lives_ok(
  $$delete from public.organization_memberships
     where organization_id = (select id from lorg)
       and user_id = '00000000-0000-0000-0000-000000000802'$$,
  'T18: ownerが2人いれば片方を削除できる'
);

-- ---- 団体ごとの削除（cascade）は許容される ----
select lives_ok(
  $$delete from public.organizations where id = (select id from lorg)$$,
  'T18: 団体自体の削除はcascadeで許容される'
);
select is(
  (select count(*)::int from public.organization_memberships
    where organization_id = (select id from lorg)),
  0,
  'T18: cascadeで所属行も消えている'
);

select * from finish();
rollback;
