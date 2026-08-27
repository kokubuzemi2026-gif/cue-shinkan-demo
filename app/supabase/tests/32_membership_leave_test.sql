-- Task 014-T3: 団体からの脱退と最終ownerガード（D048）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000c001', 'demo-lv-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000c002', 'demo-lv-owner2@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000c003', 'demo-lv-member@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000c004', 'demo-lv-outsider@stu.kobe-u.ac.jp', now(), now(), now());

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
set local role authenticated;
create temp table lorg as select public.create_organization('脱退テスト団体') as id;
reset role;
grant select on lorg to public;

-- 2人目（owner）と3人目（member）を直接入れる（招待の検証はTask 008の07で済んでいる）
insert into public.organization_memberships (organization_id, user_id, role, member_label)
values ((select id from lorg), '00000000-0000-0000-0000-00000000c002', 'owner', '担当A'),
       ((select id from lorg), '00000000-0000-0000-0000-00000000c003', 'member', '担当B');

-- ---- memberは脱退できる ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.leave_organization((select id from lorg))$$,
  'T3: memberは団体から脱退できる'
);
select throws_ok(
  $$select public.leave_organization((select id from lorg))$$,
  'P0001', 'not_member',
  'T3: 脱退後にもう一度呼ぶと not_member（黙って成功しない）'
);
reset role;
select is(
  (select count(*)::int from public.organization_memberships
    where organization_id = (select id from lorg)),
  2,
  'T3: 所属は2人になっている'
);

-- ---- ownerが2人いる間は脱退できる ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.leave_organization((select id from lorg))$$,
  'T3: ownerが他にもいれば脱退できる'
);
reset role;

-- ---- 最後のownerは脱退できない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.leave_organization((select id from lorg))$$,
  'P0001', 'last_owner',
  'T3: 最後のownerは脱退できない'
);
reset role;
-- H-1: 最後のownerでも、新入生としてのデータは消せなければならない。
-- 当初は所属の削除で巻き戻り、学生側のデータも1件も消えなかった
-- （団体を1人で作った担当者は全員この状態になり、退会経路が塞がっていた）
insert into public.student_accounts (user_id) values ('00000000-0000-0000-0000-00000000c001')
  on conflict do nothing;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit)
values ('00000000-0000-0000-0000-00000000c001',
  array['photo']::public.interest_category[], array['creation']::public.purpose[],
  'relaxed', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['photo']::public.interest_category[], 3)
  on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
-- lives_ok で包む: 失敗したときにトランザクションごと落として
-- 「plan数の不一致」で終わるのではなく、not ok として読めるようにする
select lives_ok(
  $$create temp table del_result as select * from public.delete_my_account()$$,
  'T3: 最後のownerでも削除できる（団体の事情で巻き戻らない）'
);
select is(
  (select blocking_organizations from del_result),
  1,
  'T3: 外せなかった団体の数が返る'
);
reset role;
select is(
  (select count(*)::int from public.student_passports
    where user_id = '00000000-0000-0000-0000-00000000c001'),
  0,
  'T3: 学生側のデータは消える（団体の事情で巻き戻らない）'
);
select is(
  (select count(*)::int from public.organization_memberships
    where user_id = '00000000-0000-0000-0000-00000000c001'),
  1,
  'T3: 管理者不在にしないため、最後のownerの所属だけは残る'
);
reset role;
select is(
  (select count(*)::int from public.organization_memberships
    where organization_id = (select id from lorg)),
  1,
  'T3: 拒否されたので所属は残っている'
);
select is(
  (select count(*)::int from public.organizations where id = (select id from lorg)),
  1,
  'T3: 団体そのものも残っている（Task 014のOut of scope）'
);

-- ---- 構造でも守られている: RPCを通さない直接deleteでも止まる ----
-- leave_organization の事前チェックは分かりやすさのためで、実効的な保証は
-- protect_last_owner トリガが持つ。RPCの判定だけに頼っていないことを確かめる
select throws_ok(
  $$delete from public.organization_memberships
     where organization_id = (select id from lorg)
       and user_id = '00000000-0000-0000-0000-00000000c001'$$,
  'P0001', 'last_owner',
  'T3: RPCを通さない直接deleteでも最後のownerは外れない（構造で止める）'
);
select throws_ok(
  $$update public.organization_memberships set role = 'member'
     where organization_id = (select id from lorg)
       and user_id = '00000000-0000-0000-0000-00000000c001'$$,
  'P0001', 'last_owner',
  'T3: 最後のownerをmemberへ降格することもできない'
);

-- ---- 非メンバーは脱退できない（他団体への操作にならない） ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.leave_organization((select id from lorg))$$,
  'P0001', 'not_member',
  'T3: 非メンバーは脱退RPCで他団体へ触れない'
);
select throws_ok(
  $$select public.leave_organization('00000000-0000-0000-0000-0000000ccccc')$$,
  'P0001', 'not_member',
  'T3: 存在しない団体でも not_member（存在の有無を漏らさない）'
);
reset role;

-- ---- ownerを交代すれば脱退できる ----
insert into public.organization_memberships (organization_id, user_id, role, member_label)
values ((select id from lorg), '00000000-0000-0000-0000-00000000c002', 'owner', '担当A2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.leave_organization((select id from lorg))$$,
  'T3: 交代後は元のownerも脱退できる'
);
reset role;

-- ---- 脱退で配信snapshotは壊れない（D023） ----
select is(
  (select count(*)::int from public.organization_memberships
    where organization_id = (select id from lorg)),
  1,
  'T3: 新しいownerだけが残る'
);

-- ---- 監査記録（主体を持たない日次集計） ----
select is(
  (select event_count from private.deletion_audit_log where action = 'membership_left'),
  3,
  'T3: 脱退が3件として記録される'
);
select is(
  (select count(*)::int from private.deletion_audit_log where action = 'membership_left'),
  1,
  'T3: 同じ日の脱退は1行へ畳まれる（無制限に積み上がらない）'
);

-- ---- M-4: 最終ownerガードが唯一の防御なので ENABLE ALWAYS にする ----
-- 既定のENABLEだと session_replication_role='replica'（レプリカのapply・
-- data-only restore・PITR復元）で不発になる
select is(
  (select t.tgenabled::text from pg_trigger t where t.tgname = 'trg_protect_last_owner'),
  'A',
  'T3: 最終ownerガードのトリガは ENABLE ALWAYS'
);

-- ---- 運営RPC: CUEのデータが残っている間はauth identityを消せない ----
set local role service_role;
select throws_ok(
  $$select public.admin_delete_auth_identity(
      '00000000-0000-0000-0000-00000000c002'::uuid, 'ops-1')$$,
  'P0001', 'account_data_remains',
  'T3: 所属が残っている利用者のauth identityは消せない（順序を守らせる）'
);
select throws_ok(
  $$select public.admin_delete_auth_identity(
      '00000000-0000-0000-0000-0000000cffff'::uuid, 'ops-1')$$,
  'P0001', 'identity_not_found',
  'T3: 存在しないIDの削除は identity_not_found（黙って成功して監査行だけ増えない）'
);
select lives_ok(
  $$select public.admin_delete_auth_identity(
      '00000000-0000-0000-0000-00000000c004'::uuid, 'ops-1')$$,
  'T3: CUEのデータが無い利用者のauth identityは消せる'
);
reset role;
select is(
  (select count(*)::int from auth.users where id = '00000000-0000-0000-0000-00000000c004'),
  0,
  'T3: auth identityが消えている'
);

-- ---- N7: 新規RPCの権限を固定する（将来 anon へgrantが紛れ込んだら落ちる） ----
select is(
  (
    select coalesce(string_agg(
      p.proname || '=' || a.grantee::regrole::text, ',' order by p.proname, a.grantee::regrole::text), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and p.proname in ('delete_student_passport', 'delete_my_account',
                        'leave_organization', 'admin_delete_auth_identity')
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> 0
      and a.grantee::regrole::text <> 'postgres'
  ),
  'admin_delete_auth_identity=service_role,delete_my_account=authenticated,'
    || 'delete_student_passport=authenticated,leave_organization=authenticated',
  'T3: 削除RPCのEXECUTEは本人向け3本がauthenticated、運営1本がservice_roleだけ'
);
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname in ('public', 'private')
      and p.proname in ('delete_student_passport', 'delete_my_account', 'leave_organization',
                        'admin_delete_auth_identity', 'record_deletion')
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee = 'anon'::regrole)
  ),
  0,
  'T3: PUBLIC・anon への EXECUTE は1件も無い'
);

select * from finish();
rollback;
