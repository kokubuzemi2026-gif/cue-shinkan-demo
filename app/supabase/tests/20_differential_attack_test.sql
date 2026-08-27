-- Task 011-T10: 差分攻撃の再現と防止（D036・D038）
-- 攻撃者モデル: verified団体のadminが、対象条件を1項目ずつ変えてpreviewを繰り返し、
--   特定の新入生の予算上限・曜日・本気度などを推測しようとする。
--
-- 前提（再現に使う仕掛け）: 参加費は配点5点で、費用以外の合計が60点の学生は
--   「予算内なら65点（配信対象）／予算超過なら60点（対象外）」となる。
--   つまり参加費を1円ずつ動かすと、その学生の予算上限を境に対象集合が1人分変わる。
--   Task 011以前は preview が正確な人数を返していたため、この境界が直接読めた。
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000a0001', 'demo-diff-owner@stu.kobe-u.ac.jp', now(), now(), now());

-- 母集団: 費用以外で60点になる学生を12人置く。
-- （興味一致35 + 目的一致0 + 本気度一致15 + 曜日一致0 + 初心者歓迎10 = 60）
-- 11人は予算9000円、標的の1人（n=1）だけ予算2000円
create temp table dpop as
select n,
       ('00000000-0000-0000-0000-000000a1' || to_char(n, 'FM0000'))::uuid as uid,
       case when n = 1 then 2000 else 9000 end as budget
from generate_series(1, 12) as n;
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select uid, 'demo-diff-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now() from dpop;
insert into public.student_accounts (user_id) select uid from dpop;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select uid,
  array['outdoor']::public.interest_category[],
  array['creation']::public.purpose[],            -- オファーのtarget_purposes（friends）と一致しない → 0点
  'moderate', 'monthly_1_2',
  array['weekday_day']::public.day_slot[],        -- オファーのevent_days（weekend）と一致しない → 0点
  'none',
  budget, false, array['outdoor']::public.interest_category[], 5
from dpop;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0001","role":"authenticated"}', true);
set local role authenticated;
create temp table dorg as select public.create_organization('差分攻撃テスト団体') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from dorg);

create function pg_temp.probe(fee integer)
returns text
language sql
as $$
  select s.audience_band from public.preview_offer_audience(
    (select id from dorg), '探索用', '説明文', '理由', '9月13日（土）', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', fee, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
    10, '2026-09-10') s
$$;
-- 対照: 抑制前の真の人数（テスト内でのみ算出。RPCからは到達できない）
create function pg_temp.true_count(fee integer)
returns integer
language sql
as $$
  select count(*)::integer
    from private.evaluate_offer_audience(
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
      'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', fee, true, now()) a
   where not a.limited
$$;

-- ---- 仕掛けが成立していることの確認（攻撃が理論上は可能な状況を作れている） ----
select is(pg_temp.true_count(2000), 12, 'T10: 参加費2000円では標的を含む12人が対象（真の人数）');
select is(pg_temp.true_count(2001), 11, 'T10: 参加費2001円で標的1人だけが外れる（真の人数）');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0001","role":"authenticated"}', true);
set local role authenticated;

-- ---- 防止1: 区分化により、1人分の差が観測できない ----
select is(pg_temp.probe(2000), '10-24', 'T10: 12人のpreviewは区分 10-24');
select is(pg_temp.probe(2001), '10-24',
  'T10: 標的が外れて11人になっても区分は 10-24 のまま（1人分の差が観測できない・D036）');
select is(
  (select count(distinct b)::int from (
     select pg_temp.probe(f) as b from generate_series(1500, 8500, 1000) as f
   ) t),
  1,
  'T10: 集団が保たれる範囲（1500〜8500円）を8条件掃引しても区分は1種類しか観測されない'
);
-- 正直な限界の記録: 集団全体が対象から外れる価格帯では区分が動く。
-- これは「その価格では誰も条件に合わない」という集計情報であり、
-- 個人の予算上限を特定する情報ではない（10-24 → 0 の変化は11人以上の同時脱落を意味する）
select is(pg_temp.probe(9500), '0',
  'T10: 全員の予算を超える価格では区分0になる（集団の情報であり個人の特定ではない）');

-- ---- 防止2: 条件数の制限が探索の手数を有界にする ----
select is(
  (select s.preview_conditions_used from public.preview_offer_audience(
     (select id from dorg), '探索用', '説明文', '理由', '9月13日（土）', '六甲ケーブル下',
     array['weekend']::public.day_slot[], 'monthly_1_2', 2000, true, 'moderate',
     array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
     10, '2026-09-10') s),
  11,
  'T10: 掃引した11条件が消費として記録される（rolling 24時間で20条件まで）'
);
select throws_ok(
  $$select pg_temp.probe(f) from generate_series(3000, 3010, 1) as f$$,
  'P0001', 'preview_quota_exceeded',
  'T10: さらに掃引を続けると上限（20条件/24時間）で打ち切られる'
);
reset role;

-- ---- 防止3: 24時間固定により、学生1人の変更を観測できない ----
-- 標的が予算を9000円へ変更しても、同一条件の再previewは古い区分を返す
update public.student_passports set max_fee_per_event_yen = 9000
 where user_id = (select uid from dpop where n = 1);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0001","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.probe(2001), '10-24',
  'T10: 標的の予算変更後も同一条件は同じ区分を返す（個人の変更を観測できない・D038）');
reset role;

-- ---- 防止4: 少人数へ絞り込んでも配信をoracleにできない ----
-- 12人のうち9人の受信を停止し、対象を3人へ絞る
update public.student_passports set reception_paused = true
 where user_id in (select uid from dpop where n between 4 and 12);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.send_offer(
      (select id from dorg), '絞り込み送信', '説明文', '理由', '9月14日（日）', '摩耶山',
      array['weekend']::public.day_slot[], 'monthly_1_2', 2000, true, 'moderate',
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
      10, '2026-09-10')$$,
  'P0001', 'insufficient_audience',
  'T10: 3人へ絞り込んでも配信は拒否され、送信をoracleに使えない（k=5・D036）'
);
reset role;

select * from finish();
rollback;
