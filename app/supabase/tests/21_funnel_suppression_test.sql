-- Task 011-T11: 団体ファネルの10-5ルール（D037）
-- （配信10人未満は非開示 / 各セル10未満は抑制 / 開示値は5人単位 /
--   パーセントを返さない / 同じ日は同じsnapshot / 個人の拒否情報を返す経路が無い）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000b0001', 'demo-supp-owner@stu.kobe-u.ac.jp', now(), now(), now());

-- photo 9人（配信10人未満のケース）/ outdoor 13人（開示されるケース）
create temp table spop as
select n,
       case when n <= 9 then 'photo' else 'outdoor' end::public.interest_category as cat,
       ('00000000-0000-0000-0000-000000b1' || to_char(n, 'FM0000'))::uuid as uid
from generate_series(1, 22) as n;
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select uid, 'demo-supp-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now() from spop;
insert into public.student_accounts (user_id) select uid from spop;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select uid, array[cat], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array[cat], 5
from spop;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000b0001","role":"authenticated"}', true);
set local role authenticated;
create temp table sorg as select public.create_organization('抑制テスト団体') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from sorg);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000b0001","role":"authenticated"}', true);
set local role authenticated;
create temp table d_small as
  select s.delivery_id as id from public.send_offer(
    (select id from sorg), '写真散歩', '説明文', '理由', '9月13日（土）', '旧居留地',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['photo']::public.interest_category[], array['friends','challenge']::public.purpose[],
    10, '2026-09-10') s;
create temp table d_big as
  select s.delivery_id as id from public.send_offer(
    (select id from sorg), '六甲山ハイク', '説明文', '理由', '9月20日（土）', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    10, '2026-09-18') s;
reset role;

-- 大きい配信（13人）: 12人が既読、11人が「行ってみたい」、1人が「見送る」
do $$
declare v_uid uuid; v_i integer := 0;
begin
  for v_uid in select uid from spop where cat = 'outdoor' order by n loop
    v_i := v_i + 1;
    perform set_config('request.jwt.claims',
      '{"sub":"' || v_uid || '","role":"authenticated"}', true);
    if v_i <= 12 then
      perform public.mark_offer_read((select id from d_big));
    end if;
    if v_i <= 11 then
      perform public.respond_to_offer((select id from d_big), 'interested');
    elsif v_i = 12 then
      perform public.respond_to_offer((select id from d_big), 'skip');
    end if;
  end loop;
end $$;
-- 小さい配信（9人）: 全員が既読・「行ってみたい」
do $$
declare v_uid uuid;
begin
  for v_uid in select uid from spop where cat = 'photo' order by n loop
    perform set_config('request.jwt.claims',
      '{"sub":"' || v_uid || '","role":"authenticated"}', true);
    perform public.mark_offer_read((select id from d_small));
    perform public.respond_to_offer((select id from d_small), 'interested');
  end loop;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000b0001","role":"authenticated"}', true);
set local role authenticated;

-- ---- 配信10人未満は一切開示しない ----
select is(
  (select (c.funnel_available, c.delivered_count, c.viewed_count, c.engaged_count, c.planned_count)::text
     from public.list_org_campaigns((select id from sorg)) c
    where c.delivery_id = (select id from d_small)),
  '(f,,,,)',
  'T11: 配信9人のofferはファネルを開示しない（全セルNULL・集計に必要な人数未満）'
);

-- ---- 10人以上: 開示値は5人単位、10未満のセルは抑制 ----
-- 生の値は 配信13 / 閲覧12 / 関心11 / 参加意向11 → 開示は 15 / 10 / 10 / 10
select is(
  (select (c.funnel_available, c.delivered_count, c.viewed_count, c.engaged_count, c.planned_count)::text
     from public.list_org_campaigns((select id from sorg)) c
    where c.delivery_id = (select id from d_big)),
  '(t,15,10,10,10)',
  'T11: 配信13→15・閲覧12→10・関心11→10・参加意向11→10（5人単位の丸め）'
);
reset role;
select is(
  (select (s.delivered_count, s.viewed_count, s.engaged_count, s.planned_count)::text
     from private.offer_funnel_snapshots s where s.delivery_id = (select id from d_big)),
  '(13,12,11,11)',
  'T11: 生のsnapshotは13/12/11/11（開示前の値はprivate側にのみ存在する）'
);

-- ---- 同じ日・同じofferには常に同じsnapshotを返す ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000b0001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(distinct t.row_text)::int from (
     select (c.delivered_count, c.viewed_count, c.engaged_count, c.planned_count)::text as row_text
       from public.list_org_campaigns((select id from sorg)) c
      where c.delivery_id = (select id from d_big)
     union all
     select (c.delivered_count, c.viewed_count, c.engaged_count, c.planned_count)::text
       from public.list_org_campaigns((select id from sorg)) c
      where c.delivery_id = (select id from d_big)
   ) t),
  1,
  'T11: 同一日の再取得で同じ値が返る（リアルタイム更新しない）'
);
select is(
  (select c.snapshot_date from public.list_org_campaigns((select id from sorg)) c
    where c.delivery_id = (select id from d_big)),
  (now() at time zone 'Asia/Tokyo')::date,
  'T11: snapshot_dateはAsia/Tokyoの暦日'
);
reset role;

-- ---- 丸めヘルパーの境界値（四捨五入・5人単位） ----
select is(private.round_to_base5(0), 0, 'T11: round5(0) = 0');
select is(private.round_to_base5(10), 10, 'T11: round5(10) = 10');
select is(private.round_to_base5(12), 10, 'T11: round5(12) = 10');
select is(private.round_to_base5(13), 15, 'T11: round5(13) = 15');
select is(private.round_to_base5(17), 15, 'T11: round5(17) = 15');
select is(private.round_to_base5(18), 20, 'T11: round5(18) = 20');
select is(private.round_to_base5(22), 20, 'T11: round5(22) = 20');
select is(private.round_to_base5(23), 25, 'T11: round5(23) = 25');

-- ---- パーセント・拒否情報を返す経路が無い ----
select is_empty(
  $$select p.proname::text from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(coalesce(p.proargnames, '{}')) as a(argname)
    where n.nspname = 'public'
      and a.argname ~* '(percent|ratio|rate|pct)'$$,
  'T11: 公開RPCにパーセント・比率を返す列が存在しない（抑制値の逆算を防ぐ）'
);
select is_empty(
  $$select p.proname::text from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(coalesce(p.proargnames, '{}')) as a(argname)
    where n.nspname = 'public'
      and a.argname ~* '(skip|declin|reject|refus)'$$,
  'T11: 公開RPCに個人の拒否情報を返す列が存在しない'
);
-- 団体メンバーからprivateの生データ・受信者一覧へ到達する経路が無い
select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'T11: authenticatedはprivateスキーマへ到達できない（生のsnapshot・受信者行を読めない）'
);

select * from finish();
rollback;
