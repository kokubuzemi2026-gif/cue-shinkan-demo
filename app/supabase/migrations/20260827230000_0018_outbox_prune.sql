-- Task 019: 送信済み・失敗・取消のoutbox行を剪定する（D053）。
-- Task 010が「古いoutbox行の削除経路が無い（Task 017へ引き継ぐ）」と残した項目。
--
-- **pending / sending は絶対に消さない**（送信待ちを消すと通知が届かなくなる）。
-- 終わった行だけを、十分に古くなってから消す。
--
-- 二重送信にならない根拠:
--   offer_arrival の dedupe_key は配信ID。積むのは
--   `after insert on private.offer_recipients` の文レベルトリガだけで、
--   受信者行は配信時に1度しか入らない。過去の配信で再び積まれることはない。
--   daily_digest の dedupe_key は「まとめを送る日」。過去の日付の行が
--   新たに積まれることはない。
create function private.prune_email_outbox(retain_days integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if retain_days is null or retain_days < 7 then
    raise exception 'invalid_retain_days';
  end if;
  with removed as (
    delete from private.email_outbox e
     where e.status in ('sent', 'failed', 'cancelled')
       and e.updated_at < now() - make_interval(days => retain_days)
    returning 1
  )
  select count(*)::integer into v_deleted from removed;
  return v_deleted;
end;
$$;
revoke execute on function private.prune_email_outbox(integer) from public;
revoke execute on function private.prune_email_outbox(integer) from anon;
revoke execute on function private.prune_email_outbox(integer) from authenticated;
