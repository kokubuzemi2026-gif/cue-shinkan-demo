-- T1: 正しい大学ドメインだけが認証境界（is_university_email / is_university_user）を通過する
-- T2: サブドメイン・類似ドメイン・別ドメイン・空メール・plus付き・内部空白を拒否する
-- 判定表は app/src/auth/universityEmail.test.ts と同一（docs/auth_and_authorization.md §2）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

-- ---- F1判定表（許可） ----
select ok(private.is_university_email('a@stu.kobe-u.ac.jp'), 'F1: 基本形は許可');
select ok(private.is_university_email('A@STU.KOBE-U.AC.JP'), 'F1: 大文字ドメインは正規化後に許可');
select ok(private.is_university_email('  a@stu.kobe-u.ac.jp  '), 'F1: 前後空白はbtrimで許可');

-- ---- F1判定表（拒否） ----
select ok(not private.is_university_email('s1234567+tag@stu.kobe-u.ac.jp'), 'F1: plus addressingは拒否');
select ok(not private.is_university_email('a@x.stu.kobe-u.ac.jp'), 'F1: サブドメインは拒否');
select ok(not private.is_university_email('a@stukobe-u.ac.jp'), 'F1: 類似ドメイン（ドット欠落）は拒否');
select ok(not private.is_university_email('a@stu.kobe-u.ac.jp.evil.com'), 'F1: 後置ドメインは拒否');
select ok(not private.is_university_email('a@kobe-u.ac.jp'), 'F1: 別ドメイン（大学本体）は拒否');
select ok(not private.is_university_email(''), 'F1: 空文字は拒否');
select ok(not private.is_university_email(null), 'F1: nullは拒否');
select ok(not private.is_university_email('a@'), 'F1: ドメイン無しは拒否');
select ok(not private.is_university_email('@stu.kobe-u.ac.jp'), 'F1: ローカル部無しは拒否');
select ok(not private.is_university_email('nodomain'), 'F1: @無しは拒否');
select ok(not private.is_university_email('a@b@stu.kobe-u.ac.jp'), 'F1: @二重は拒否');
select ok(not private.is_university_email('a b@stu.kobe-u.ac.jp'), 'F1: 内部空白は拒否');
select ok(not private.is_university_email(E'a\tb@stu.kobe-u.ac.jp'), 'F1: 内部タブは拒否');

-- ---- F2: 未認証（auth.uid()なし）はfalse ----
select ok(not public.is_university_user(), 'F2: JWTクレーム無しではfalse');

-- ---- fixture: A=大学ドメイン確認済み / B=ドメイン外 / C=大学ドメインだが未確認 ----
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000000a', 'demo-a@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000b', 'demo-b@example.com', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000c', 'demo-c@stu.kobe-u.ac.jp', null, now(), now());

-- ---- A: 大学ユーザーはT1どおり通過し、自分のstudent_accountを作成・参照できる ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select ok(public.is_university_user(), 'F2: 大学ドメイン+確認済みはtrue');
select lives_ok(
  $$insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-00000000000a')$$,
  'T1: 大学ユーザーは自分のstudent_accountを作成できる'
);
select is(
  (select count(*)::int from public.student_accounts),
  1,
  'T1: 大学ユーザーは自分のstudent_accountを参照できる'
);
reset role;

-- ---- B: ドメイン外はCUEアカウントを作成できず、全データ・RPCへアクセス不可 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select ok(not public.is_university_user(), 'F2: ドメイン外はfalse');
select throws_ok(
  $$insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-00000000000b')$$,
  '42501', null,
  'T2: ドメイン外はstudent_accountを作成できない'
);
select throws_ok(
  $$select public.create_organization('ドメイン外テスト団体')$$,
  'not_university_user',
  'T2: ドメイン外はRPCを実行できない'
);
reset role;

-- ---- C: 大学ドメインでもemail_confirmed_atがNULLなら遮断 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select ok(not public.is_university_user(), 'F2: メール未確認（email_confirmed_at IS NULL）はfalse');
select throws_ok(
  $$insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-00000000000c')$$,
  '42501', null,
  'F2: メール未確認はstudent_accountを作成できない'
);
reset role;

select * from finish();
rollback;
