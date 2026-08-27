-- Task 010 (1/3): メール通知の設定とoutbox
-- 正本: docs/notifications.md / docs/decisions.md D040〜D042 /
--       docs/auth_and_authorization.md §9（PII・secretの絶対条件）
--
-- 方針:
-- - 通知設定は学生本人だけが読み書きできる（書込はRPCのみ）
-- - outboxは**宛先メールアドレスも本文も保存しない**。宛先は送信時にauth.usersから引き、
--   本文はテンプレートIDと最小の変数から組み立てる（D029: メールをauth.users以外へコピーしない）
-- - 同じ通知が二重に積まれないよう (kind, user_id, dedupe_key) に一意制約を置く
-- - 送信そのものは配信トランザクションの外で行うため、SMTP障害が配信をrollbackさせない

-- ---- 通知設定（D040） ----
create type public.notification_mode as enum ('each', 'daily', 'off');
comment on type public.notification_mode is
  'each=オファーごとに通知 / daily=1日1回のまとめ / off=通知しない';

-- パスポートとは別テーブルにする。パスポートを削除しても通知設定は本人の管理下に残る
-- （Task 014のデータ削除で、どちらをいつ消すかを独立に決められるようにする）
create table public.student_notification_settings (
  user_id uuid primary key references public.student_accounts (user_id) on delete cascade,
  mode public.notification_mode not null default 'each',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.student_notification_settings is
  'メール通知の受け取り方。行が無い場合の既定はeach（オファーごと）';
alter table public.student_notification_settings enable row level security;
revoke all on table public.student_notification_settings from anon;
revoke all on table public.student_notification_settings from authenticated;
grant select on table public.student_notification_settings to authenticated;

create policy student_notification_settings_select_own
  on public.student_notification_settings
  for select
  to authenticated
  using (
    (select public.is_university_user())
    and user_id = (select auth.uid())
  );

create trigger trg_set_updated_at
  before update on public.student_notification_settings
  for each row execute function private.set_updated_at();

-- ---- 送信outbox（D041） ----
create type public.email_kind as enum ('offer_arrival', 'daily_digest');
-- cancelled = 本人が通知を止めた／受け取り方を変えたため送らないことにした行。
-- failed（送信を試みて駄目だった）とは区別する
create type public.email_status as enum ('pending', 'sending', 'sent', 'failed', 'cancelled');

create table private.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind public.email_kind not null,
  user_id uuid not null references public.student_accounts (user_id) on delete cascade,
  -- 二重送信防止の鍵。offer_arrivalは配信ID、daily_digestは**まとめを送る日**（Asia/Tokyo）。
  -- 配信日にすると、18時の送信後に届いたオファーが送信済みの行へ吸収されて
  -- 二度と通知されない（まとめの送信日なら、18時以降の分は翌日の行になる）
  dedupe_key text not null
    constraint email_outbox_dedupe_key_length check (char_length(dedupe_key) between 1 and 100),
  status public.email_status not null default 'pending',
  attempts smallint not null default 0
    constraint email_outbox_attempts_range check (attempts between 0 and 100),
  -- この時刻以降に送信を試みる。daily_digestは当日の配信時刻、再試行はbackoff後の時刻
  next_attempt_at timestamptz not null default now(),
  -- 失敗理由は**短いコードのみ**。SMTPの生メッセージ・宛先・本文を残さない
  last_error_code text
    constraint email_outbox_error_code_length check (last_error_code is null or char_length(last_error_code) <= 40),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_outbox_dedupe unique (kind, user_id, dedupe_key)
);
comment on table private.email_outbox is
  '送信予定・結果のみを持つoutbox。宛先メールアドレスと本文は保存しない（D029・D041）';
create index email_outbox_due_idx
  on private.email_outbox (next_attempt_at)
  where status = 'pending';
alter table private.email_outbox enable row level security;
revoke all on table private.email_outbox from anon;
revoke all on table private.email_outbox from authenticated;

create trigger trg_set_updated_at
  before update on private.email_outbox
  for each row execute function private.set_updated_at();

-- ---- 再試行のbackoff（D041）: 指数バックオフ。上限を超えたらfailedにする ----
create function private.email_retry_delay(attempt_count integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  -- 1回目=1分 / 2回目=5分 / 3回目=25分 / 4回目=125分 / 5回目=625分（約10時間）。
  -- 引数は「これまでの試行回数」。1回目の失敗（attempt_count=1）で1分後に再試行する
  select (power(5, least(greatest(attempt_count, 1), 5) - 1)::integer || ' minutes')::interval
$$;
revoke execute on function private.email_retry_delay(integer) from public;
revoke execute on function private.email_retry_delay(integer) from anon;
revoke execute on function private.email_retry_delay(integer) from authenticated;

create function private.email_max_attempts()
returns integer
language sql
immutable
set search_path = ''
as $$ select 5 $$;
revoke execute on function private.email_max_attempts() from public;
revoke execute on function private.email_max_attempts() from anon;
revoke execute on function private.email_max_attempts() from authenticated;

-- ---- daily digestの送信時刻（D040）: Asia/Tokyoの18時 ----
create function private.next_digest_time(at_time timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when (at_time at time zone 'Asia/Tokyo')::time < time '18:00'
      then ((at_time at time zone 'Asia/Tokyo')::date + time '18:00') at time zone 'Asia/Tokyo'
    else (((at_time at time zone 'Asia/Tokyo')::date + 1) + time '18:00') at time zone 'Asia/Tokyo'
  end
$$;
comment on function private.next_digest_time(timestamptz) is
  '1日1回のまとめの送信時刻（Asia/Tokyo 18:00）。18時を過ぎた分は翌日にまとめる';

-- まとめの対象窓: 送信日Dのまとめは「前日18:00 < delivered_at <= 当日18:00」を数える。
-- dedupe_keyと同じ基準にして、数える範囲と積む単位をずらさない
create function private.digest_window(digest_date date)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(
    ((digest_date - 1) + time '18:00') at time zone 'Asia/Tokyo',
    (digest_date + time '18:00') at time zone 'Asia/Tokyo',
    '(]'
  )
$$;
revoke execute on function private.digest_window(date) from public;
revoke execute on function private.digest_window(date) from anon;
revoke execute on function private.digest_window(date) from authenticated;
revoke execute on function private.next_digest_time(timestamptz) from public;
revoke execute on function private.next_digest_time(timestamptz) from anon;
revoke execute on function private.next_digest_time(timestamptz) from authenticated;

-- ---- 配信時にoutboxへ積む（D041） ----
-- offer_recipientsへの挿入をトリガにする。send_offerを書き換えないため、
-- Task 011で確定した送信の判定・原子性・並行制御に手を入れずに済む。
-- 同一トランザクション内で積むので、送信が後段で失敗（5人未満など）すれば
-- outboxも一緒にrollbackされる。メール送信そのものはここでは行わないため、
-- SMTP障害が配信トランザクションを壊すことはない
create function private.enqueue_offer_notifications()
returns trigger
language plpgsql
volatile
-- security definer は付けない。呼び出し元（send_offer）が既にSECURITY DEFINERで、
-- 付けると将来offer_recipientsへ他ロールのINSERT権限が付いたときにfail-openになる
set search_path = ''
as $$
begin
  -- offer_arrival: オファーごとに通知する学生へ1件ずつ
  insert into private.email_outbox (kind, user_id, dedupe_key, next_attempt_at)
  select 'offer_arrival', r.user_id, r.delivery_id::text, d.delivered_at
  from inserted r
  join private.offer_deliveries d on d.id = r.delivery_id
  left join public.student_notification_settings s on s.user_id = r.user_id
  where coalesce(s.mode, 'each'::public.notification_mode) = 'each'
  on conflict (kind, user_id, dedupe_key) do nothing;

  -- daily_digest: まとめは「その日の初回オファー」で1行だけ作る。
  -- 以後の配信は同じ(user_id, 日付)へ吸収され、二重には積まれない
  insert into private.email_outbox (kind, user_id, dedupe_key, next_attempt_at)
  select 'daily_digest', r.user_id,
         to_char(private.next_digest_time(d.delivered_at) at time zone 'Asia/Tokyo', 'YYYY-MM-DD'),
         private.next_digest_time(d.delivered_at)
  from inserted r
  join private.offer_deliveries d on d.id = r.delivery_id
  left join public.student_notification_settings s on s.user_id = r.user_id
  where coalesce(s.mode, 'each'::public.notification_mode) = 'daily'
  on conflict (kind, user_id, dedupe_key) do nothing;

  return null;
end;
$$;
comment on function private.enqueue_offer_notifications() is
  '配信の受信者へ通知を積むトリガ関数。offはそもそも積まない。二重積みは一意制約で防ぐ（D041）';
revoke execute on function private.enqueue_offer_notifications() from public;
revoke execute on function private.enqueue_offer_notifications() from anon;
revoke execute on function private.enqueue_offer_notifications() from authenticated;

-- 文レベルのトリガ（遷移テーブル）にして、1回の配信で1文にまとめて積む
create trigger trg_enqueue_offer_notifications
  after insert on private.offer_recipients
  referencing new table as inserted
  for each statement
  execute function private.enqueue_offer_notifications();
