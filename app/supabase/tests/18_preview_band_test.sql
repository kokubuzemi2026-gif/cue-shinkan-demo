-- Task 011-T8: 対象人数previewの区分化（D036）
-- （6区分の境界 / 生の人数をAPI応答へ含めない / 区分ヘルパーの境界値）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000e001', 'demo-band-owner@stu.kobe-u.ac.jp', now(), now(), now());

-- 母集団: outdoor 60人 / photo 30人 / travel 12人 / music 6人 / sports 3人 / film 0人
create temp table band_pop as
select n,
       case
         when n <= 60 then 'outdoor'
         when n <= 90 then 'photo'
         when n <= 102 then 'travel'
         when n <= 108 then 'music'
         else 'sports'
       end::public.interest_category as cat,
       ('00000000-0000-0000-0000-0000000e' || to_char(n, 'FM0000'))::uuid as uid
from generate_series(1, 111) as n;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select uid, 'demo-band-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now() from band_pop;
insert into public.student_accounts (user_id) select uid from band_pop;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select uid, array[cat], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array[cat], 5
from band_pop;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e001","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
set local role authenticated;
create temp table borg as select public.create_organization('区分テスト団体') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from borg);

create function pg_temp.band_for(cat public.interest_category)
returns text
language sql
as $$
  select s.audience_band from public.preview_offer_audience(
    (select id from borg), '区分確認', '説明文', '理由', '9月13日（土）', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array[cat], array['friends','challenge']::public.purpose[], 10, '2026-09-10') s
$$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e001","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.band_for('film'), '0', 'T8: 0人 → 区分 0');
select is(pg_temp.band_for('sports'), '1-4', 'T8: 3人 → 区分 1-4');
select is(pg_temp.band_for('music'), '5-9', 'T8: 6人 → 区分 5-9');
select is(pg_temp.band_for('travel'), '10-24', 'T8: 12人 → 区分 10-24');
select is(pg_temp.band_for('photo'), '25-49', 'T8: 30人 → 区分 25-49');
select is(pg_temp.band_for('outdoor'), '50+', 'T8: 60人 → 区分 50+');
reset role;

-- ---- 区分ヘルパーの境界値（生の人数からの唯一の変換点） ----
select is(private.audience_band(0), '0', 'T8: band(0) = 0');
select is(private.audience_band(1), '1-4', 'T8: band(1) = 1-4');
select is(private.audience_band(4), '1-4', 'T8: band(4) = 1-4');
select is(private.audience_band(5), '5-9', 'T8: band(5) = 5-9（送信可能の下限と一致）');
select is(private.audience_band(9), '5-9', 'T8: band(9) = 5-9');
select is(private.audience_band(10), '10-24', 'T8: band(10) = 10-24');
select is(private.audience_band(24), '10-24', 'T8: band(24) = 10-24');
select is(private.audience_band(25), '25-49', 'T8: band(25) = 25-49');
select is(private.audience_band(49), '25-49', 'T8: band(49) = 25-49');
select is(private.audience_band(50), '50+', 'T8: band(50) = 50+');

-- ---- 生の人数が保存・応答に現れない ----
select is_empty(
  $$select column_name::text from information_schema.columns
     where table_schema = 'private' and table_name = 'offer_preview_cache'
       and column_name not in
         ('organization_id','audience_fingerprint','band','first_computed_at',
          'last_accessed_at','access_count')$$,
  'T8: preview保存表に生の人数・学生の希望条件を持つ列が無い'
);

select * from finish();
rollback;
