-- Task 010-T16: 利用者コントロールと滞留の回収（独立レビューで見つかったBlockerの回帰テスト）
-- （offにしたら積まれ済みも送られない / 受け取り方の変更が未送信分に効く /
--   ワーカーが落ちた行を回収する / 宛先が無い行を止める /
--   まとめが日境界で二重にならない・18時以降の分が消えない /
--   backoffが実際に使われる / 試行回数が実際に増える / sent以外を進めない）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-00000000d90' || to_char(n, 'FM0'))::uuid,
       'demo-ctl-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 4) as n;
-- 宛先メールが取れない学生（Auth側でメールが消えた等）
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000d905', null, now(), now(), now());
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-00000000d90' || to_char(n, 'FM0'))::uuid
from generate_series(1, 5) as n;

create function pg_temp.set_mode(uid uuid, m public.notification_mode)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  set local role authenticated;
  perform public.save_notification_settings(m);
  reset role;
end $$;
create function pg_temp.claim(n integer) returns integer language plpgsql as $$
declare c integer;
begin
  set local role service_role;
  select count(*) into c from public.claim_email_batch(n);
  reset role;
  return c;
end $$;
create function pg_temp.complete(oid uuid, ok boolean, code text default null)
returns text language plpgsql as $$
begin
  set local role service_role;
  perform public.complete_email(oid, ok, code);
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlerrm;
end $$;

-- ---- B4: offにしたら、既に積まれた分も送られない ----
insert into private.email_outbox (kind, user_id, dedupe_key, next_attempt_at)
values ('offer_arrival', '00000000-0000-0000-0000-00000000d901', 'k1', now() - interval '1 minute');
select pg_temp.set_mode('00000000-0000-0000-0000-00000000d901', 'off');
select is(
  (select status::text from private.email_outbox where dedupe_key = 'k1'),
  'cancelled',
  'T16: 通知を止めると、積まれ済みの未送信分がその場で取り消される'
);
select is(pg_temp.claim(50), 0, 'T16: 取り消された行はワーカーに取り出されない');

-- 設定変更を経由せず直接pendingへ戻しても、送信時に再確認して止まる
update private.email_outbox set status = 'pending' where dedupe_key = 'k1';
select is(pg_temp.claim(50), 0,
  'T16: 送信時にも現在の設定を再確認するため、offの学生は取り出されない');
select is(
  (select status::text from private.email_outbox where dedupe_key = 'k1'),
  'cancelled',
  'T16: 送信時の再確認でも取り消し状態になる（enqueue時の判定だけに頼らない）'
);

-- ---- 受け取り方の変更が、合わなくなった未送信分に効く ----
insert into private.email_outbox (kind, user_id, dedupe_key, next_attempt_at)
values ('offer_arrival', '00000000-0000-0000-0000-00000000d902', 'k2', now() - interval '1 minute');
select pg_temp.set_mode('00000000-0000-0000-0000-00000000d902', 'daily');
select is(
  (select status::text from private.email_outbox where dedupe_key = 'k2'),
  'cancelled',
  'T16: eachからdailyへ変えると、未送信のオファーごと通知は取り消される'
);

-- ---- B1: ワーカーが落ちた行を回収する ----
insert into private.email_outbox (kind, user_id, dedupe_key, next_attempt_at, status, attempts)
values ('offer_arrival', '00000000-0000-0000-0000-00000000d903', 'k3',
        now() - interval '1 hour', 'sending', 1);
-- updated_at は trg_set_updated_at が now() で上書きするため、
-- 「ワーカーが掴んだまま時間が経った」状態を作るにはトリガを一時的に外す
alter table private.email_outbox disable trigger trg_set_updated_at;
update private.email_outbox set updated_at = now() - interval '1 hour' where dedupe_key = 'k3';
alter table private.email_outbox enable trigger trg_set_updated_at;
select is(pg_temp.claim(50), 1,
  'T16: sendingのまま放置された行は、猶予を過ぎたら拾い直される（通知が消えない）');
select is(
  (select attempts::int from private.email_outbox where dedupe_key = 'k3'),
  2,
  'T16: 拾い直しでも試行回数は増える（無限に再試行しない）'
);

-- 試行上限を使い切ったまま放置された行はfailedで止める
alter table private.email_outbox disable trigger trg_set_updated_at;
update private.email_outbox
   set status = 'sending', attempts = 5, last_error_code = null,
       updated_at = now() - interval '1 hour'
 where dedupe_key = 'k3';
alter table private.email_outbox enable trigger trg_set_updated_at;
select is(pg_temp.claim(50), 0, 'T16: 上限を使い切った滞留行は拾い直さない');
select is(
  (select (status::text, last_error_code)::text from private.email_outbox where dedupe_key = 'k3'),
  '(failed,worker_lost)',
  'T16: 上限を使い切った滞留行はfailedで止まり、運用が気づける'
);

-- ---- B1: 宛先が取れない行を放置しない ----
insert into private.email_outbox (kind, user_id, dedupe_key, next_attempt_at)
values ('offer_arrival', '00000000-0000-0000-0000-00000000d905', 'k4', now() - interval '1 minute');
select is(pg_temp.claim(50), 0, 'T16: 宛先が取れない行はワーカーへ渡さない');
select is(
  (select (status::text, last_error_code)::text from private.email_outbox where dedupe_key = 'k4'),
  '(failed,no_recipient_address)',
  'T16: 宛先が取れない行はfailedで止まる（永久にpendingで残らない）'
);

-- ---- B2/B3: まとめの単位は「まとめを送る日」 ----
-- 18時より後に届いた分と、翌日18時までに届いた分は同じまとめになる
select is(
  to_char(private.next_digest_time(timestamptz '2026-08-27 19:00:00+09') at time zone 'Asia/Tokyo', 'YYYY-MM-DD'),
  to_char(private.next_digest_time(timestamptz '2026-08-28 10:00:00+09') at time zone 'Asia/Tokyo', 'YYYY-MM-DD'),
  'T16: 8/27 19:00と8/28 10:00の分は同じまとめ（同じ日に2通届かない）'
);
select isnt(
  to_char(private.next_digest_time(timestamptz '2026-08-27 10:00:00+09') at time zone 'Asia/Tokyo', 'YYYY-MM-DD'),
  to_char(private.next_digest_time(timestamptz '2026-08-27 19:00:00+09') at time zone 'Asia/Tokyo', 'YYYY-MM-DD'),
  'T16: 18時をまたぐと別のまとめになる（18時以降の分が送信済みの行へ吸収されない）'
);
-- トリガ経由でも、18時をまたぐ2件が別のまとめとして積まれる（吸収されない）
insert into public.organizations (id, name, status)
values ('00000000-0000-0000-0000-00000000d9f0', 'まとめ境界テスト団体', 'verified');
select pg_temp.set_mode('00000000-0000-0000-0000-00000000d904', 'daily');
create function pg_temp.make_delivery(ev text, at_time timestamptz) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into private.offer_deliveries (
    organization_id, delivered_at, org_name, event_name, description, reason_note,
    date_text, place, event_days, frequency, fee_per_event_yen, beginner_friendly,
    intensity, target_categories, target_purposes, capacity, deadline, event_fingerprint)
  values ('00000000-0000-0000-0000-00000000d9f0', at_time, 'まとめ境界テスト団体',
    ev, '説明文', '理由', '9月13日', '場所',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
    10, '2026-09-10', ev)
  returning id into v;
  insert into private.offer_recipients (delivery_id, user_id, score, reasons, cautions)
  values (v, '00000000-0000-0000-0000-00000000d904', 90, array['理由']::text[], array[]::text[]);
  return v;
end $$;
select pg_temp.make_delivery('朝の便', timestamptz '2026-08-27 10:00:00+09');
select pg_temp.make_delivery('夜の便', timestamptz '2026-08-27 19:00:00+09');
select is(
  (select count(*)::int from private.email_outbox
    where kind = 'daily_digest' and user_id = '00000000-0000-0000-0000-00000000d904'),
  2,
  'T16: 18時をまたぐ2件は別のまとめとして積まれる（後の分が送信済みの行へ吸収されない）'
);
select is(
  (select string_agg(dedupe_key, ',' order by dedupe_key) from private.email_outbox
    where kind = 'daily_digest' and user_id = '00000000-0000-0000-0000-00000000d904'),
  '2026-08-27,2026-08-28',
  'T16: まとめの鍵は配信日ではなく「まとめを送る日」'
);

-- 件数を数える窓も同じ基準
select ok(
  private.digest_window(date '2026-08-28') @> timestamptz '2026-08-27 19:00:00+09'
  and private.digest_window(date '2026-08-28') @> timestamptz '2026-08-28 10:00:00+09'
  and not (private.digest_window(date '2026-08-28') @> timestamptz '2026-08-27 10:00:00+09'),
  'T16: 件数を数える窓は前日18時〜当日18時で、まとめの単位と一致する'
);

-- ---- backoffが実際に使われている ----
-- ここから先は「期限が来た行がちょうど1件取り出される」ことを見る。
-- 直前のまとめ検査で積んだ daily_digest は、固定日付（2026-08-27）の
-- 18時JST＝09:00 UTC が送信時刻になるため、**実時間がその時刻を過ぎると
-- due になり、claimが一緒に拾ってしまう**（このテストは2026-08-27の
-- 09:00 UTCを境に必ず落ちる時限式だった）。
-- 実時間に依存しないよう、対象外の pending 行を先送りしてから測る。
update private.email_outbox set next_attempt_at = now() + interval '1 day'
 where status = 'pending';
insert into private.email_outbox (kind, user_id, dedupe_key, next_attempt_at)
values ('offer_arrival', '00000000-0000-0000-0000-00000000d903', 'k5', now() - interval '1 minute');
-- 裸のselectはTAPが結果行をテスト行と誤読するため、必ずアサーションで包む
select is(pg_temp.claim(50), 1, 'T16: 期限が来た行が取り出される');
create temp table k5 as select id from private.email_outbox where dedupe_key = 'k5';
select is(pg_temp.complete((select id from k5), false, 'smtp_timeout'), 'ok',
  'T16: 送信失敗を記録できる');
-- 1回目の失敗は1分後。email_retry_delay(1) と一致することを固定する
-- （complete_emailがbackoffを使わず固定値にしても落ちるようにする）
select ok(
  (select next_attempt_at from private.email_outbox where dedupe_key = 'k5')
    between now() + private.email_retry_delay(1) - interval '5 seconds'
        and now() + private.email_retry_delay(1) + interval '5 seconds',
  'T16: 再試行の先送り幅はemail_retry_delay(試行回数)と一致する'
);
select is(private.email_retry_delay(1), interval '1 minute',
  'T16: 1回目の再試行は1分後（正本D041の表と一致）');

-- ---- sending以外の行は進めない ----
update private.email_outbox set status = 'sent', sent_at = now() where dedupe_key = 'k5';
select is(
  pg_temp.complete((select id from k5), false, 'smtp_timeout'),
  'outbox_not_claimed',
  'T16: 送信済みの行を失敗として再送状態へ戻せない'
);
select is(
  (select status::text from private.email_outbox where dedupe_key = 'k5'),
  'sent',
  'T16: 送信済みの行は状態が変わらない'
);

select * from finish();
rollback;
