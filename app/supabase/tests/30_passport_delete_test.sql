-- Task 014-T1: 興味パスポートの削除（D046）
-- 削除後は新規配信の対象にならない。受信済みの案内は履歴として残る（D023）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000f001', 'demo-pd-owner@stu.kobe-u.ac.jp', now(), now(), now());
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-00000000f1' || to_char(n, 'FM00'))::uuid,
       'demo-pd-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-00000000f1' || to_char(n, 'FM00'))::uuid
from generate_series(1, 6) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-00000000f1' || to_char(n, 'FM00'))::uuid,
  array['travel']::public.interest_category[], array['friends']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['travel']::public.interest_category[], 5
from generate_series(1, 6) as n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', true);
set local role authenticated;
create temp table porg as select public.create_organization('パスポート削除テスト団体') as id;
select public.update_organization_contact((select id from porg), '窓口', '@pd_demo');
reset role;
grant select on porg to public;
update public.organizations set status = 'verified' where id = (select id from porg);

create function pg_temp.send_travel(ev text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', true);
  set local role authenticated;
  perform public.preview_offer_audience(
    (select id from porg), ev, '説明文', '理由', '9月13日（土）', '三宮集合',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1200, true, 'moderate',
    array['travel']::public.interest_category[], array['friends']::public.purpose[],
    10, '2026-09-11');
  select s.delivery_id into v_id from public.send_offer(
    (select id from porg), ev, '説明文', '理由', '9月13日（土）', '三宮集合',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1200, true, 'moderate',
    array['travel']::public.interest_category[], array['friends']::public.purpose[],
    10, '2026-09-11') s;
  reset role;
  return v_id;
end
$$;

select lives_ok($$select pg_temp.send_travel('日帰り旅の下見')$$, 'T1: 6人へ配信できる');
create temp table pd1 as select id from private.offer_deliveries where event_name = '日帰り旅の下見';
grant select on pd1 to public;

-- ---- 削除の前 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f101","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.list_my_inbox()), 1, 'T1: 削除前は受信箱に1件ある');
select lives_ok(
  $$select public.respond_to_offer((select id from pd1), 'interested')$$,
  'T1: 削除前に返答しておく'
);

-- ---- 削除 ----
select lives_ok($$select public.delete_student_passport()$$, 'T1: 本人はパスポートを削除できる');
reset role;
select is(
  (select count(*)::int from public.student_passports where user_id = '00000000-0000-0000-0000-00000000f101'),
  0,
  'T1: パスポートの行が消えている'
);

-- ---- 受信済みの履歴は残る（D023） ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f101","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.list_my_inbox()), 1,
  'T1: 受信済みの案内は残る（削除しても履歴は消えない・D023）');
select is(
  (select i.response_choice::text from public.list_my_inbox() i),
  'interested',
  'T1: 返答も残る'
);
select isnt(
  (select i.org_contact_handle from public.list_my_inbox() i),
  '',
  'T1: 開示済みの公式窓口も引き続き見られる'
);
select throws_ok(
  $$select public.delete_student_passport()$$,
  'P0001', 'passport_not_found',
  'T1: 2回目の削除は passport_not_found（黙って成功しない）'
);
reset role;

-- ---- 新規配信の対象にならない ----
select is(
  (select count(*)::int from private.evaluate_offer_audience(
     array['travel']::public.interest_category[], array['friends']::public.purpose[],
     'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1200, true, now())),
  5,
  'T1: 削除した1人は配信候補から外れる（6人→5人）'
);
select is(
  (select count(*)::int from private.evaluate_offer_audience(
     array['travel']::public.interest_category[], array['friends']::public.purpose[],
     'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1200, true, now()) a
   where a.user_id = '00000000-0000-0000-0000-00000000f101'),
  0,
  'T1: 削除した本人は候補に現れない'
);

-- ---- 監査記録は日次集計で、主体を持たない（D046） ----
select is(
  (select event_count from private.deletion_audit_log where action = 'passport_deleted'),
  1,
  'T1: 削除が記録される'
);
-- 同じ日の2回目は行を増やさず、件数だけが増える（無制限に積み上がらない）
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'private' and table_name = 'deletion_audit_log'
      and (column_name ilike '%user%' or column_name ilike '%subject%'
        or column_name ilike '%hash%' or column_name ilike '%email%')),
  0,
  'T1: 監査記録に主体を指す列が存在しない（auth.usersとjoinして戻せない）'
);
select set_eq(
  $$select column_name::text from information_schema.columns
     where table_schema = 'private' and table_name = 'deletion_audit_log'$$,
  array['action', 'occurred_on', 'event_count', 'removed_rows', 'updated_at'],
  'T1: 監査記録の列は「何を・いつ・何件」だけ'
);

-- ---- 「新しい案内は届かなくなります」の通り、送信待ちのメールも止まる ----
select is(
  (select count(*)::int from private.email_outbox o
     where o.user_id = '00000000-0000-0000-0000-00000000f101' and o.status = 'pending'),
  0,
  'T1: パスポート削除で送信待ちの案内メールが残らない'
);
select is(
  (select count(*)::int from private.email_outbox o
     where o.user_id = '00000000-0000-0000-0000-00000000f101' and o.status = 'cancelled'),
  1,
  'T1: 送信待ちだった案内メールは取り消される'
);

-- ---- 他人のパスポートは消せない ----
select is(
  (select count(*)::int from public.student_passports),
  5,
  'T1: 他の5人のパスポートは残っている'
);

select * from finish();
rollback;
