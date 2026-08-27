-- Task 014-T3: 団体からの脱退と最終ownerガード（D048）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000c001', 'demo-lv-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000c002', 'demo-lv-owner2@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000c003', 'demo-lv-member@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000c004', 'demo-lv-outsider@stu.kobe-u.ac.jp', now(), now(), now());

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
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
select throws_ok(
  $$select public.delete_my_account()$$,
  'P0001', 'last_owner',
  'T3: 最後のownerである間はアカウントも削除できない'
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

-- ---- 監査記録（団体は記録し、学生は平文で残さない） ----
select is(
  (select count(*)::int from private.deletion_audit_log where action = 'membership_left'),
  3,
  'T3: 脱退が3件記録される'
);
select is(
  (select count(distinct organization_id)::int from private.deletion_audit_log
    where action = 'membership_left'),
  1,
  'T3: どの団体から抜けたかは記録される（団体IDは学生個人を指さない）'
);
select is(
  (select count(*)::int from private.deletion_audit_log d
    where d.subject_hash !~ '^[0-9a-f]{64}$'),
  0,
  'T3: 記録の主体は必ず一方向ハッシュ'
);

-- ---- 運営RPC: CUEのデータが残っている間はauth identityを消せない ----
set local role service_role;
select throws_ok(
  $$select public.admin_delete_auth_identity(
      '00000000-0000-0000-0000-00000000c002'::uuid, 'ops-1')$$,
  'P0001', 'account_data_remains',
  'T3: 所属が残っている利用者のauth identityは消せない（順序を守らせる）'
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

select * from finish();
rollback;
