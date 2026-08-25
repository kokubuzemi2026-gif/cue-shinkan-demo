-- T16: 団体向け関数・viewから学生PII（メール・氏名・学籍番号・auth.users.id）や
--      学生一覧を取得できない
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

-- ---- 関数シグネチャの検査: 団体向けRPCの戻り列にPII列が存在しない ----
select is(
  (select p.proargnames::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'org_member_directory'),
  '{org_id,member_label,role,joined_at,is_self}',
  'T16: org_member_directoryの列はラベル・権限・参加日時・自分かどうかの4列のみ'
);
select is(
  (select p.proargnames::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_invitations'),
  '{org_id,id,invited_role,created_at,expires_at,state}',
  'T16: list_invitationsはtoken_hash・作成者user_idを返さない'
);
select is(
  (select p.proargnames::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'preview_invitation'),
  '{invitation_token,organization_name,invited_role,expires_at}',
  'T16: preview_invitationは団体名・役割・期限のみ返す'
);
select is(
  (select p.proargnames::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_invitation'),
  '{invitation_token,organization_id,organization_name}',
  'T16: accept_invitationは団体ID・団体名のみ返す'
);

-- ---- 実データでの検査 ----
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000601', 'demo-pii-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000602', 'demo-pii-student@stu.kobe-u.ac.jp', now(), now(), now());

-- 602は新入生（他人の学生アカウント）
insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-000000000602');

-- 601が団体を作成し、602もメンバーに加える（postgres・運営相当）
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000601","role":"authenticated"}', true);
set local role authenticated;
create temp table porg as select public.create_organization('PIIテスト団体') as id;
reset role;
insert into public.organization_memberships (organization_id, user_id, role, member_label)
select id, '00000000-0000-0000-0000-000000000602', 'member', '担当者-PIIME1' from porg;

-- ---- 団体担当者（601）の視点 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000601","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.org_member_directory((select id from porg))),
  2,
  'F12: 担当者一覧は2名分のラベル行を返す'
);
select is(
  (select count(*)::int from public.org_member_directory((select id from porg)) d where d.is_self),
  1,
  'F12: is_selfは自分の行だけtrue'
);
select ok(
  (select bool_and(d.member_label like '担当者-%')
     from public.org_member_directory((select id from porg)) d),
  'F12: 表示はPIIを含まないラベルのみ'
);
select throws_ok(
  'select email from auth.users',
  '42501', null,
  'T16: 団体担当者はauth.users（メール）を読めない'
);
select is_empty(
  $$select 1 from public.student_accounts$$,
  'T16: 団体担当者は他学生のstudent_accountsを読めない（自分の分も未登録なら0行）'
);
select throws_ok(
  'select token_hash from private.organization_invitations',
  '42501', null,
  'T16: 団体担当者は招待テーブル（token_hash）へ直接到達できない'
);
reset role;

select * from finish();
rollback;
