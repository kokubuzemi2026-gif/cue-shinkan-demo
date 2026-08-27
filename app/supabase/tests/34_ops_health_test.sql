-- Task 017-T1: 運用のhealth check・監査ログの保持・掃除関数（D051）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

-- ---- 権限: 運営（service_role）だけが health を見られる ----
select is(
  (
    select coalesce(string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname = 'platform_health'
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> 0 and a.grantee::regrole::text <> 'postgres'
  ),
  'service_role',
  'T1: platform_health はservice_roleだけが呼べる'
);
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'private'
      and p.proname in ('prune_audit_logs', 'prune_preview_cache')
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0
           or a.grantee = 'anon'::regrole
           or a.grantee = 'authenticated'::regrole
           or a.grantee = 'service_role'::regrole)
  ),
  0,
  'T1: 掃除関数はanon・authenticated・service_role・PUBLICから呼べない（DB管理者のみ）'
);

-- ---- 返す列にPIIが無いことを固定する ----
select set_eq(
  $$select unnest(p.proargnames)::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'platform_health'$$,
  array['checked_at', 'delivery_paused', 'pending_organizations', 'outbox_pending',
        'outbox_failed', 'outbox_stuck_sending', 'oldest_pending_age_minutes',
        'quota_over_limit', 'stale_preview_rows', 'admin_audit_rows'],
  'T1: healthが返すのは件数と時刻だけ（メール・氏名・受信者IDを返さない）'
);

-- ---- 監査ログにPIIが無いことを、列名で固定する ----
select set_eq(
  $$select column_name::text from information_schema.columns
     where table_schema = 'private' and table_name = 'admin_audit_log'$$,
  array['id', 'action', 'target_organization_id', 'target_delivery_id',
        'actor_label', 'reason', 'previous_value', 'new_value', 'created_at'],
  'T1: 運営監査ログの列は増えていない（学生を指す列が入っていない）'
);
select set_eq(
  $$select column_name::text from information_schema.columns
     where table_schema = 'private' and table_name = 'deletion_audit_log'$$,
  array['action', 'occurred_on', 'event_count', 'removed_rows', 'updated_at'],
  'T1: 削除監査ログは日次集計のまま（主体を持たない）'
);

-- ---- health の値が実際の状態を反映する ----
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000e101', 'demo-ops-a@stu.kobe-u.ac.jp', now(), now(), now());
insert into public.student_consents (user_id, consent_version)
  values ('00000000-0000-0000-0000-00000000e101', private.current_consent_version());
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}', true);
set local role authenticated;
create temp table eorg as select public.create_organization('運用テスト団体') as id;
reset role;
grant select on eorg to public;

select is(
  (select pending_organizations from public.platform_health()),
  1,
  'T1: 審査待ちの団体数が見える（運営の作業待ち件数）'
);
select is(
  (select delivery_paused from public.platform_health()),
  false,
  'T1: 既定では緊急停止していない'
);

update private.platform_controls set delivery_paused = true where id;
select is(
  (select delivery_paused from public.platform_health()),
  true,
  'T1: 緊急停止するとhealthへ出る'
);
update private.platform_controls set delivery_paused = false where id;

-- ---- 掃除: 保持期間より古い行だけを消す ----
insert into private.admin_audit_log (action, actor_label, created_at) values
  ('delivery_paused', 'ops-old', now() - interval '400 days'),
  ('delivery_resumed', 'ops-new', now() - interval '10 days');
insert into private.deletion_audit_log (action, occurred_on, event_count, removed_rows) values
  ('passport_deleted', (now() - interval '400 days')::date, 3, 3),
  ('account_deleted', (now() - interval '10 days')::date, 1, 5);

select is(
  (select admin_rows_deleted from private.prune_audit_logs(365)),
  1,
  'T1: 保持期間より古い運営監査だけが消える'
);
select is(
  (select count(*)::int from private.admin_audit_log where actor_label = 'ops-new'),
  1,
  'T1: 保持期間内の行は残る'
);
select is(
  (select count(*)::int from private.admin_audit_log where actor_label = 'ops-old'),
  0,
  'T1: 古い行は消えている'
);
select is(
  (select count(*)::int from private.deletion_audit_log where occurred_on > (now() - interval '30 days')::date),
  1,
  'T1: 削除監査も保持期間内の行は残る'
);
select throws_ok(
  $$select private.prune_audit_logs(29)$$,
  'P0001', 'invalid_retain_days',
  'T1: 30日未満の保持期間は拒否する（誤操作で監査を消させない）'
);
select throws_ok(
  $$select private.prune_audit_logs(null)$$,
  'P0001', 'invalid_retain_days',
  'T1: NULLの保持期間も拒否する'
);
select throws_ok(
  $$select private.prune_preview_cache(23)$$,
  'P0001', 'invalid_retain_hours',
  'T1: previewの掃除は24時間未満を拒否する（有効なpreviewを消させない）'
);

-- ---- 詰まりの検出 ----
select is(
  (select outbox_stuck_sending from public.platform_health()),
  0,
  'T1: 詰まりが無ければ0'
);

select * from finish();
rollback;
