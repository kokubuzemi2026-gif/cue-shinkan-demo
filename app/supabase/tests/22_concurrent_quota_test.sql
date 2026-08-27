-- Task 011-T12: 学生の週間受信枠の原子的確保（D037）のうち、単一セッションで決定的に検証できる部分
--
-- 本物の並行実行（2セッション以上）は pgTAP では作れない
-- （1ファイル = 1セッション = 1トランザクション）。
-- dblinkはSupabaseのローカルスタックで postgres が superuser ではないため使えない。
-- 実際に並行するトランザクションでの検証は `app/scripts/concurrency_test.sh` が行い、
-- CIの db-tests ジョブが `npm run db:test:concurrency` として実行する。
--
-- ここでは、並行実行の結果として起こりうる状態を人工的に作り、
-- 週枠の判定・原子性・再試行の性質を決定的に検証する。
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000cc001', 'demo-quota-owner@stu.kobe-u.ac.jp', now(), now(), now());
-- 学生6人・週間受信上限1件
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000cc1' || to_char(n, 'FM00'))::uuid,
       'demo-quota-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-0000000cc1' || to_char(n, 'FM00'))::uuid
from generate_series(1, 6) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-0000000cc1' || to_char(n, 'FM00'))::uuid,
  array['international']::public.interest_category[], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['international']::public.interest_category[], 1
from generate_series(1, 6) as n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000cc001","role":"authenticated"}', true);
set local role authenticated;
create temp table qorg_a as select public.create_organization('枠テスト団体A') as id;
create temp table qorg_b as select public.create_organization('枠テスト団体B') as id;
reset role;
update public.organizations set status = 'verified'
 where id in ((select id from qorg_a), (select id from qorg_b));

create function pg_temp.send(org uuid, ev text)
returns text
language sql
as $$
  select s.audience_band from public.send_offer(
    org, ev, '説明文', '届けたい理由', '9月13日（土）', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['international']::public.interest_category[],
    array['friends','challenge']::public.purpose[], 10, '2026-09-10') s
$$;

-- ---- 枠の専用テーブルが存在し、外部から到達できない ----
select has_table('private', 'student_delivery_quota', 'T12: 週間受信枠の専用テーブルがある');
select ok(
  not has_table_privilege('authenticated', 'private.student_delivery_quota', 'SELECT')
  and not has_table_privilege('anon', 'private.student_delivery_quota', 'SELECT'),
  'T12: 枠テーブルはanon・authenticatedから読めない'
);

-- ---- 1通目: 6人へ配信され、枠が消費される ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000cc001","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.send((select id from qorg_a), '1通目'), '5-9', 'T12: 1通目は6人へ配信される');
reset role;
select is(
  (select coalesce(sum(q.window_count), 0)::int from private.student_delivery_quota q),
  6,
  'T12: 配信された6人の枠が1件ずつ消費として記録される'
);

-- ---- 2通目（別団体）: 全員が上限に達しているため配信0人 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000cc001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select pg_temp.send((select id from qorg_b), '2通目')$$,
  'P0001', 'no_recipients',
  'T12: 週上限に達した学生だけが対象の送信は拒否される'
);
reset role;
select is(
  (select count(*)::int from private.offer_deliveries d
    where d.organization_id = (select id from qorg_b)),
  0,
  'T12: 拒否された送信の配信行は残らない（部分配信が起きない）'
);
select is(
  (select coalesce(sum(q.window_count), 0)::int from private.student_delivery_quota q),
  6,
  'T12: 拒否された送信でquotaだけが余分に消費されない'
);

-- ---- 再試行で二重配信されない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000cc001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select pg_temp.send((select id from qorg_a), '1通目')$$,
  'P0001', 'duplicate_event',
  'T12: 同一イベントの再試行は duplicate_event で拒否される（二重配信されない）'
);
reset role;
select is(
  (select max(c)::int from (
     select count(*) as c from private.offer_recipients r
       join private.offer_deliveries d on d.id = r.delivery_id
      where d.delivered_at > now() - interval '7 days'
      group by r.user_id) t),
  1,
  'T12: 学生1人あたりの週間受信は上限1件を超えない'
);

-- ---- 並行トランザクションのdelivered_atが自分より後でも週枠に数える ----
-- 先にcommitした並行トランザクションのdelivered_atは、後発の判定時刻より後になり得る。
-- 上限を自分のnow()で閉じると、その配信を取りこぼして上限が破れる。
-- ここでは1通目の配信時刻を未来へずらし、その状態でも2通目が拒否されることを確かめる。
update private.offer_deliveries set delivered_at = now() + interval '1 hour'
 where organization_id = (select id from qorg_a);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000cc001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select pg_temp.send((select id from qorg_b), '未来時刻との競合')$$,
  'P0001', 'no_recipients',
  'T12: 自分より後の時刻でcommitされた配信も週枠に数える（取りこぼしで上限が破れない）'
);
reset role;

select * from finish();
rollback;
