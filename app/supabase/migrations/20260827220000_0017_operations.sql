-- Task 017: 運用・可観測性
-- 運営が「動いているか」「詰まっていないか」を1本のRPCで確認でき、
-- 監査ログが無制限に増えないようにする。
-- 個人情報は一切返さない（D029）。すべて件数と時刻だけ。
--
-- 連番は0016を飛ばして0017にする。Task 016（UX・a11y）はmigrationを持たず、
-- 連番をタスク番号と一致させたほうが追跡しやすいため。

-- ---- 1. 監査ログの保持期間 ----
-- Task 013・014で「保持期間・削除方針が未定」と残した残余リスクを閉じる。
create function private.prune_audit_logs(retain_days integer default 365)
returns table (admin_rows_deleted integer, deletion_rows_deleted integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
begin
  if retain_days is null or retain_days < 30 then
    raise exception 'invalid_retain_days';
  end if;
  v_cutoff := now() - make_interval(days => retain_days);

  with removed as (
    delete from private.admin_audit_log a where a.created_at < v_cutoff returning 1
  )
  select count(*)::integer into admin_rows_deleted from removed;

  with removed as (
    delete from private.deletion_audit_log d
     where d.occurred_on < v_cutoff::date returning 1
  )
  select count(*)::integer into deletion_rows_deleted from removed;

  return next;
end;
$$;
revoke execute on function private.prune_audit_logs(integer) from public;
revoke execute on function private.prune_audit_logs(integer) from anon;
revoke execute on function private.prune_audit_logs(integer) from authenticated;

-- ---- 2. 運用のhealth check ----
create function public.platform_health()
returns table (
  checked_at timestamptz,
  delivery_paused boolean,
  pending_organizations integer,
  outbox_pending integer,
  outbox_failed integer,
  outbox_stuck_sending integer,
  oldest_pending_overdue_minutes integer,
  quota_over_limit integer,
  stale_preview_rows integer,
  admin_audit_rows integer,
  confirmed_identities integer,
  newest_identity_at timestamptz,
  non_university_identities integer,
  orphan_identities integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    now(),
    (select c.delivery_paused from private.platform_controls c where c.id = true),
    (select count(*)::integer from public.organizations o where o.status = 'pending'),
    (select count(*)::integer from private.email_outbox e where e.status = 'pending'),
    (select count(*)::integer from private.email_outbox e where e.status = 'failed'),
    -- sendingのまま15分以上残っているのは、ワーカーが落ちたか詰まっている合図
    (select count(*)::integer from private.email_outbox e
      where e.status = 'sending' and e.updated_at < now() - interval '15 minutes'),
    -- 予定時刻（next_attempt_at）からの超過分。**負値は正常**で、
    -- まとめメールのように将来の時刻を予約している行があることを意味する。
    -- 本当に滞留した行があれば min() が拾って大きな正の値になる
    (select coalesce(
       extract(epoch from (now() - min(e.next_attempt_at))) / 60, 0)::integer
       from private.email_outbox e where e.status = 'pending'),
    -- 本来起きない。起きていれば枠の確保が壊れている。
    -- ただし **本人が後から上限を下げただけ**の正常操作を数えてはいけない
    -- （window_count は配信時にしか再計算されない観測値で、
    --   reception_weekly_limit は利用者がいつでも下げられる）。
    -- 最後の配信より後にパスポートが更新されている行は除く
    (select count(*)::integer
       from private.student_delivery_quota q
       join public.student_passports p on p.user_id = q.user_id
      where q.window_count > p.reception_weekly_limit
        and p.updated_at <= coalesce(q.last_delivered_at, q.updated_at)),
    (select count(*)::integer from private.offer_preview_cache c
      where c.first_computed_at < now() - interval '24 hours'),
    (select count(*)::integer from private.admin_audit_log),
    -- 認証側。**DB側のRPCではAuthの生存を確認できない**（Auth APIを叩けない）ので、
    -- ここで返すのは「DBから観測できる兆候」だけ。生存の確認は実際にOTPを
    -- 往復させる人間の手順で行う（docs/runbook_incident.md §2）。
    -- 件数と時刻だけで、誰が・いつログインしたかは返さない
    (select count(*)::integer from auth.users u where u.email_confirmed_at is not null),
    (select max(u.created_at) from auth.users u),
    -- ドメイン外のidentity。掃除の待ち行列であり、ドメインゲートを試されている兆候でもある
    (select count(*)::integer from auth.users u
      where not private.is_university_email(u.email)),
    -- CUEのデータを持たず作成から30日以上経ったidentity（docs/operations.md §9の待ち行列）
    (select count(*)::integer from auth.users u
      where u.created_at < now() - interval '30 days'
        and not exists (select 1 from public.student_accounts sa where sa.user_id = u.id)
        and not exists (select 1 from public.organization_memberships m where m.user_id = u.id))
$$;
revoke execute on function public.platform_health() from public;
revoke execute on function public.platform_health() from anon;
revoke execute on function public.platform_health() from authenticated;
grant execute on function public.platform_health() to service_role;

-- ---- 3. 期限切れpreviewの掃除 ----
-- 24時間で無効になるのに行が残り続ける（Task 011の設計では読み取り時に判定するため
-- 機能上は無害だが、団体ごとの条件履歴を必要以上に持ち続けない）
create function private.prune_preview_cache(retain_hours integer default 48)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if retain_hours is null or retain_hours < 24 then
    raise exception 'invalid_retain_hours';
  end if;
  with removed as (
    delete from private.offer_preview_cache c
     where c.first_computed_at < now() - make_interval(hours => retain_hours)
    returning 1
  )
  select count(*)::integer into v_deleted from removed;
  return v_deleted;
end;
$$;
revoke execute on function private.prune_preview_cache(integer) from public;
revoke execute on function private.prune_preview_cache(integer) from anon;
revoke execute on function private.prune_preview_cache(integer) from authenticated;
