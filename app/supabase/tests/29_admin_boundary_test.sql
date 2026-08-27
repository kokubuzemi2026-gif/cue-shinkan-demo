-- Task 013-T3: 運営権限の境界と監査記録のPIIサーフェス
-- クライアント（anon / authenticated）から運営操作へ到達する経路が存在しないこと、
-- 団体が他団体・自団体へ越権できないこと、監査記録に学生の個人情報が入らないこと
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000e4001', 'demo-ab-a@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000e4002', 'demo-ab-b@stu.kobe-u.ac.jp', now(), now(), now());
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000e5' || to_char(n, 'FM000'))::uuid,
       'demo-ab-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-0000000e5' || to_char(n, 'FM000'))::uuid
from generate_series(1, 6) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-0000000e5' || to_char(n, 'FM000'))::uuid,
  array['sports']::public.interest_category[], array['exercise']::public.purpose[],
  'serious', 'weekly_1', array['weekday_night']::public.day_slot[], 'none',
  1500, false, array['sports']::public.interest_category[], 5
from generate_series(1, 6) as n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e4001","role":"authenticated"}', true);
set local role authenticated;
create temp table aorg as select public.create_organization('越権テスト団体A') as id;
reset role;
grant select on aorg to public;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e4002","role":"authenticated"}', true);
set local role authenticated;
create temp table borg as select public.create_organization('越権テスト団体B') as id;
reset role;
grant select on borg to public;
update public.organizations set status = 'verified'
 where id in ((select id from aorg), (select id from borg));

-- 団体Bが1件配信しておく（他団体が止められないことを確かめるため）
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e4002","role":"authenticated"}', true);
set local role authenticated;
select public.preview_offer_audience(
  (select id from borg), '合同練習', '説明文', '理由', '10月4日（土）', '第2体育館',
  array['weekday_night']::public.day_slot[], 'weekly_1', 500, true, 'serious',
  array['sports']::public.interest_category[], array['exercise']::public.purpose[], 12, '2026-10-01');
select public.send_offer(
  (select id from borg), '合同練習', '説明文', '理由', '10月4日（土）', '第2体育館',
  array['weekday_night']::public.day_slot[], 'weekly_1', 500, true, 'serious',
  array['sports']::public.interest_category[], array['exercise']::public.purpose[], 12, '2026-10-01');
reset role;
create temp table bdelivery as
  select id from private.offer_deliveries where event_name = '合同練習';
grant select on bdelivery to public;

-- ---- 運営RPCはservice_role以外へgrantされていない ----
select is(
  (
    select coalesce(string_agg(distinct a.grantee::regrole::text, ',' order by a.grantee::regrole::text), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and p.proname like 'admin\_%'
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> 0
      and a.grantee::regrole::text <> 'postgres'
      and a.grantee::regrole::text <> p.proowner::regrole::text
  ),
  'service_role',
  'T3: admin_* RPCのEXECUTEはservice_roleだけ'
);
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and p.proname like 'admin\_%'
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole)
  ),
  0,
  'T3: admin_* RPCにPUBLIC・anon・authenticatedのEXECUTEは無い'
);
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_%'),
  4,
  'T3: 運営RPCは4本だけ（意図しない公開関数が増えていない）'
);

-- ---- クライアントロールからは呼べない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e4001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_set_organization_status((select id from aorg), 'verified', 'me', null)$$,
  '42501', null,
  'T3: authenticated: 団体状態の変更は permission denied'
);
select throws_ok(
  $$select public.admin_set_offer_stopped((select id from bdelivery), true, 'me', null)$$,
  '42501', null,
  'T3: authenticated: オファー停止は permission denied'
);
select throws_ok(
  $$select public.admin_set_delivery_paused(true, 'me', null)$$,
  '42501', null,
  'T3: authenticated: 緊急停止は permission denied'
);
select throws_ok(
  $$select * from public.admin_list_audit(10)$$,
  '42501', null,
  'T3: authenticated: 監査記録の閲覧は permission denied'
);

-- ---- 団体は自分の状態も直接は変えられない（自己verified化の禁止） ----
select throws_ok(
  $$update public.organizations set status = 'verified' where id = (select id from aorg)$$,
  '42501', null,
  'T3: authenticated: organizationsへのUPDATE権限が無い（自己verified化できない）'
);
select throws_ok(
  $$select c.delivery_paused from private.platform_controls c$$,
  '42501', null,
  'T3: authenticated: 緊急停止テーブルを読めない'
);
select throws_ok(
  $$update private.platform_controls set delivery_paused = false$$,
  '42501', null,
  'T3: authenticated: 緊急停止テーブルを書き換えられない'
);
select throws_ok(
  $$select count(*) from private.admin_audit_log$$,
  '42501', null,
  'T3: authenticated: 監査記録テーブルを読めない'
);
select throws_ok(
  $$update private.offer_deliveries set stopped_at = null$$,
  '42501', null,
  'T3: authenticated: 配信行の停止状態を書き換えられない'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select public.admin_set_delivery_paused(false, 'me', null)$$,
  '42501', null,
  'T3: anon: 緊急停止は permission denied'
);
select throws_ok(
  $$select * from public.admin_list_audit(10)$$,
  '42501', null,
  'T3: anon: 監査記録の閲覧は permission denied'
);
reset role;

-- ---- 団体Aは団体Bのオファーを止められない ----
-- 越権の経路そのものが存在しないこと（RPCが呼べない + 直接UPDATEもできない）を確認する
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e4001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.organizations o where o.id = (select id from borg)),
  0,
  'T3: 団体Aから団体Bの行は見えない（RLS）'
);
reset role;
select is(
  (select stopped_at from private.offer_deliveries where id = (select id from bdelivery)),
  null,
  'T3: 団体Aの試行後も団体Bのオファーは停止していない'
);

-- ---- service_roleでも private への直接アクセス経路は開いていない ----
set local role service_role;
select throws_ok(
  $$select count(*) from private.admin_audit_log$$,
  '42501', null,
  'T3: service_roleもprivateテーブルへ直接アクセスしない（RPC経由だけ）'
);
select lives_ok(
  $$select * from public.admin_list_audit(10)$$,
  'T3: service_roleは監査記録をRPC経由で読める'
);
select throws_ok(
  $$select * from public.admin_list_audit(0)$$,
  'P0001', 'invalid_admin_action',
  'T3: 監査記録の取得件数は範囲外を拒否する'
);
select throws_ok(
  $$select * from public.admin_list_audit(100000)$$,
  'P0001', 'invalid_admin_action',
  'T3: 監査記録の取得件数は上限を超えられない'
);
select throws_ok(
  $$select public.admin_set_organization_status(
      '00000000-0000-0000-0000-0000000eeeee', 'verified', 'ops', null)$$,
  'P0001', 'organization_not_found',
  'T3: 存在しない団体の状態変更は organization_not_found'
);
reset role;

-- ---- 監査記録にPIIが入らない（構造で保証する） ----
select set_eq(
  $$select column_name::text from information_schema.columns
     where table_schema = 'private' and table_name = 'admin_audit_log'$$,
  array['id', 'action', 'target_organization_id', 'target_delivery_id',
        'actor_label', 'reason', 'previous_value', 'new_value', 'created_at'],
  'T3: 監査記録の列は運営操作の記述だけ（学生ID・メール・希望条件の列が無い）'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'private' and table_name = 'admin_audit_log'
      and (column_name ilike '%user%' or column_name ilike '%email%'
        or column_name ilike '%student%' or column_name ilike '%interest%'
        or column_name ilike '%recipient%' or column_name ilike '%passport%')),
  0,
  'T3: 監査記録に学生を指す列が存在しない'
);

-- 実際に運営操作を行っても、記録本文へ学生の識別子が現れない
set local role service_role;
select public.admin_set_organization_status((select id from aorg), 'suspended', 'ops-9', '通報対応');
select public.admin_set_offer_stopped((select id from bdelivery), true, 'ops-9', '内容確認');
select public.admin_set_delivery_paused(true, 'ops-9', '全体調査');
select public.admin_set_delivery_paused(false, 'ops-9', null);
reset role;
select is(
  (select count(*)::int from private.admin_audit_log a
     where a.actor_label || coalesce(a.reason, '') || coalesce(a.previous_value, '')
        || coalesce(a.new_value, '') like '%@%'),
  0,
  'T3: 監査記録の本文にメールアドレスらしき文字列が入らない'
);
select is(
  (select count(*)::int from private.admin_audit_log a
     join auth.users u on a.actor_label like '%' || u.email || '%'),
  0,
  'T3: 監査記録の操作者ラベルへ利用者のメールが入っていない'
);
select is(
  (select count(*)::int from private.admin_audit_log),
  4,
  'T3: 運営操作4件がすべて記録されている'
);

select * from finish();
rollback;
