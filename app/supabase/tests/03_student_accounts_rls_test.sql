-- T4: 新入生は自分のstudent accountだけを読める
-- T5: 他人のstudent accountを読めない
-- T12: direct INSERT/UPDATE/DELETEで権限を迂回できない（student_accounts分）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000101', 'demo-s1@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000102', 'demo-s2@stu.kobe-u.ac.jp', now(), now(), now());

-- s2のアカウントは事前に存在させる（postgresで作成）
insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-000000000102');

-- ---- s1として操作 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-000000000101')$$,
  'T4: 自分のstudent_accountを作成できる'
);
select is(
  (select count(*)::int from public.student_accounts),
  1,
  'T4/T5: 2行存在するが自分の1行だけが見える'
);
select is_empty(
  $$select 1 from public.student_accounts where user_id = '00000000-0000-0000-0000-000000000102'$$,
  'T5: 他人のstudent_accountは見えない'
);
select throws_ok(
  $$insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-000000000103')$$,
  '42501', null,
  'T12: 他人（任意ID）のstudent_accountはINSERTできない'
);
select throws_ok(
  $$update public.student_accounts set created_at = now()$$,
  '42501', null,
  'T12: student_accountsをUPDATEできない（grantなし）'
);
select throws_ok(
  $$delete from public.student_accounts$$,
  '42501', null,
  'T12: student_accountsをDELETEできない（grantなし）'
);
reset role;

-- postgresから見れば2行ある（RLSで絞られていたことの対照）
select is(
  (select count(*)::int from public.student_accounts),
  2,
  '対照: postgresからは2行見える'
);

select * from finish();
rollback;
