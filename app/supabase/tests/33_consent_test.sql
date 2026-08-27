-- Task 015-T1: 同意バージョンの記録・再同意・同意前の書込拒否（D050）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(36);

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
-- privateの2関数はauthenticatedからも呼べてはならない。
-- 本番Supabaseは ALTER DEFAULT PRIVILEGES で新規関数へ authenticated を付けうるため、
-- revoke行を1行落とした将来の退行をここで止める
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'private'
      and p.proname in ('current_consent_version', 'has_current_consent')
      and a.privilege_type = 'EXECUTE'
      and a.grantee = 'authenticated'::regrole
  ),
  0,
  'T1: privateの同意関数はauthenticatedからも実行できない'
);

-- ===================================================================
-- T2: 団体側の操作も同意を必須にする（D050 / 独立レビューの指摘）
-- 画面の順序ではなく、DB側で「参加を作る・広げる」操作を止める。
-- 逆に「露出を減らす」操作（返答・通知設定・パスポート削除・脱退）は、
-- 版が上がっても止めない
-- ===================================================================
create or replace function private.current_consent_version()
returns integer language sql immutable set search_path = '' as $ver$ select 1 $ver$;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000c103', 'demo-cn-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000c110', 'demo-cn-invitee@stu.kobe-u.ac.jp', now(), now(), now());
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid,
       'demo-cn-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
  from generate_series(4, 9) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid from generate_series(4, 9) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid,
  array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 3
  from generate_series(4, 9) as n;
-- 団体側（c103）と学生（c104〜c109）だけが同意済み。招待される c110 は未同意
insert into public.student_consents (user_id, consent_version)
select id, private.current_consent_version() from auth.users
 where id <> '00000000-0000-0000-0000-00000000c110'
   and id::text like '00000000-0000-0000-0000-00000000c1%'
on conflict (user_id) do nothing;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c103","role":"authenticated"}', true);
set local role authenticated;
create temp table corg as select public.create_organization('同意テスト団体', '説明文') as id;
create temp table ctoken as select token from public.create_invitation((select id from corg), 'admin');
reset role;
grant select on corg, ctoken to public;
update public.organizations set status = 'verified' where id = (select id from corg);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c103","role":"authenticated"}', true);
set local role authenticated;
select public.preview_offer_audience(
    (select id from corg), '同意テストイベント', '説明文', '理由', '9月13日（土）9:00', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
    12, '2026-09-11');
create temp table cdelivery as
  select s.delivery_id as id from public.send_offer(
    (select id from corg), '同意テストイベント', '説明文', '理由', '9月13日（土）9:00', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
    12, '2026-09-11') s;
reset role;
grant select on cdelivery to public;

-- ---- 未同意のまま担当者にはなれない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c110","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.accept_invitation((select token from ctoken))$$,
  'P0001', 'consent_required',
  'T2: 未同意の利用者は招待を承諾して担当者になれない'
);
select lives_ok(
  $$select public.record_consent(1)$$,
  'T2: 招待された利用者も同意できる'
);
select lives_ok(
  $$select public.accept_invitation((select token from ctoken))$$,
  'T2: 同意後は招待を承諾できる'
);
reset role;

-- ---- 版が上がると、団体側の操作は再同意まで止まる ----
create or replace function private.current_consent_version()
returns integer language sql immutable set search_path = '' as $ver$ select 2 $ver$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c103","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.send_offer(
      (select id from corg), '別イベント', '説明文', '理由', '9月20日（土）9:00', '摩耶山',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
      12, '2026-09-18')$$,
  'P0001', 'consent_required',
  'T2: 版が上がると、再同意するまでオファーを送れない'
);
select throws_ok(
  $$select public.preview_offer_audience(
      (select id from corg), '別イベント', '説明文', '理由', '9月20日（土）9:00', '摩耶山',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
      12, '2026-09-18')$$,
  'P0001', 'consent_required',
  'T2: 版が上がると、対象人数のプレビューもできない'
);
select throws_ok(
  $$select public.create_invitation((select id from corg), 'member')$$,
  'P0001', 'consent_required',
  'T2: 版が上がると、新しい招待を発行できない'
);
select throws_ok(
  $$select public.update_organization_profile((select id from corg), '改名', '説明')$$,
  'P0001', 'consent_required',
  'T2: 版が上がると、団体名を変更できない'
);
select throws_ok(
  $$select public.update_organization_contact((select id from corg), 'Instagram', '@after_bump')$$,
  'P0001', 'consent_required',
  'T2: 版が上がると、公式窓口を変更できない'
);
reset role;

-- ---- 版が上がっても、利用者が自分の露出を減らす操作は止めない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c104","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.mark_offer_read((select id from cdelivery))$$,
  'T2: 版が上がっても、届いたオファーを既読にできる'
);
select lives_ok(
  $$select public.respond_to_offer((select id from cdelivery), 'skip')$$,
  'T2: 版が上がっても、見送ると返答できる（断る操作を人質に取らない）'
);
select lives_ok(
  $$select public.save_notification_settings('off')$$,
  'T2: 版が上がっても、メール通知を止められる'
);
select lives_ok(
  $$select public.delete_student_passport()$$,
  'T2: 版が上がっても、興味パスポートを削除できる'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c110","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.leave_organization((select id from corg))$$,
  'T2: 版が上がっても、団体から脱退できる'
);
reset role;

-- ---- ゲート対象を固定する（増えても減っても落ちる） ----
select set_eq(
  $$select p.proname::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%has_current_consent%'$$,
  array['save_student_passport', 'create_organization', 'accept_invitation',
        'create_invitation', 'update_organization_profile', 'update_organization_contact',
        'preview_offer_audience', 'send_offer'],
  'T2: 同意ゲートを持つRPCの一覧が固定されている（参加を作る・広げる操作だけ）'
);

select * from finish();
rollback;
