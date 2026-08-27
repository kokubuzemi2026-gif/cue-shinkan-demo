-- T17: メール変更によってドメイン外になった既存ユーザーはRLSを通過できない
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000701', 'demo-drift@stu.kobe-u.ac.jp', now(), now(), now());

-- 大学ユーザーとして新入生権限と団体を持つ
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
set local role authenticated;
insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-000000000701');
create temp table dorg as select public.create_organization('ドリフトテスト団体') as id;
select ok(public.is_university_user(), 'T17前提: 変更前はis_university_user=true');
select is((select count(*)::int from public.student_accounts), 1, 'T17前提: 自分のアカウントが見える');
select is((select count(*)::int from public.organizations), 1, 'T17前提: 所属団体が見える');
reset role;

-- メールがドメイン外へ変更された（auth.users.emailの現在値が正本であることの検証）
update auth.users
   set email = 'demo-drift@example.com'
 where id = '00000000-0000-0000-0000-000000000701';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated"}', true);
set local role authenticated;
select ok(not public.is_university_user(), 'T17: 変更後はis_university_user=false');
select is_empty($$select 1 from public.student_accounts$$, 'T17: 自分のstudent_accountも読めなくなる');
select is_empty($$select 1 from public.organizations$$, 'T17: 所属団体も読めなくなる');
select is_empty($$select 1 from public.organization_memberships$$, 'T17: 所属行も読めなくなる');
select throws_ok(
  $$select public.update_organization_profile((select id from dorg), '改名', '')$$,
  'not_authorized',
  'T17: 団体RPCも実行できない'
);
select throws_ok(
  $$select public.create_invitation((select id from dorg))$$,
  'not_authorized',
  'T17: 招待作成もできない'
);
select throws_ok(
  $$insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-000000000701')$$,
  '42501', null,
  'T17: student_accountの再作成もできない'
);
reset role;

select * from finish();
rollback;
