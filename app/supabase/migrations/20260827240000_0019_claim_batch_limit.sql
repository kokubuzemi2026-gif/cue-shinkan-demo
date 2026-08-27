-- claim_email_batch が batch_size を超えて掴むことがある問題を直す。
--
-- 旧実装は掴む対象を `where o.id in (select ... for update skip locked limit batch_size)`
-- と **IN サブクエリ**で選んでいた。`FOR UPDATE SKIP LOCKED` + `LIMIT` を
-- サブクエリへ置くと、プランによってはサブプランが**再実行**される。
-- 本テストデータは6行を同一文で挿入するため `next_attempt_at` が全て同値で、
-- **同着の並び順が不安定**。再実行のたびに別の3件が返れば、UPDATE は最大6件に一致する。
--
-- CIで実際に観測した（batch_size=3 に対して）:
--   count=6 / sending=6 / attempts=1（どの行も二重には掴まれていない）/ もう一方のワーカー=0
-- ローカルのPostgreSQL 16では再現せず、CIのスタックでのみ出た＝プラン依存。
--
-- 対策はキュー実装の定石: **掴む行の確定を `as materialized` のCTEで1度だけ評価し**、
-- UPDATE はその結果へ join する。CTEが実体化されるため再実行が起きない。
--
-- 二重送信は旧実装でも起きていない（attempts=1）。壊れていたのは
-- 「1回の取り出しは batch_size 件まで」という契約のほう。
create or replace function public.claim_email_batch(batch_size integer)
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
  v_lease interval := interval '15 minutes';
begin
  if batch_size is null or batch_size not between 1 and 200 then
    raise exception 'invalid_batch_size';
  end if;

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

  update private.email_outbox o
     set status = 'cancelled', updated_at = v_now
   where o.kind = 'offer_arrival'
     and o.status in ('pending', 'sending')
     and exists (
       select 1
       from private.offer_deliveries d
       where d.id::text = o.dedupe_key
         and d.stopped_at is not null
     );

  update private.email_outbox o
     set status = 'failed',
         last_error_code = 'no_recipient_address',
         updated_at = v_now
   where o.status = 'pending'
     and not exists (
       select 1 from auth.users u where u.id = o.user_id and u.email is not null
     );

  update private.email_outbox o
     set status = 'failed',
         last_error_code = coalesce(o.last_error_code, 'worker_lost'),
         updated_at = v_now
   where o.status = 'sending'
     and o.updated_at < v_now - v_lease
     and o.attempts >= private.email_max_attempts();

  return query
  -- **`as materialized` を外さないこと。** これがこのmigrationの目的そのもの。
  -- 掴む行の確定を1度だけ評価し、再実行による超過取得を防ぐ
  with picked as materialized (
    select c.id
      from private.email_outbox c
      join auth.users u on u.id = c.user_id
     where (
             (c.status = 'pending' and c.next_attempt_at <= v_now)
             or (c.status = 'sending'
                 and c.updated_at < v_now - v_lease
                 and c.attempts < private.email_max_attempts())
           )
       and u.email is not null
     order by c.next_attempt_at, c.id
     for update skip locked
     limit batch_size
  ),
  claimed as (
    update private.email_outbox o
       set status = 'sending',
           attempts = o.attempts + 1,
           updated_at = v_now
      from picked p
     where o.id = p.id
    returning o.id, o.kind, o.user_id, o.dedupe_key, o.attempts
  )
  select cl.id,
         cl.kind,
         u.email::text,
         case
           when cl.kind = 'daily_digest' then (
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
