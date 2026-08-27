-- Task 013-T2: 緊急停止（kill switch・D045）
-- 1操作で全団体の配信を止め、解除できること。判定がRPCの中だけでなく
-- 配信行の挿入そのもので効くこと（別経路ができても素通りしない）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000e2001', 'demo-ks-owner@stu.kobe-u.ac.jp', now(), now(), now());
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000e3' || to_char(n, 'FM000'))::uuid,
       'demo-ks-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-0000000e3' || to_char(n, 'FM000'))::uuid
from generate_series(1, 6) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-0000000e3' || to_char(n, 'FM000'))::uuid,
  array['music']::public.interest_category[], array['creation']::public.purpose[],
  'relaxed', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  3000, false, array['music']::public.interest_category[], 5
from generate_series(1, 6) as n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e2001","role":"authenticated"}', true);
set local role authenticated;
create temp table korg as select public.create_organization('緊急停止テスト団体') as id;
reset role;
grant select on korg to public;
update public.organizations set status = 'verified' where id = (select id from korg);

create function pg_temp.send_music(ev text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000e2001","role":"authenticated"}', true);
  set local role authenticated;
  perform public.preview_offer_audience(
    (select id from korg), ev, '説明文', '届けたい理由', '9月27日（土）', '音楽室',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1000, true, 'relaxed',
    array['music']::public.interest_category[], array['creation']::public.purpose[],
    10, '2026-09-25');
  select s.delivery_id into v_id from public.send_offer(
    (select id from korg), ev, '説明文', '届けたい理由', '9月27日（土）', '音楽室',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1000, true, 'relaxed',
    array['music']::public.interest_category[], array['creation']::public.purpose[],
    10, '2026-09-25') s;
  reset role;
  return v_id;
end
$$;

-- ---- 既定は停止していない ----
select is(
  (select c.delivery_paused from private.platform_controls c),
  false,
  'T2: 既定では緊急停止は無効'
);
select is(
  (select count(*)::int from private.platform_controls),
  1,
  'T2: 緊急停止の行はちょうど1行'
);
select throws_ok(
  $$insert into private.platform_controls (id) values (true)$$,
  '23505', null,
  'T2: 2行目は作れない（単一行制約）'
);
select lives_ok(
  $$select pg_temp.send_music('停止前の音楽会')$$,
  'T2: 停止前は配信できる'
);

-- ---- 1操作で全団体の配信を止める ----
set local role service_role;
select lives_ok(
  $$select public.admin_set_delivery_paused(true, 'ops-1', '誤配信の調査中')$$,
  'T2: 運営RPCで緊急停止を有効化できる'
);
reset role;
select is(
  (select c.delivery_paused from private.platform_controls c),
  true,
  'T2: 緊急停止が有効になっている'
);
select is(
  (select c.paused_reason from private.platform_controls c),
  '誤配信の調査中',
  'T2: 停止理由が記録される'
);
select is(
  (select a.new_value from private.admin_audit_log a where a.action = 'delivery_paused'),
  'true',
  'T2: 緊急停止の監査記録が残る'
);

-- ---- 停止中は配信できない ----
select throws_ok(
  $$select pg_temp.send_music('停止中の音楽会')$$,
  'P0001', 'delivery_paused',
  'T2: 緊急停止中の送信は delivery_paused で明確に拒否される'
);
select is(
  (select count(*)::int from private.offer_deliveries d
     where d.organization_id = (select id from korg) and d.event_name = '停止中の音楽会'),
  0,
  'T2: 拒否された配信は1件も残らない（部分的な配信が起きない）'
);

-- ---- 判定はRPCの中ではなく挿入そのものに効く ----
-- 将来別の挿入経路ができても素通りしないことを、テーブル所有者権限の直接insertで確かめる
-- （service_roleにはprivateスキーマのgrantが無いため、より強い権限で試す）
select throws_ok(
  $$insert into private.offer_deliveries (
      organization_id, org_name, org_description, org_contact_label, org_contact_handle,
      event_name, description, reason_note, date_text, place, event_days, frequency,
      fee_per_event_yen, beginner_friendly, intensity, target_categories, target_purposes,
      capacity, deadline, event_fingerprint)
    values ((select id from korg), '緊急停止テスト団体', '', '', '',
      'RPCを迂回した配信', '説明', '理由', '9月27日（土）', '音楽室',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1000, true, 'relaxed',
      array['music']::public.interest_category[], array['creation']::public.purpose[],
      10, '2026-09-25', 'bypass-fingerprint-ks')$$,
  'P0001', 'delivery_paused',
  'T2: RPCを通さない直接insertも緊急停止で止まる（構造で止める）'
);

-- ---- 解除 ----
set local role service_role;
select lives_ok(
  $$select public.admin_set_delivery_paused(false, 'ops-1', null)$$,
  'T2: 緊急停止を解除できる'
);
reset role;
select is(
  (select c.paused_reason from private.platform_controls c),
  null,
  'T2: 解除で停止理由が消える'
);
select is(
  (select a.new_value from private.admin_audit_log a where a.action = 'delivery_resumed'),
  'false',
  'T2: 解除の監査記録が残る'
);
select lives_ok(
  $$select pg_temp.send_music('解除後の音楽会')$$,
  'T2: 解除後は再び配信できる'
);

-- ---- 操作者ラベルの必須 ----
set local role service_role;
select throws_ok(
  $$select public.admin_set_delivery_paused(true, '   ', '理由')$$,
  'P0001', 'invalid_admin_action',
  'T2: 操作者ラベルが空の緊急停止は拒否される'
);
reset role;

select * from finish();
rollback;
