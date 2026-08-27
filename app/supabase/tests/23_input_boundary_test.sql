-- Task 011-T13: 入力検証の境界値（D039）
-- 「上限ちょうど」は通り、「上限+1」は拒否されることを、各項目について確認する。
-- 拒否側だけを検証すると、実装が過剰に厳しくても気づけないため両側を固定する。
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000ea01', 'demo-bnd-owner@stu.kobe-u.ac.jp', now(), now(), now());
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-00000000e90' || to_char(n, 'FM0'))::uuid,
       'demo-bnd-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-00000000e90' || to_char(n, 'FM0'))::uuid
from generate_series(1, 6) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-00000000e90' || to_char(n, 'FM0'))::uuid,
  array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 5
from generate_series(1, 6) as n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000ea01","role":"authenticated"}', true);
set local role authenticated;
create temp table borg as select public.create_organization('境界値テスト団体') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from borg);

-- 検証だけを見る（previewは団体の週枠を消費しないため、境界を何度でも試せる）
create function pg_temp.pv(
  ev text default 'イベント',
  de text default '説明文',
  rn text default '理由',
  dt text default '9月13日',
  pl text default '場所',
  fee integer default 1500,
  cap integer default 10,
  dl date default '2026-09-10',
  days public.day_slot[] default array['weekend']::public.day_slot[],
  cats public.interest_category[] default array['outdoor']::public.interest_category[],
  purps public.purpose[] default array['friends']::public.purpose[]
)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-00000000ea01","role":"authenticated"}', true);
  set local role authenticated;
  perform public.preview_offer_audience(
    (select id from borg), ev, de, rn, dt, pl, days, 'monthly_1_2', fee, true, 'moderate',
    cats, purps, cap, dl);
  return 'ok';
exception when others then return sqlerrm;
end $$;

-- ---- 文字列長: ちょうど / +1 ----
select is(pg_temp.pv(ev => repeat('a', 100)), 'ok', 'T13: イベント名100文字ちょうどは通る');
select is(pg_temp.pv(ev => repeat('a', 101)), 'invalid_offer', 'T13: イベント名101文字は拒否');
select is(pg_temp.pv(de => repeat('b', 500)), 'ok', 'T13: 紹介文500文字ちょうどは通る');
select is(pg_temp.pv(de => repeat('b', 501)), 'invalid_offer', 'T13: 紹介文501文字は拒否');
select is(pg_temp.pv(pl => repeat('c', 100)), 'ok', 'T13: 場所100文字ちょうどは通る');
select is(pg_temp.pv(pl => repeat('c', 101)), 'invalid_offer', 'T13: 場所101文字は拒否');

-- ---- 巨大payloadの境界: 4000バイトちょうどは意味検証へ進み、4001バイトは前段で切る ----
select is(pg_temp.pv(ev => repeat('d', 4000)), 'invalid_offer',
  'T13: 4000バイトちょうどは前段を通過し、意味的な検証（100文字）で拒否される');
select is(pg_temp.pv(ev => repeat('d', 4001)), 'payload_too_large',
  'T13: 4001バイトはマッチング計算より前に拒否される');

-- ---- 参加費: 0 / 100000 ちょうど / +1 ----
select is(pg_temp.pv(fee => 0), 'ok', 'T13: 参加費0円は通る（無料イベント）');
select is(pg_temp.pv(fee => 100000), 'ok', 'T13: 参加費100000円ちょうどは通る');
select is(pg_temp.pv(fee => 100001), 'invalid_offer', 'T13: 参加費100001円は拒否');

-- ---- 定員: 1 / 1000 ちょうど / 範囲外 ----
select is(pg_temp.pv(cap => 1), 'ok', 'T13: 定員1人は通る');
select is(pg_temp.pv(cap => 1000), 'ok', 'T13: 定員1000人ちょうどは通る');
select is(pg_temp.pv(cap => 1001), 'invalid_offer', 'T13: 定員1001人は拒否');

-- ---- 配列長: 64要素ちょうどは前段を通過。65要素は前段で切る ----
-- enumの値数（カテゴリ8・目的4・曜日3）より多い「異なる値」は作れないため、
-- 重複除去後に上限を超えることはない。前段の64要素制限は、
-- 重複除去（unnest + group by）を巨大な配列で走らせないための防御であり、
-- 意味的な上限とは別のもの
select is(
  pg_temp.pv(cats => (select array_agg('outdoor'::public.interest_category)
                        from generate_series(1, 64))),
  'ok',
  'T13: 64要素ちょうどは前段を通過し、重複除去で1件へ正規化されて通る'
);
select is(
  pg_temp.pv(cats => (select array_agg('outdoor'::public.interest_category)
                        from generate_series(1, 65))),
  'payload_too_large',
  'T13: 65要素は重複除去より前に拒否される'
);

select * from finish();
rollback;
