-- Task 011-T9: previewの24時間固定と条件数制限（D038）
-- （同一条件は24時間同じ区分 / 再問い合わせは回数を消費しない /
--   rolling 24時間で21条件目を拒否 / 条件は正規化fingerprintのみ保存 / 順序非依存）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000f001', 'demo-quota-owner@stu.kobe-u.ac.jp', now(), now(), now());
create temp table qpop as
select n, ('00000000-0000-0000-0000-0000000f' || to_char(n, 'FM0000'))::uuid as uid
from generate_series(1, 8) as n;
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select uid, 'demo-quota-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now() from qpop;
insert into public.student_accounts (user_id) select uid from qpop;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select uid, array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 5
from qpop;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', true);
set local role authenticated;
create temp table qorg as select public.create_organization('preview制限テスト団体') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from qorg);

-- feeだけを変えて条件を作る（feeはマッチ判定へ影響する7項目のひとつ）
create function pg_temp.pv(fee integer)
returns table (audience_band text, preview_conditions_used integer)
language sql
as $$
  select s.audience_band, s.preview_conditions_used
    from public.preview_offer_audience(
      (select id from qorg), '条件確認', '説明文', '理由', '9月13日（土）', '六甲ケーブル下',
      array['weekend']::public.day_slot[], 'monthly_1_2', fee, true, 'moderate',
      array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
      10, '2026-09-10') s
$$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', true);
set local role authenticated;

select is((select p.audience_band from pg_temp.pv(1000) p), '5-9', 'T9: 8人 → 区分 5-9');
select is((select p.preview_conditions_used from pg_temp.pv(1000) p), 1,
  'T9: 同一条件を再問い合わせしても消費した条件数は1のまま');
reset role;

-- 母集団が増えても、24時間以内の同一条件は同じ区分を返す
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000f' || to_char(n, 'FM0000'))::uuid,
       'demo-quota-x' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(101, 130) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-0000000f' || to_char(n, 'FM0000'))::uuid
from generate_series(101, 130) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-0000000f' || to_char(n, 'FM0000'))::uuid,
  array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 5
from generate_series(101, 130) as n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', true);
set local role authenticated;
select is((select p.audience_band from pg_temp.pv(1000) p), '5-9',
  'T9: 母集団が38人へ増えても24時間以内の同一条件は 5-9 のまま（固定）');
select is((select p.audience_band from pg_temp.pv(1001) p), '25-49',
  'T9: 別条件では現在の母集団（38人）が反映される');
reset role;

-- 24時間より古いキャッシュは再計算される
update private.offer_preview_cache
   set first_computed_at = now() - interval '25 hours'
 where audience_fingerprint = private.audience_fingerprint(
   array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
   'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1000, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', true);
set local role authenticated;
select is((select p.audience_band from pg_temp.pv(1000) p), '25-49',
  'T9: 24時間を超えた条件は再計算される');
reset role;

-- ---- rolling 24時間の条件数制限（20件） ----
delete from private.offer_preview_cache where organization_id = (select id from qorg);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select pg_temp.pv(f) from generate_series(2000, 2019) as f$$,
  'T9: 20条件までのpreviewは成功する'
);
select is((select p.preview_conditions_used from pg_temp.pv(2000) p), 20,
  'T9: 消費した条件数は20（同一条件の再問い合わせでは増えない）');
select throws_ok(
  $$select pg_temp.pv(2020)$$,
  'P0001', 'preview_quota_exceeded',
  'T9: 21条件目のpreviewは preview_quota_exceeded で拒否される'
);
select lives_ok(
  $$select pg_temp.pv(2005)$$,
  'T9: 上限到達後も、既に評価済みの同一条件は返せる（回数を消費しない）'
);
reset role;

-- 24時間より古い条件は窓から外れ、新しい条件を再び評価できる
update private.offer_preview_cache
   set first_computed_at = now() - interval '25 hours'
 where organization_id = (select id from qorg)
   and audience_fingerprint in (
     select c.audience_fingerprint from private.offer_preview_cache c
      where c.organization_id = (select id from qorg) limit 5
   );
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select pg_temp.pv(2020)$$,
  'T9: 24時間の窓から5条件が外れると、新しい条件を再び評価できる（rolling window）'
);
reset role;

-- ---- 条件はfingerprintだけを保存する（rawの条件・学生の希望条件を残さない） ----
select ok(
  (select bool_and(c.audience_fingerprint ~ '^[0-9a-f]{64}$')
     from private.offer_preview_cache c),
  'T9: 保存されるのはSHA-256 hexのfingerprintのみ'
);
select is(
  private.audience_fingerprint(
    array['outdoor','photo']::public.interest_category[],
    array['friends','challenge']::public.purpose[],
    'moderate', array['weekend','weekday_night']::public.day_slot[], 'monthly_1_2', 1500, true),
  private.audience_fingerprint(
    array['photo','outdoor']::public.interest_category[],
    array['challenge','friends']::public.purpose[],
    'moderate', array['weekday_night','weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  'T9: fingerprintは配列の順序に依存しない（マッチ判定が集合演算のみに依存するため）'
);
select isnt(
  private.audience_fingerprint(
    array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
    'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  private.audience_fingerprint(
    array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
    'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1501, true),
  'T9: 参加費が1円違えば別条件として数える（差分攻撃の1手として消費される）'
);

select * from finish();
rollback;
