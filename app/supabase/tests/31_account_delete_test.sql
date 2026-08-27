-- Task 014-T2: アカウント削除（D047）
-- 削除後に public / private スキーマへ復元可能な個人情報と孤児データが残らないことを、
-- **全テーブルを走査して**確認する（テーブルが増えたら気づけるようにする）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000a001', 'demo-ad-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000a002', 'demo-ad-second@stu.kobe-u.ac.jp', now(), now(), now());
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-00000000a1' || to_char(n, 'FM00'))::uuid,
       'demo-ad-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-00000000a1' || to_char(n, 'FM00'))::uuid
from generate_series(1, 6) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-00000000a1' || to_char(n, 'FM00'))::uuid,
  array['volunteer']::public.interest_category[], array['friends']::public.purpose[],
  'relaxed', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['volunteer']::public.interest_category[], 5
from generate_series(1, 6) as n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
set local role authenticated;
create temp table aorg as select public.create_organization('削除テスト団体') as id;
select public.update_organization_contact((select id from aorg), '窓口', '@ad_demo');
reset role;
grant select on aorg to public;
update public.organizations set status = 'verified' where id = (select id from aorg);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
set local role authenticated;
select public.preview_offer_audience(
  (select id from aorg), '清掃活動の見学', '説明文', '理由', '9月13日（土）', '大学正門',
  array['weekend']::public.day_slot[], 'monthly_1_2', 0, true, 'relaxed',
  array['volunteer']::public.interest_category[], array['friends']::public.purpose[], 10, '2026-09-11');
create temp table ad1 as select s.delivery_id as id from public.send_offer(
  (select id from aorg), '清掃活動の見学', '説明文', '理由', '9月13日（土）', '大学正門',
  array['weekend']::public.day_slot[], 'monthly_1_2', 0, true, 'relaxed',
  array['volunteer']::public.interest_category[], array['friends']::public.purpose[], 10, '2026-09-11') s;
reset role;
grant select on ad1 to public;

-- 削除対象の学生a101が、消せるだけのデータを一通り持っている状態にする
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a101","role":"authenticated"}', true);
set local role authenticated;
select public.mark_offer_read((select id from ad1));
select public.respond_to_offer((select id from ad1), 'interested');
select public.save_notification_settings('daily');
reset role;

select is(
  (select count(*)::int from private.offer_recipients where user_id = '00000000-0000-0000-0000-00000000a101'),
  1, 'T2: 削除前は受信者行がある');
select is(
  (select count(*)::int from private.email_outbox where user_id = '00000000-0000-0000-0000-00000000a101'),
  1, 'T2: 削除前は送信待ちメールがある');
select is(
  (select count(*)::int from private.student_delivery_quota where user_id = '00000000-0000-0000-0000-00000000a101'),
  1, 'T2: 削除前は受信枠の行がある');

-- ---- 削除 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a101","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.delete_my_account()$$, 'T2: 本人はアカウントを削除できる');
select throws_ok(
  $$select public.list_my_inbox()$$,
  'P0001', 'not_student',
  'T2: 削除後は受信箱を取得できない'
);
select throws_ok(
  $$select public.delete_my_account()$$,
  'P0001', 'nothing_to_delete',
  'T2: 2回目の削除は nothing_to_delete（黙って成功しない）'
);
reset role;

-- ---- 全テーブル走査: user_id列を持つテーブルに削除した本人の行が残らない ----
-- 将来テーブルが増えても、この検査が自動的に対象へ含める
-- user_id列を持つ全テーブルを動的に走査する。
-- 将来テーブルが増えても、この検査が自動的に対象へ含める
create function pg_temp.rows_left_for(subject uuid)
returns text
language plpgsql
as $$
declare
  r record;
  v_count integer;
  v_hits text[] := '{}';
begin
  for r in
    select c.table_schema as sch, c.table_name as tbl
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema in ('public', 'private')
       and c.column_name = 'user_id'
       and t.table_type = 'BASE TABLE'
     order by 1, 2
  loop
    execute format('select count(*) from %I.%I where user_id = $1', r.sch, r.tbl)
      into v_count using subject;
    if v_count > 0 then
      v_hits := v_hits || (r.sch || '.' || r.tbl);
    end if;
  end loop;
  return array_to_string(v_hits, ',');
end
$$;

create function pg_temp.scanned_table_count()
returns integer
language sql
as $$
  select count(*)::integer
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema in ('public', 'private')
     and c.column_name = 'user_id'
     and t.table_type = 'BASE TABLE';
$$;

select is(
  pg_temp.rows_left_for('00000000-0000-0000-0000-00000000a101'),
  '',
  'T2: user_id列を持つ全テーブルに、削除した本人の行が1件も残らない'
);
-- 走査が空振り（0テーブル）で合格しないことを確かめる
select cmp_ok(pg_temp.scanned_table_count(), '>=', 8,
  'T2: 上の走査が実際に8テーブル以上を見ている');
select isnt(
  pg_temp.rows_left_for('00000000-0000-0000-0000-00000000a102'),
  '',
  'T2: 削除していない学生では走査が行を見つける（検査自体が機能している）'
);

-- ---- 個別に確認（走査が壊れても気づけるように二重で持つ） ----
select is((select count(*)::int from public.student_accounts where user_id = '00000000-0000-0000-0000-00000000a101'), 0,
  'T2: 新入生権限の行が消えている');
select is((select count(*)::int from public.student_passports where user_id = '00000000-0000-0000-0000-00000000a101'), 0,
  'T2: パスポートが消えている');
select is((select count(*)::int from public.student_notification_settings where user_id = '00000000-0000-0000-0000-00000000a101'), 0,
  'T2: 通知設定が消えている');
select is((select count(*)::int from private.student_delivery_quota where user_id = '00000000-0000-0000-0000-00000000a101'), 0,
  'T2: 受信枠の行が消えている');
select is((select count(*)::int from private.email_outbox where user_id = '00000000-0000-0000-0000-00000000a101'), 0,
  'T2: 送信待ちメールが消えている');
select is((select count(*)::int from private.offer_recipients where user_id = '00000000-0000-0000-0000-00000000a101'), 0,
  'T2: 受信者行が消えている');
select is((select count(*)::int from private.offer_reads where user_id = '00000000-0000-0000-0000-00000000a101'), 0,
  'T2: 既読が消えている（孤児にならない）');
select is((select count(*)::int from private.offer_responses where user_id = '00000000-0000-0000-0000-00000000a101'), 0,
  'T2: 返答が消えている（孤児にならない）');

-- ---- 他の学生と団体側の正本は壊れない ----
select is(
  (select count(*)::int from private.offer_recipients where delivery_id = (select id from ad1)),
  5,
  'T2: 他の5人の受信者行は残る'
);
select is(
  (select count(*)::int from private.offer_deliveries where id = (select id from ad1)),
  1,
  'T2: 団体側の配信snapshotは残る（D023）'
);

-- ---- 監査記録 ----
select is(
  (select subject_hash from private.deletion_audit_log where action = 'account_deleted'),
  private.subject_hash('00000000-0000-0000-0000-00000000a101'),
  'T2: 削除が一方向ハッシュで記録される'
);

select * from finish();
rollback;
