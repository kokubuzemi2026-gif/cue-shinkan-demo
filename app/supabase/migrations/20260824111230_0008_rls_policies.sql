-- Task 008 (4/4): RLS有効化・policy・テーブルgrant
-- 正本: docs/auth_and_authorization.md §7
--
-- 方針:
-- - deny by default: Task 008の新規テーブルに限り、必要な最小grantだけを明示付与する
-- - すべてのpolicyは (select public.is_university_user()) を必須条件に含める
-- - policyは内部ヘルパー関数を呼ばず、インラインEXISTSを使う
--   （membershipsの自行RLSと組み合わせても再帰しない。クライアントへ内部関数をgrantしないため）
-- - 認可根拠はauth.uid()と最新の所属テーブルのみ（JWT user_metadataは使わない）

alter table public.student_accounts enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
-- 多層防御: privateスキーマ+grantなしに加えてRLSも有効化（policyゼロ）
alter table private.organization_invitations enable row level security;

-- ---- student_accounts: 自分の行だけ（新入生権限の正本） ----
create policy student_accounts_select_own
  on public.student_accounts
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_university_user())
  );

-- 初回権限登録の唯一の書込経路（自分の行のみ・大学ユーザーのみ）
create policy student_accounts_insert_own
  on public.student_accounts
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_university_user())
  );

grant select, insert on table public.student_accounts to authenticated;

-- ---- organizations: 所属団体だけをSELECT可能。書込grantはゼロ（作成=F5・更新=F6のみ） ----
create policy organizations_select_member
  on public.organizations
  for select
  to authenticated
  using (
    (select public.is_university_user())
    and exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = organizations.id
        and m.user_id = (select auth.uid())
    )
  );

grant select on table public.organizations to authenticated;

-- ---- organization_memberships: 自分の所属行だけ（コンテキスト切替用）。 ----
-- 他メンバーの情報はorg_member_directory()（PIIなしラベル4列）経由のみ
create policy organization_memberships_select_own
  on public.organization_memberships
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_university_user())
  );

grant select on table public.organization_memberships to authenticated;

-- private.organization_invitations: policyなし・grantなし（SECURITY DEFINER RPC経由のみ）
