-- Task 013-T1: 団体状態（pending / verified / suspended）と配信可否、
-- 個別オファーの停止が受信箱・返答導線へ反映されること（D043・D044）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

-- ---- 種（団体オーナー1人 + 受信学生6人） ----
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000e0001', 'demo-st-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000e0002', 'demo-st-other@stu.kobe-u.ac.jp', now(), now(), now());
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000e1' || to_char(n, 'FM000'))::uuid,
       'demo-st-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-0000000e1' || to_char(n, 'FM000'))::uuid
from generate_series(1, 6) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-0000000e1' || to_char(n, 'FM000'))::uuid,
  array['photo']::public.interest_category[], array['creation','friends']::public.purpose[],
  'relaxed', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['photo']::public.interest_category[], 5
from generate_series(1, 6) as n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e0001","role":"authenticated"}', true);
set local role authenticated;
create temp table sorg as select public.create_organization('状態テスト団体') as id;
select public.update_organization_contact(
  (select id from sorg), '写真部 新歓窓口', '@cue_photo_demo');
reset role;
grant select on sorg to public;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e0002","role":"authenticated"}', true);
set local role authenticated;
create temp table sorg2 as select public.create_organization('状態テスト別団体') as id;
reset role;
grant select on sorg2 to public;

-- 送信ヘルパ（previewを必ず先に通す・Task 011のpreview gate）
create function pg_temp.send_as(actor uuid, org uuid, ev text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', actor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.preview_offer_audience(
    org, ev, '説明文', '届けたい理由', '9月20日（土）', '写真部室',
    array['weekend']::public.day_slot[], 'monthly_1_2', 800, true, 'relaxed',
    array['photo']::public.interest_category[], array['creation','friends']::public.purpose[],
    10, '2026-09-18');
  select s.delivery_id into v_id from public.send_offer(
    org, ev, '説明文', '届けたい理由', '9月20日（土）', '写真部室',
    array['weekend']::public.day_slot[], 'monthly_1_2', 800, true, 'relaxed',
    array['photo']::public.interest_category[], array['creation','friends']::public.purpose[],
    10, '2026-09-18') s;
  reset role;
  return v_id;
end
$$;

-- ---- 状態は3値だけを取る ----
select set_eq(
  $$select unnest(enum_range(null::public.org_status))::text$$,
  array['pending', 'verified', 'suspended'],
  'T1: 団体状態は pending / verified / suspended の3値'
);
select is(
  (select status::text from public.organizations where id = (select id from sorg)),
  'pending',
  'T1: 作成直後の団体は pending'
);

-- ---- pending は配信できない ----
select throws_ok(
  $$select pg_temp.send_as('00000000-0000-0000-0000-0000000e0001'::uuid, (select id from sorg), 'pending配信')$$,
  'P0001', 'org_not_verified',
  'T1: pending の団体は配信できない'
);

-- ---- verified 化はservice_role専用RPCで行う ----
set local role service_role;
select lives_ok(
  $$select public.admin_set_organization_status(
      (select id from sorg), 'verified', 'ops-1', '書類確認済み')$$,
  'T1: 運営RPCで verified へ変更できる'
);
reset role;
select is(
  (select status::text from public.organizations where id = (select id from sorg)),
  'verified',
  'T1: 状態が verified へ変わっている'
);
select is(
  (select a.previous_value || '->' || a.new_value from private.admin_audit_log a
    where a.target_organization_id = (select id from sorg)
      and a.action = 'organization_status_changed'),
  'pending->verified',
  'T1: 監査記録に変更前後の状態が残る'
);

-- ---- verified なら配信できる ----
select lives_ok(
  $$select pg_temp.send_as('00000000-0000-0000-0000-0000000e0001'::uuid, (select id from sorg), '写真散歩')$$,
  'T1: verified の団体は配信できる'
);
create temp table d1 as select id from private.offer_deliveries where event_name = '写真散歩';
grant select on d1 to public;
select is((select count(*)::int from private.offer_recipients where delivery_id = (select id from d1)), 6,
  'T1: 6人へ配信されている');

-- ---- 受信箱では停止前は stopped = false ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e1001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select i.stopped from public.list_my_inbox() i where i.delivery_id = (select id from d1)),
  false,
  'T1: 停止前の受信箱は stopped = false'
);
select lives_ok(
  $$select public.respond_to_offer((select id from d1), 'interested')$$,
  'T1: 停止前は返答できる'
);
select isnt(
  (select i.org_contact_handle from public.list_my_inbox() i where i.delivery_id = (select id from d1)),
  '',
  'T1: 「行ってみたい」の後は公式窓口が開示される（D033）'
);
reset role;

-- ---- 個別オファーの停止（D044） ----
set local role service_role;
select lives_ok(
  $$select public.admin_set_offer_stopped((select id from d1), true, 'ops-1', '内容の確認中')$$,
  'T1: 運営RPCで個別オファーを停止できる'
);
reset role;
select isnt(
  (select stopped_at from private.offer_deliveries where id = (select id from d1)),
  null,
  'T1: 配信行へ停止時刻が記録される'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e1001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_inbox() i where i.delivery_id = (select id from d1)),
  1,
  'T1: 停止しても受信箱から消えない（何が起きたか分かるように残す・D044）'
);
select is(
  (select i.stopped from public.list_my_inbox() i where i.delivery_id = (select id from d1)),
  true,
  'T1: 停止後の受信箱は stopped = true'
);
select is(
  (select i.org_contact_handle from public.list_my_inbox() i where i.delivery_id = (select id from d1)),
  '',
  'T1: 停止後は開示済みの公式窓口も返さない'
);
select throws_ok(
  $$select public.respond_to_offer((select id from d1), 'thinking')$$,
  'P0001', 'offer_stopped',
  'T1: 停止後は返答できない'
);
select lives_ok(
  $$select public.mark_offer_read((select id from d1))$$,
  'T1: 停止後も既読の記録自体は妨げない（閲覧は可能）'
);
reset role;

-- ---- 停止した案内の未送信メールを取り消す（Task 010との接続） ----
select is(
  (select count(*)::int from private.email_outbox o
     where o.kind = 'offer_arrival' and o.dedupe_key = (select id from d1)::text
       and o.status = 'cancelled'),
  6,
  'T1: 停止で、その案内の未送信メールが取り消される'
);
select is(
  (select count(*)::int from private.email_outbox o
     where o.kind = 'offer_arrival' and o.dedupe_key = (select id from d1)::text
       and o.status = 'pending'),
  0,
  'T1: 停止後に送信待ちのまま残る案内メールは無い'
);

-- ---- 停止の解除 ----
set local role service_role;
select lives_ok(
  $$select public.admin_set_offer_stopped((select id from d1), false, 'ops-1', '確認完了')$$,
  'T1: 停止を解除できる'
);
reset role;
select is(
  (select stopped_at from private.offer_deliveries where id = (select id from d1)),
  null,
  'T1: 解除で停止時刻が消える'
);

-- ---- suspended は新規配信を止め、配信中のofferも止める ----
-- 停止時点で送信待ちのメールがある2件目を作る
select lives_ok(
  $$select pg_temp.send_as('00000000-0000-0000-0000-0000000e0001'::uuid, (select id from sorg), '写真展示')$$,
  'T1: 2件目の配信ができる'
);
create temp table d2 as select id from private.offer_deliveries where event_name = '写真展示';
grant select on d2 to public;
select is(
  (select count(*)::int from private.email_outbox o
     where o.kind = 'offer_arrival' and o.dedupe_key = (select id from d2)::text
       and o.status = 'pending'),
  6,
  'T1: 2件目には送信待ちのメールがある'
);

set local role service_role;
select public.admin_set_organization_status((select id from sorg), 'suspended', 'ops-2', '通報対応');
reset role;
select isnt(
  (select stopped_at from private.offer_deliveries where id = (select id from d1)),
  null,
  'T1: 団体の停止で、その団体の配信中オファーもまとめて止まる'
);
select is(
  (select count(*)::int from private.email_outbox o
     where o.kind = 'offer_arrival' and o.dedupe_key = (select id from d2)::text
       and o.status = 'pending'),
  0,
  'T1: 団体の停止で、その団体の未送信メールも取り消される'
);
select throws_ok(
  $$select pg_temp.send_as('00000000-0000-0000-0000-0000000e0001'::uuid, (select id from sorg), '停止後配信')$$,
  'P0001', 'org_not_verified',
  'T1: suspended の団体は配信できない'
);

-- 送信済みのメールは取り消さない（既に届いたものを無かったことにはできない）
select is(
  (select count(*)::int from private.email_outbox o
     where o.kind = 'offer_arrival' and o.dedupe_key = (select id from d1)::text
       and o.status = 'sent'),
  0,
  'T1: この検証では送信済みメールは無い（取り消し対象は送信待ちだけ）'
);

-- ---- 他団体は巻き込まれない ----
set local role service_role;
select public.admin_set_organization_status((select id from sorg2), 'verified', 'ops-2', null);
reset role;
select lives_ok(
  $$select pg_temp.send_as('00000000-0000-0000-0000-0000000e0002'::uuid, (select id from sorg2), '別団体の会')$$,
  'T1: 別団体の停止は他団体の配信に影響しない'
);

select * from finish();
rollback;
