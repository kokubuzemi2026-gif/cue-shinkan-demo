-- Task 015-T1: 同意バージョンの記録・再同意・同意前の書込拒否（D050）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000c101', 'demo-cn-a@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000c102', 'demo-cn-b@stu.kobe-u.ac.jp', now(), now(), now());
insert into public.student_accounts (user_id) values
  ('00000000-0000-0000-0000-00000000c101');

-- ---- 同意していない状態 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select needs_consent from public.my_consent()),
  true,
  'T1: 初回は再同意（=初回同意）が必要'
);
select is(
  (select agreed_version from public.my_consent()),
  null,
  'T1: まだ同意していないので agreed_version は空'
);

-- ---- 同意前は登録できない（構造で止める） ----
select throws_ok(
  $$select public.save_student_passport(
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
      'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
      2000, false, array['outdoor']::public.interest_category[], 3)$$,
  'P0001', 'consent_required',
  'T1: 同意前は興味パスポートを保存できない'
);
select throws_ok(
  $$select public.create_organization('同意前団体')$$,
  'P0001', 'consent_required',
  'T1: 同意前は団体を作れない'
);
reset role;

-- ---- 古い版・未来の版への同意は記録しない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.record_consent(0)$$,
  'P0001', 'consent_version_mismatch',
  'T1: 現在と違う版への同意は拒否される'
);
select throws_ok(
  $$select public.record_consent(999)$$,
  'P0001', 'consent_version_mismatch',
  'T1: 未来の版への同意も拒否される'
);
select throws_ok(
  $$select public.record_consent(null)$$,
  'P0001', 'consent_version_mismatch',
  'T1: NULLの同意も拒否される'
);

-- ---- 現在の版へ同意する ----
select lives_ok(
  $$select public.record_consent((select current_version from public.my_consent()))$$,
  'T1: 現在の版への同意は記録できる（画面が受け取った版で同意する）'
);
select is(
  (select needs_consent from public.my_consent()),
  false,
  'T1: 同意後は再同意が不要'
);
select is(
  (select agreed_version from public.my_consent()),
  1,
  'T1: 同意した版が記録される'
);

-- ---- 同意後は登録できる ----
select lives_ok(
  $$select public.save_student_passport(
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
      'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
      2000, false, array['outdoor']::public.interest_category[], 3)$$,
  'T1: 同意後は興味パスポートを保存できる'
);
select lives_ok(
  $$select public.create_organization('同意後団体')$$,
  'T1: 同意後は団体を作れる'
);
reset role;

-- ---- 版が上がると再同意が必要（構造で確認する） ----
-- current_consent_version() を一時的に2へ差し替えて、同じ利用者が再同意を
-- 求められることと、再同意するまで登録できないことを確かめる
create or replace function private.current_consent_version()
returns integer language sql immutable set search_path = '' as $$ select 2 $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select needs_consent from public.my_consent()),
  true,
  'T1: 版が上がると、同意済みの利用者も再同意が必要'
);
select is(
  (select agreed_version from public.my_consent()),
  1,
  'T1: 以前同意した版は残っている（agreed_version=1・current=2）'
);
select throws_ok(
  $$select public.save_student_passport(
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
      'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
      2000, false, array['outdoor']::public.interest_category[], 3)$$,
  'P0001', 'consent_required',
  'T1: 版が上がると、再同意するまで保存できない'
);
select lives_ok(
  $$select public.record_consent(2)$$,
  'T1: 新しい版へ同意できる'
);
select is(
  (select needs_consent from public.my_consent()),
  false,
  'T1: 再同意後は不要になる'
);
reset role;

-- ---- 他人の同意状況は見えない（RLS） ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c102","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.student_consents),
  0,
  'T1: 自分が同意していなければ、同意テーブルに自分の行は無く、他人の行も見えない'
);
reset role;

-- ---- 同意テーブルに希望条件・メール等のPIIが無い ----
select set_eq(
  $$select column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = 'student_consents'$$,
  array['user_id', 'consent_version', 'agreed_at'],
  'T1: 同意記録は user_id・版・時刻だけ（希望条件やメールを持たない）'
);

-- ---- 新規RPC・テーブルの権限を固定する ----
select is(
  (
    select coalesce(string_agg(
      p.proname || '=' || a.grantee::regrole::text, ',' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and p.proname in ('my_consent', 'record_consent')
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> 0 and a.grantee::regrole::text <> 'postgres'
  ),
  'my_consent=authenticated,record_consent=authenticated',
  'T1: 同意RPCはauthenticatedだけが呼べる'
);
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname in ('public', 'private')
      and p.proname in ('my_consent', 'record_consent', 'current_consent_version', 'has_current_consent')
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee = 'anon'::regrole)
  ),
  0,
  'T1: 同意まわりの関数にPUBLIC・anonのEXECUTEは無い'
);

select * from finish();
rollback;
