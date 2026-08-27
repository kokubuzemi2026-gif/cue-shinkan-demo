-- Task 009-T1: 新規オブジェクトの権限サーフェス
-- （anonゼロ / authenticatedはpassports SELECTと公開RPC 8本のみ / private配信テーブル到達不可 /
--   全関数にPUBLIC/anonのEXECUTE残存なし / 新規テーブル全部でRLS有効）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

-- ---- anonのテーブル権限はゼロ ----
select ok(not has_table_privilege('anon', 'public.student_passports', 'SELECT'), 'anon: student_passports SELECT不可');
select ok(not has_table_privilege('anon', 'public.student_passports', 'INSERT'), 'anon: student_passports INSERT不可');
select ok(not has_table_privilege('anon', 'private.offer_deliveries', 'SELECT'), 'anon: offer_deliveries SELECT不可');
select ok(not has_table_privilege('anon', 'private.offer_recipients', 'SELECT'), 'anon: offer_recipients SELECT不可');
select ok(not has_table_privilege('anon', 'private.offer_reads', 'SELECT'), 'anon: offer_reads SELECT不可');
select ok(not has_table_privilege('anon', 'private.offer_responses', 'SELECT'), 'anon: offer_responses SELECT不可');

-- ---- authenticatedはpassports SELECTのみ。書込・private配信テーブルは不可 ----
select ok(has_table_privilege('authenticated', 'public.student_passports', 'SELECT'), 'authenticated: student_passports SELECT可');
select ok(not has_table_privilege('authenticated', 'public.student_passports', 'INSERT'), 'authenticated: student_passports INSERT不可（保存はRPCのみ）');
select ok(not has_table_privilege('authenticated', 'public.student_passports', 'UPDATE'), 'authenticated: student_passports UPDATE不可');
select ok(not has_table_privilege('authenticated', 'public.student_passports', 'DELETE'), 'authenticated: student_passports DELETE不可');
select ok(not has_table_privilege('authenticated', 'private.offer_deliveries', 'SELECT'), 'authenticated: offer_deliveries SELECT不可');
select ok(not has_table_privilege('authenticated', 'private.offer_recipients', 'SELECT'), 'authenticated: offer_recipients SELECT不可');
select ok(not has_table_privilege('authenticated', 'private.offer_reads', 'SELECT'), 'authenticated: offer_reads SELECT不可');
select ok(not has_table_privilege('authenticated', 'private.offer_responses', 'SELECT'), 'authenticated: offer_responses SELECT不可');

-- ---- 新規5テーブルすべてでRLS有効 ----
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'student_passports'), 'RLS: student_passports有効');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relname = 'offer_deliveries'), 'RLS: offer_deliveries有効');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relname = 'offer_recipients'), 'RLS: offer_recipients有効');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relname in ('offer_reads', 'offer_responses')), 'RLS: offer_reads/offer_responses有効');

-- ---- Task 009作成の全関数にPUBLIC/anonのEXECUTEが1件も無い（カタログ走査） ----
select is_empty(
  $$
  select p.proname::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('public', 'private')
    and p.proname in (
      'has_unique_elements', 'interest_label', 'purpose_label', 'day_slot_label',
      'frequency_label', 'format_yen', 'normalize_event_text', 'event_fingerprint',
      'match_passport', 'is_current_student', 'dedup_preserving_order',
      'assert_offer_args', 'evaluate_offer_audience',
      'save_student_passport', 'update_organization_contact', 'preview_offer_audience',
      'send_offer', 'list_my_inbox', 'mark_offer_read', 'respond_to_offer',
      'list_org_campaigns'
    )
    and a.privilege_type = 'EXECUTE'
    and (a.grantee = 0 or a.grantee = 'anon'::regrole)
  $$,
  'Task 009の全関数にPUBLIC/anonのEXECUTE残存なし'
);

-- ---- authenticatedのEXECUTEは公開RPC（F13〜F20）だけ ----
select is(
  (
    select coalesce(string_agg(fn.fname, ',' order by fn.fname), '')
    from (
      select distinct p.proname::text collate "C" as fname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname in ('public', 'private')
        and p.proname in (
          'has_unique_elements', 'interest_label', 'purpose_label', 'day_slot_label',
          'frequency_label', 'format_yen', 'normalize_event_text', 'event_fingerprint',
          'match_passport', 'is_current_student', 'dedup_preserving_order',
          'assert_offer_args', 'evaluate_offer_audience',
          'save_student_passport', 'update_organization_contact', 'preview_offer_audience',
          'send_offer', 'list_my_inbox', 'mark_offer_read', 'respond_to_offer',
          'list_org_campaigns'
        )
        and a.privilege_type = 'EXECUTE'
        and a.grantee = 'authenticated'::regrole
    ) fn
  ),
  'list_my_inbox,list_org_campaigns,mark_offer_read,preview_offer_audience,respond_to_offer,save_student_passport,send_offer,update_organization_contact',
  'authenticatedのEXECUTEは公開RPCの8関数に限定'
);

-- ---- 実際のアクセス試行（anonロール） ----
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  'select count(*) from public.student_passports',
  '42501', null,
  'anon: student_passportsへのSELECT試行はpermission denied'
);
select throws_ok(
  $$select public.list_my_inbox()$$,
  '42501', null,
  'anon: list_my_inbox呼出はpermission denied'
);
reset role;

select * from finish();
rollback;
