-- Task 010 (2/3): 通知設定のRPCと、送信ワーカー向けのRPC
-- 正本: docs/notifications.md / docs/decisions.md D040〜D042
--
-- 権限の分離:
-- - 学生向け（save_notification_settings）は authenticated へgrant
-- - 送信ワーカー向け（claim_email_batch / complete_email）は **service_role のみ**。
--   authenticated・anonへは一切grantしない
-- - claim_email_batch は宛先メールを返す唯一の経路。メールは`auth.users`から
--   その場で引き、どのテーブルへもコピーしない（D029）

-- ---- F21: 通知設定の保存（学生本人のみ） ----
create function public.save_notification_settings(new_mode public.notification_mode)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_current_student() then
    raise exception 'not_student';
  end if;
  if new_mode is null then
    raise exception 'invalid_notification_mode';
  end if;

  insert into public.student_notification_settings as s (user_id, mode)
  values ((select auth.uid()), new_mode)
  on conflict (user_id) do update set mode = excluded.mode;

  -- 「いつでも停止できる」ためには、これから送られる分も止まらなければならない。
  -- 設定変更の時点で、新しい受け取り方に合わない未送信分を取り消す。
  -- （送信時にも claim_email_batch が現在の設定を再確認する。二段構え）
  update private.email_outbox o
     set status = 'cancelled', updated_at = now()
   where o.user_id = (select auth.uid())
     and o.status = 'pending'
     and (
       new_mode = 'off'
       or (new_mode = 'each' and o.kind = 'daily_digest')
       or (new_mode = 'daily' and o.kind = 'offer_arrival')
     );
end;
$$;
revoke execute on function public.save_notification_settings(public.notification_mode) from public;
revoke execute on function public.save_notification_settings(public.notification_mode) from anon;
grant execute on function public.save_notification_settings(public.notification_mode) to authenticated;

-- ---- F22: 送信待ちの取り出し（送信ワーカー専用） ----
-- 期限が来たpendingを取り出し、sendingへ進めて試行回数を1つ上げる。
-- FOR UPDATE SKIP LOCKED で、ワーカーが複数並んでも同じ行を二重に掴まない。
-- 戻り値には宛先メールと件数だけを含め、オファー内容・団体名・学生の希望条件は含めない
create function public.claim_email_batch(batch_size integer)
returns table (
  outbox_id uuid,
  kind public.email_kind,
  recipient_email text,
  offer_count integer,
  attempt integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  -- ワーカーが落ちたまま放置された行を回収するまでの猶予
  v_lease interval := interval '15 minutes';
begin
  if batch_size is null or batch_size not between 1 and 200 then
    raise exception 'invalid_batch_size';
  end if;

  -- 1. 現在の設定に合わない未送信分を取り消す。
  --    設定はenqueue時に一度読むだけでは足りない（積まれてから送信までに
  --    最大で約18時間あり、その間に本人が停止しても送られてしまう）。
  --    **送信時が権威ある関門**で、enqueue時の判定は先出しの最適化にすぎない
  update private.email_outbox o
     set status = 'cancelled', updated_at = v_now
    from public.student_accounts sa
    left join public.student_notification_settings s on s.user_id = sa.user_id
   where o.user_id = sa.user_id
     and o.status in ('pending', 'sending')
     and (
       coalesce(s.mode, 'each'::public.notification_mode) = 'off'
       or (coalesce(s.mode, 'each'::public.notification_mode) = 'each'
           and o.kind = 'daily_digest')
       or (coalesce(s.mode, 'each'::public.notification_mode) = 'daily'
           and o.kind = 'offer_arrival')
     );

  -- 2. 宛先が取れない行は送りようが無いので止める。
  --    除外するだけだと永久にpendingで残り、運用が気づけない
  update private.email_outbox o
     set status = 'failed',
         last_error_code = 'no_recipient_address',
         updated_at = v_now
   where o.status = 'pending'
     and not exists (
       select 1 from auth.users u where u.id = o.user_id and u.email is not null
     );

  -- 3. ワーカーが落ちたまま試行上限を使い切った行を止める（無限に滞留させない）
  update private.email_outbox o
     set status = 'failed',
         last_error_code = coalesce(o.last_error_code, 'worker_lost'),
         updated_at = v_now
   where o.status = 'sending'
     and o.updated_at < v_now - v_lease
     and o.attempts >= private.email_max_attempts();

  return query
  with claimed as (
    update private.email_outbox o
       set status = 'sending',
           attempts = o.attempts + 1,
           updated_at = v_now
     where o.id in (
       select c.id
       from private.email_outbox c
       join auth.users u on u.id = c.user_id
       where (
               (c.status = 'pending' and c.next_attempt_at <= v_now)
               -- 4. ワーカーが落ちて sending のまま残った行を拾い直す。
               --    これが無いと、その学生には二度と通知が届かない
               or (c.status = 'sending'
                   and c.updated_at < v_now - v_lease
                   and c.attempts < private.email_max_attempts())
             )
         -- 宛先が無い行をここで除く。外側で除くと、掴んだのに返らず永久に滞留する
         and u.email is not null
       order by c.next_attempt_at
       for update skip locked
       limit batch_size
     )
    returning o.id, o.kind, o.user_id, o.dedupe_key, o.attempts
  )
  select cl.id,
         cl.kind,
         -- auth.users.email は Supabase では varchar(255)。戻り値の型（text）へ明示castする
         -- （castが無いと "structure of query does not match function result type" になる）
         u.email::text,
         case
           when cl.kind = 'daily_digest' then (
             -- まとめ: その日に届いた件数だけを返す（どの団体かは返さない）。
             -- 窓はdedupe_key（まとめの送信日）と同じ基準にそろえる
             select count(*)::integer
             from private.offer_recipients r
             join private.offer_deliveries d on d.id = r.delivery_id
             where r.user_id = cl.user_id
               and private.digest_window(cl.dedupe_key::date) @> d.delivered_at
           )
           else 1
         end,
         cl.attempts::integer
    from claimed cl
    join auth.users u on u.id = cl.user_id;
end;
$$;
comment on function public.claim_email_batch(integer) is
  '送信ワーカーが送信待ちを取り出す。宛先メールを返す唯一の経路で、service_role専用（D042）';
revoke execute on function public.claim_email_batch(integer) from public;
revoke execute on function public.claim_email_batch(integer) from anon;
revoke execute on function public.claim_email_batch(integer) from authenticated;
grant execute on function public.claim_email_batch(integer) to service_role;

-- ---- F23: 送信結果の記録（送信ワーカー専用） ----
-- 成功ならsent、失敗ならbackoffしてpendingへ戻す。上限を超えたらfailedで止める。
-- error_codeは短いコードのみ（SMTPの生メッセージ・宛先・本文は保存しない）
create function public.complete_email(
  outbox_id uuid,
  succeeded boolean,
  error_code text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_attempts smallint;
  v_code text := left(coalesce(complete_email.error_code, ''), 40);
begin
  -- sending の行だけを進める。sent / cancelled / failed を再送状態へ戻さない
  select o.attempts into v_attempts
    from private.email_outbox o
   where o.id = complete_email.outbox_id
     and o.status = 'sending'
     for update;
  if v_attempts is null then
    raise exception 'outbox_not_claimed';
  end if;

  if complete_email.succeeded is true then
    update private.email_outbox o
       set status = 'sent', sent_at = v_now, last_error_code = null, updated_at = v_now
     where o.id = complete_email.outbox_id;
  elsif v_attempts >= private.email_max_attempts() then
    update private.email_outbox o
       set status = 'failed',
           last_error_code = nullif(v_code, ''),
           updated_at = v_now
     where o.id = complete_email.outbox_id;
  else
    update private.email_outbox o
       set status = 'pending',
           next_attempt_at = v_now + private.email_retry_delay(v_attempts),
           last_error_code = nullif(v_code, ''),
           updated_at = v_now
     where o.id = complete_email.outbox_id;
  end if;
end;
$$;
comment on function public.complete_email(uuid, boolean, text) is
  '送信結果の記録。失敗は指数バックオフで再試行し、上限超過でfailed（D041）。service_role専用';
revoke execute on function public.complete_email(uuid, boolean, text) from public;
revoke execute on function public.complete_email(uuid, boolean, text) from anon;
revoke execute on function public.complete_email(uuid, boolean, text) from authenticated;
grant execute on function public.complete_email(uuid, boolean, text) to service_role;

-- ---- F24: 運用の健全性確認（送信ワーカー・運営専用） ----
-- 件数だけを返す。個人・宛先・本文は返さない
create function public.email_outbox_health()
returns table (
  pending_count integer,
  sending_count integer,
  failed_count integer,
  cancelled_count integer,
  oldest_pending_at timestamptz,
  oldest_sending_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where status = 'pending')::integer,
         count(*) filter (where status = 'sending')::integer,
         count(*) filter (where status = 'failed')::integer,
         count(*) filter (where status = 'cancelled')::integer,
         min(next_attempt_at) filter (where status = 'pending'),
         -- sendingが古いまま残っていれば、ワーカーが落ちたか詰まっている合図
         min(updated_at) filter (where status = 'sending')
  from private.email_outbox
$$;
revoke execute on function public.email_outbox_health() from public;
revoke execute on function public.email_outbox_health() from anon;
revoke execute on function public.email_outbox_health() from authenticated;
grant execute on function public.email_outbox_health() to service_role;
