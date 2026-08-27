-- Task 010-T14: outboxの冪等性・状態遷移・backoff（D041）
-- （設定3種の反映 / offは積まない / 二重に積まれない / 再試行のbackoff /
--   上限超過でfailed / 送信失敗が配信を壊さない / daily digestは1日1行）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000f0001', 'demo-nt-owner@stu.kobe-u.ac.jp', now(), now(), now());
-- 学生6人: s1〜s2=each(既定) / s3〜s4=daily / s5〜s6=off
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-00000000f10' || to_char(n, 'FM0'))::uuid,
       'demo-nt-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-00000000f10' || to_char(n, 'FM0'))::uuid
from generate_series(1, 6) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-00000000f10' || to_char(n, 'FM0'))::uuid,
  array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 5
from generate_series(1, 6) as n;

-- 学生本人が設定する（RPC経由・s3/s4=daily, s5/s6=off）
create function pg_temp.set_mode(uid uuid, m public.notification_mode)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
  set local role authenticated;
  perform public.save_notification_settings(m);
  reset role;
end $$;
select pg_temp.set_mode('00000000-0000-0000-0000-00000000f103', 'daily');
select pg_temp.set_mode('00000000-0000-0000-0000-00000000f104', 'daily');
select pg_temp.set_mode('00000000-0000-0000-0000-00000000f105', 'off');
select pg_temp.set_mode('00000000-0000-0000-0000-00000000f106', 'off');

select is(
  (select mode::text from public.student_notification_settings
    where user_id = '00000000-0000-0000-0000-00000000f103'),
  'daily',
  'T14: 学生が通知設定を保存できる'
);
select is(
  (select count(*)::int from public.student_notification_settings),
  4,
  'T14: 設定していない学生には行が作られない（既定はeach）'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000f0001","role":"authenticated"}', true);
set local role authenticated;
create temp table norg as select public.create_organization('通知テスト団体') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from norg);

create function pg_temp.send(ev text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000f0001","role":"authenticated"}', true);
  set local role authenticated;
  perform public.preview_offer_audience(
    (select id from norg), ev, '説明文', '理由', '9月13日（土）', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    10, '2026-09-10');
  select s.delivery_id into v from public.send_offer(
    (select id from norg), ev, '説明文', '理由', '9月13日（土）', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    10, '2026-09-10') s;
  reset role;
  return v;
end $$;

create temp table d1 as select pg_temp.send('1通目') as id;

-- 送信ワーカー（service_role）の操作は関数内でrole切替する。
-- 外側で `set role` すると、postgres所有の一時表を読めなくなるため
create function pg_temp.claim(n integer) returns integer language plpgsql as $$
declare c integer;
begin
  set local role service_role;
  select count(*) into c from public.claim_email_batch(n);
  reset role;
  return c;
end $$;
create function pg_temp.complete(oid uuid, ok boolean, code text default null)
returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.complete_email(oid, ok, code);
  reset role;
end $$;

-- ---- 設定に応じて積まれる ----
select is(
  (select count(*)::int from private.email_outbox where kind = 'offer_arrival'),
  2,
  'T14: eachの学生2人にだけオファーごとの通知が積まれる'
);
select is(
  (select count(*)::int from private.email_outbox where kind = 'daily_digest'),
  2,
  'T14: dailyの学生2人にはまとめが1日1行だけ積まれる'
);
select is_empty(
  $$select o.id::text from private.email_outbox o
     where o.user_id in ('00000000-0000-0000-0000-00000000f105',
                         '00000000-0000-0000-0000-00000000f106')$$,
  'T14: offの学生には一切積まれない'
);
select is(
  (select count(*)::int from private.offer_recipients r
    join private.offer_deliveries d on d.id = r.delivery_id
   where d.id = (select id from d1)),
  6,
  'T14: 通知設定は配信そのものには影響しない（offの学生にもオファーは届く）'
);

-- ---- daily digestは同じ日に何通届いても1行のまま ----
select pg_temp.send('2通目') as id;
select is(
  (select count(*)::int from private.email_outbox where kind = 'daily_digest'),
  2,
  'T14: 同じ日に2通目が届いてもまとめは増えない（1人1日1行）'
);
select is(
  (select count(*)::int from private.email_outbox where kind = 'offer_arrival'),
  4,
  'T14: eachはオファーごとに積まれる（2人×2通）'
);

-- ---- 同じ配信の再enqueueで二重に積まれない（冪等） ----
insert into private.offer_recipients (delivery_id, user_id, score, reasons, cautions)
select (select id from d1), '00000000-0000-0000-0000-00000000f101', 90,
       array['理由']::text[], array[]::text[]
on conflict do nothing;
select is(
  (select count(*)::int from private.email_outbox
    where kind = 'offer_arrival' and dedupe_key = (select id::text from d1)),
  2,
  'T14: 同じ配信・同じ学生の通知は二重に積まれない（一意制約）'
);

-- ---- 送信ワーカー: 取り出しと結果記録 ----
select is(
  pg_temp.claim(10),
  4,
  'T14: 期限が来たpendingだけが取り出される（まとめは18時までpendingのまま）'
);
select is(
  (select count(*)::int from private.email_outbox where status = 'sending'),
  4,
  'T14: 取り出した行はsendingへ進む'
);
select is(
  (select count(distinct attempts)::int from private.email_outbox where status = 'sending'),
  1,
  'T14: 取り出しで試行回数が1つ上がる'
);
select is(
  pg_temp.claim(10),
  0,
  'T14: 同じ行は二重に取り出されない'
);

-- ---- 成功・失敗・backoff ----
create temp table one as
  select id from private.email_outbox where status = 'sending' order by id limit 1;
select pg_temp.complete((select id from one), true);
select is(
  (select status::text from private.email_outbox where id = (select id from one)),
  'sent',
  'T14: 成功でsentになる'
);
select ok(
  (select sent_at is not null and last_error_code is null
     from private.email_outbox where id = (select id from one)),
  'T14: 成功時は送信時刻が入り、エラーコードは消える'
);

create temp table two as
  select id from private.email_outbox where status = 'sending' order by id limit 1;
select pg_temp.complete((select id from two), false, 'smtp_timeout');
select is(
  (select status::text from private.email_outbox where id = (select id from two)),
  'pending',
  'T14: 失敗は再試行のためpendingへ戻る'
);
select ok(
  (select next_attempt_at > now() and last_error_code = 'smtp_timeout'
     from private.email_outbox where id = (select id from two)),
  'T14: 再試行はbackoffで先送りされ、短いエラーコードだけが残る'
);

-- 上限（5回）を超えるとfailedで止まる
update private.email_outbox set attempts = 5, status = 'sending' where id = (select id from two);
select pg_temp.complete((select id from two), false, 'smtp_auth');
select is(
  (select status::text from private.email_outbox where id = (select id from two)),
  'failed',
  'T14: 試行上限を超えるとfailedで止まる（無限に再試行しない）'
);

-- backoffは試行ごとに伸びる
select ok(
  private.email_retry_delay(1) < private.email_retry_delay(2)
  and private.email_retry_delay(2) < private.email_retry_delay(3),
  'T14: backoffは試行ごとに長くなる'
);

-- ---- まとめの送信時刻はAsia/Tokyoの18時 ----
select is(
  private.next_digest_time(timestamptz '2026-09-13 09:00:00+09'),
  timestamptz '2026-09-13 18:00:00+09',
  'T14: 18時より前に届いた分は当日18時にまとめる'
);
select is(
  private.next_digest_time(timestamptz '2026-09-13 20:00:00+09'),
  timestamptz '2026-09-14 18:00:00+09',
  'T14: 18時を過ぎた分は翌日18時にまとめる'
);

select * from finish();
rollback;
