-- T13: 団体作成とowner所属作成が原子的である
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000401', 'demo-atomic@stu.kobe-u.ac.jp', now(), now(), now());

-- ---- 成功時: organizationsとowner membershipが同時に生まれる ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000401","role":"authenticated"}', true);
set local role authenticated;
create temp table aorg as select public.create_organization('原子性テスト団体') as id;
reset role;

select is(
  (select count(*)::int from public.organizations where id = (select id from aorg)),
  1,
  'T13: 団体行が作成される'
);
select is(
  (select count(*)::int from public.organization_memberships
    where organization_id = (select id from aorg)
      and user_id = '00000000-0000-0000-0000-000000000401'
      and role = 'owner'),
  1,
  'T13: 作成者がownerとして同時に登録される'
);
select ok(
  (select member_label ~ '^担当者-[0-9A-F]{6}$'
     from public.organization_memberships
    where organization_id = (select id from aorg)),
  'F5: member_labelはPIIを含まないランダムラベル形式'
);

-- ---- 入力検証で失敗した場合は団体行も作られない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000401","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_organization('   ')$$,
  'invalid_org_name',
  'F5: 空白のみの団体名は拒否される'
);
reset role;
select is(
  (select count(*)::int from public.organizations),
  1,
  'T13: 検証失敗では団体行が増えない'
);

-- ---- membership側の失敗で全体がrollbackされる（原子性の核心） ----
-- 一時的にmembershipのINSERTを必ず失敗させる制約を仕込む
alter table public.organization_memberships
  add constraint tmp_force_failure check (false) not valid;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000401","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_organization('途中失敗テスト団体')$$,
  '23514', null,
  'T13: owner登録が失敗するとRPC全体がエラーになる'
);
reset role;

alter table public.organization_memberships drop constraint tmp_force_failure;

select is(
  (select count(*)::int from public.organizations),
  1,
  'T13: owner登録失敗時は団体行もrollbackされている（原子的）'
);

select * from finish();
rollback;
