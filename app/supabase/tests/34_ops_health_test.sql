-- Task 017-T1: 運用のhealth check・監査ログの保持・掃除関数（D052）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

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
-- 上のテストは grantee <> 0 でPUBLIC擬似ロールを除外している。
-- **関数のEXECUTEはPostgreSQLの既定でPUBLICへ付く**ため、それが最も起きやすい退行であり、
-- 上のテストだけでは「service_roleだけが呼べる」を検証できない
-- （PUBLICへgrantしてもgreenのまま通ることを実際に確認した）。
-- 29_admin_boundary_test.sql と同じ2本目を置く
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname = 'platform_health'
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0
           or a.grantee = 'anon'::regrole
           or a.grantee = 'authenticated'::regrole)
  ),
  0,
  'T1: platform_health にPUBLIC・anon・authenticatedのEXECUTEは無い'
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
        'outbox_failed', 'outbox_stuck_sending', 'oldest_pending_overdue_minutes',
        'quota_over_limit', 'stale_preview_rows', 'admin_audit_rows',
        'confirmed_identities', 'identities_created_last_7d', 'non_university_identities',
        'orphan_identities'],
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
-- 審査待ちの団体を1つ作る。idは後段の offer_preview_cache でも使う
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

-- ---- 値そのものを検査する ----
-- 列名を固定するだけでは、実装が全部0を返しても通ってしまう
-- （リテラル0を返す変異体が全件passすることを実際に確認したため、ここを足した）
insert into public.student_accounts (user_id)
  values ('00000000-0000-0000-0000-00000000e101') on conflict (user_id) do nothing;
insert into public.student_notification_settings (user_id, mode)
  values ('00000000-0000-0000-0000-00000000e101', 'each')
  on conflict (user_id) do update set mode = 'each';
insert into private.email_outbox (kind, user_id, dedupe_key, status, next_attempt_at, updated_at) values
  ('offer_arrival', '00000000-0000-0000-0000-00000000e101', 'h-pending', 'pending', now() - interval '30 minutes', now()),
  ('offer_arrival', '00000000-0000-0000-0000-00000000e101', 'h-failed', 'failed', now(), now()),
  -- 15分の境界: 16分前は詰まり、14分前はまだ詰まりではない
  ('offer_arrival', '00000000-0000-0000-0000-00000000e101', 'h-stuck', 'sending', now(), now() - interval '16 minutes'),
  ('offer_arrival', '00000000-0000-0000-0000-00000000e101', 'h-fresh', 'sending', now(), now() - interval '14 minutes');

select is((select outbox_pending from public.platform_health()), 1,
  'T1: 送信待ちの件数を数える');
select is((select outbox_failed from public.platform_health()), 1,
  'T1: 失敗した件数を数える');
select is((select outbox_stuck_sending from public.platform_health()), 1,
  'T1: 15分を超えてsendingのまま残っている行だけを詰まりとして数える（14分前は数えない）');
select cmp_ok((select oldest_pending_overdue_minutes from public.platform_health()), '>=', 29,
  'T1: 予定時刻からの超過分を返す（30分前が期限の行があるので29分以上）');

-- 期限が未来の行を足すと、最古はそちらになり**負値**になる（まとめメールの正常な姿）
update private.email_outbox set next_attempt_at = now() + interval '6 hours'
 where dedupe_key = 'h-pending';
select cmp_ok((select oldest_pending_overdue_minutes from public.platform_health()), '<', 0,
  'T1: 予定が未来の行しか無ければ負値になる（まとめメールがある正常な状態）');

-- quota: 本当の超過と、本人が上限を下げただけの正常操作を区別する
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit)
values ('00000000-0000-0000-0000-00000000e101',
  array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 1);
insert into private.student_delivery_quota (user_id, window_count, window_started_at, last_delivered_at, updated_at)
values ('00000000-0000-0000-0000-00000000e101', 3, now() - interval '1 day', now(), now());
select is((select quota_over_limit from public.platform_health()), 1,
  'T1: 枠の確保が壊れている状態を数える');
-- 本人が後から上限を下げただけなら、異常として数えない
-- （window_countは配信時にしか再計算されない観測値。ここを数えると
--   「学生が受信上限を下げた」だけで運営が全体停止を検討することになる）。
-- パスポートの updated_at はトリガが now() を入れ、now() はトランザクション内で
-- 一定なので、ここでは配信の時刻を過去へ動かして同じ関係を作る
update private.student_delivery_quota
   set last_delivered_at = now() - interval '1 hour'
 where user_id = '00000000-0000-0000-0000-00000000e101';
select is((select quota_over_limit from public.platform_health()), 0,
  'T1: 本人が後から上限を下げただけの正常操作は異常として数えない');

-- 期限切れpreview
insert into private.offer_preview_cache (organization_id, audience_fingerprint, band, first_computed_at)
values ((select id from eorg), repeat('a', 64), '5-9', now() - interval '25 hours');
select is((select stale_preview_rows from public.platform_health()), 1,
  'T1: 24時間を過ぎたpreviewの行を数える');
select is((select admin_audit_rows from public.platform_health()), 0,
  'T1: 運営監査の行数を数える（この時点では0件）');

-- ---- 認証側の兆候も、列名だけでなく値を検査する ----
-- 既存列と同じ理由。リテラル0を返す実装でも通ってしまってはいけない
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  -- ドメイン外（掃除の待ち行列＋ドメインゲートを試されている兆候）
  ('00000000-0000-0000-0000-00000000e201', 'demo-outside@example.com', now(), now(), now()),
  -- メール未確認（確認済みには数えない）
  ('00000000-0000-0000-0000-00000000e202', 'demo-ops-c@stu.kobe-u.ac.jp', null, now(), now()),
  -- CUEのデータを持たず、作成から30日以上（孤児）
  ('00000000-0000-0000-0000-00000000e203', 'demo-ops-d@stu.kobe-u.ac.jp', now(),
   now() - interval '40 days', now());
select is(
  (select confirmed_identities from public.platform_health()),
  (select count(*)::int from auth.users where email_confirmed_at is not null),
  'T1: 確認済みidentityの件数を数える（未確認は数えない）'
);
select cmp_ok((select identities_created_last_7d from public.platform_health()), '>=', 1,
  'T1: 直近7日の登録件数を数える（40日前の1件は含まない）');
select is((select non_university_identities from public.platform_health()), 1,
  'T1: ドメイン外のidentityを数える');
select is((select orphan_identities from public.platform_health()), 1,
  'T1: CUEのデータを持たず30日以上経ったidentityを数える');

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

select * from finish();
rollback;
