-- T3: anonは公開テーブルを読めない + 関数権限の全数検査
-- （全作成関数にPUBLIC/anonのEXECUTEが残っていないこと、authenticatedは公開RPCのみ）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);

-- ---- anonのテーブル権限はゼロ ----
select ok(not has_table_privilege('anon', 'public.student_accounts', 'SELECT'), 'anon: student_accounts SELECT不可');
select ok(not has_table_privilege('anon', 'public.student_accounts', 'INSERT'), 'anon: student_accounts INSERT不可');
select ok(not has_table_privilege('anon', 'public.organizations', 'SELECT'), 'anon: organizations SELECT不可');
select ok(not has_table_privilege('anon', 'public.organization_memberships', 'SELECT'), 'anon: memberships SELECT不可');
select ok(not has_table_privilege('anon', 'private.organization_invitations', 'SELECT'), 'anon: invitations SELECT不可');

-- ---- privateスキーマはanon/authenticatedともusage不可 ----
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon: privateスキーマusage不可');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated: privateスキーマusage不可');

-- ---- anonの関数権限はゼロ ----
select ok(not has_function_privilege('anon', 'public.is_university_user()', 'EXECUTE'), 'anon: is_university_user実行不可');
select ok(not has_function_privilege('anon', 'public.create_organization(text, text)', 'EXECUTE'), 'anon: create_organization実行不可');
select ok(not has_function_privilege('anon', 'public.accept_invitation(text)', 'EXECUTE'), 'anon: accept_invitation実行不可');

-- ---- auth.usersはanon/authenticatedから読めない（Supabase既定の維持を確認） ----
select ok(not has_table_privilege('anon', 'auth.users', 'SELECT'), 'anon: auth.users SELECT不可');

-- ---- 実際のアクセス試行（anonロール） ----
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  'select count(*) from public.student_accounts',
  '42501', null,
  'anon: student_accountsへのSELECT試行はpermission denied'
);
select throws_ok(
  $$select public.create_organization('テスト団体')$$,
  '42501', null,
  'anon: create_organization呼出はpermission denied'
);
reset role;

-- ---- Task 008作成の全関数にPUBLIC/anonのEXECUTEが1件も無い（カタログ走査） ----
-- proaclがnullの関数はPostgreSQL既定でPUBLIC実行可のため、acldefaultで展開して不合格にする
select is_empty(
  $$
  select p.proname::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('public', 'private')
    and p.proname in (
      'is_university_email', 'is_university_user',
      'is_org_member', 'org_role_at_least', 'generate_member_label',
      'set_updated_at', 'protect_last_owner',
      'create_organization', 'update_organization_profile',
      'create_invitation', 'revoke_invitation', 'list_invitations',
      'preview_invitation', 'accept_invitation', 'org_member_directory'
    )
    and a.privilege_type = 'EXECUTE'
    and (a.grantee = 0 or a.grantee = 'anon'::regrole)
  $$,
  'Task 008の全関数にPUBLIC/anonのEXECUTE残存なし'
);

-- ---- authenticatedのEXECUTEは公開RPC（F2・F5〜F12）だけ ----
select results_eq(
  $$
  select distinct p.proname::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('public', 'private')
    and p.proname in (
      'is_university_email', 'is_university_user',
      'is_org_member', 'org_role_at_least', 'generate_member_label',
      'set_updated_at', 'protect_last_owner',
      'create_organization', 'update_organization_profile',
      'create_invitation', 'revoke_invitation', 'list_invitations',
      'preview_invitation', 'accept_invitation', 'org_member_directory'
    )
    and a.privilege_type = 'EXECUTE'
    and a.grantee = 'authenticated'::regrole
  order by 1
  $$,
  array[
    'accept_invitation', 'create_invitation', 'create_organization',
    'is_university_user', 'list_invitations', 'org_member_directory',
    'preview_invitation', 'revoke_invitation', 'update_organization_profile'
  ],
  'authenticatedのEXECUTEは公開RPCの9関数に限定'
);

-- ---- authenticatedのテーブル権限は最小限 ----
select ok(has_table_privilege('authenticated', 'public.student_accounts', 'SELECT'), 'authenticated: student_accounts SELECT可');
select ok(has_table_privilege('authenticated', 'public.student_accounts', 'INSERT'), 'authenticated: student_accounts INSERT可');
select ok(not has_table_privilege('authenticated', 'public.student_accounts', 'UPDATE'), 'authenticated: student_accounts UPDATE不可');
select ok(not has_table_privilege('authenticated', 'public.student_accounts', 'DELETE'), 'authenticated: student_accounts DELETE不可');
select ok(has_table_privilege('authenticated', 'public.organizations', 'SELECT'), 'authenticated: organizations SELECT可');
select ok(not has_table_privilege('authenticated', 'public.organizations', 'INSERT'), 'authenticated: organizations INSERT不可');
select ok(not has_table_privilege('authenticated', 'public.organizations', 'UPDATE'), 'authenticated: organizations UPDATE不可（更新はRPCのみ）');
select ok(not has_table_privilege('authenticated', 'public.organizations', 'DELETE'), 'authenticated: organizations DELETE不可');
select ok(has_table_privilege('authenticated', 'public.organization_memberships', 'SELECT'), 'authenticated: memberships SELECT可');
select ok(not has_table_privilege('authenticated', 'public.organization_memberships', 'INSERT'), 'authenticated: memberships INSERT不可');
select ok(not has_table_privilege('authenticated', 'public.organization_memberships', 'UPDATE'), 'authenticated: memberships UPDATE不可');
select ok(not has_table_privilege('authenticated', 'public.organization_memberships', 'DELETE'), 'authenticated: memberships DELETE不可');
select ok(not has_table_privilege('authenticated', 'private.organization_invitations', 'SELECT'), 'authenticated: invitations SELECT不可');

select * from finish();
rollback;
