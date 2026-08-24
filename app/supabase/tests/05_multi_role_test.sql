-- T8: 一人が新入生権限と団体所属を同時に持てる
-- T9: 一団体に複数の人間アカウントが所属できる
-- T10: 一人が複数団体へ所属できる
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000301', 'demo-multi@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000302', 'demo-second@stu.kobe-u.ac.jp', now(), now(), now());

-- U: 新入生権限 + 2団体のowner
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000301","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-000000000301')$$,
  'T8: 団体所属者になる予定のユーザーが新入生権限も登録できる'
);
create temp table morg1 as select public.create_organization('兼任テスト団体A') as id;
create temp table morg2 as select public.create_organization('兼任テスト団体B') as id;
select is(
  (select count(*)::int from public.student_accounts where user_id = '00000000-0000-0000-0000-000000000301'),
  1,
  'T8: 新入生権限を保持したまま団体を作成できている'
);
select is(
  (select count(*)::int from public.organization_memberships where user_id = '00000000-0000-0000-0000-000000000301'),
  2,
  'T10: 一人が複数団体（2団体）へ所属できる'
);
reset role;

-- V: 団体Aへ2人目として所属（postgres・運営相当の直接操作）
insert into public.organization_memberships (organization_id, user_id, role, member_label)
select id, '00000000-0000-0000-0000-000000000302', 'member', '担当者-SECOND' from morg1;

select is(
  (select count(*)::int from public.organization_memberships
    where organization_id = (select id from morg1)),
  2,
  'T9: 一団体に複数の人間アカウントが所属できる'
);

-- V側からは自分の所属と団体Aが見える
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000302","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.organization_memberships),
  1,
  'T9: 2人目は自分の所属行だけを読める'
);
select is(
  (select count(*)::int from public.organizations where id = (select id from morg1)),
  1,
  'T9: 2人目も所属団体を読める'
);
reset role;

select * from finish();
rollback;
