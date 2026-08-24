-- Task 008 (1/4): スキーマ・enum・テーブル・trigger
-- 正本: docs/auth_and_authorization.md / docs/decisions.md D026-D031
--
-- 方針:
-- - 非公開データ（招待）と内部関数はprivateスキーマへ置き、Data APIへ公開しない
-- - grant/revokeはTask 008で新規作成するオブジェクトだけをスキーマ修飾で明示指定する
--   （広範囲のrevoke・alter default privilegesは使わない）
-- - メール等のPIIはauth.users以外に保存しない（テーブルにPII列を定義しない）

-- gen_random_bytes / digest（招待トークン用）。Supabaseでは既定で有効だが明示する
create extension if not exists pgcrypto with schema extensions;

-- ---- privateスキーマ（Data API非公開・クライアント到達不能） ----
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

-- ---- enum（クライアント公開RPCの引数・戻り値と生成型に現れるためpublicへ置く） ----
create type public.org_role as enum ('owner', 'admin', 'member');
create type public.org_status as enum ('pending', 'verified', 'suspended');

-- ---- 新入生権限の正本: 行の存在＝新入生権限。PII列は持たない ----
create table public.student_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.student_accounts is
  '新入生権限の正本。行の存在だけが権限を意味する。氏名・学籍番号・メールは保持しない（メールはauth.usersのみ）';
revoke all on table public.student_accounts from anon;
revoke all on table public.student_accounts from authenticated;

-- ---- 団体（共有アカウントではなく、複数担当者が所属する組織） ----
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint organizations_name_length check (char_length(btrim(name)) between 1 and 100),
  description text not null default ''
    constraint organizations_description_length check (char_length(description) <= 500),
  -- statusの変更は運営専用経路（ダッシュボード/SQL）のみ。クライアント経路は存在しない
  status public.org_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organizations is
  '団体。作成直後はpending。status変更はクライアントから不可（運営専用経路のみ）';
revoke all on table public.organizations from anon;
revoke all on table public.organizations from authenticated;

-- ---- 団体権限の正本: 行の存在＝有効な所属（Task 008の定義） ----
create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  -- PIIを含まないランダムな担当者表示ラベル（RPCがサーバー側で生成する）
  member_label text not null
    constraint organization_memberships_label_length check (char_length(member_label) between 1 and 30),
  joined_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, member_label)
);
comment on table public.organization_memberships is
  '団体権限の正本。行の存在＝有効な所属。行を作る経路は団体作成時のowner登録と招待承諾のみ（直接DMLは禁止）';
create index organization_memberships_user_id_idx
  on public.organization_memberships (user_id);
revoke all on table public.organization_memberships from anon;
revoke all on table public.organization_memberships from authenticated;

-- ---- 招待（非公開・privateスキーマ。アクセスはSECURITY DEFINER RPCのみ） ----
create table private.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- 生トークンは保存しない。SHA-256 hex（64文字）のみ
  token_hash text not null unique,
  invited_role public.org_role not null default 'member'
    constraint organization_invitations_role_not_owner check (invited_role <> 'owner'),
  -- 監査用。auth.users.idを直接持たずmembership経由で間接参照する
  created_by_membership_id uuid references public.organization_memberships (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by_membership_id uuid references public.organization_memberships (id) on delete set null,
  revoked_at timestamptz,
  constraint organization_invitations_used_xor_revoked
    check (not (used_at is not null and revoked_at is not null))
);
comment on table private.organization_invitations is
  '一回限りの招待リンク。メール指定招待は行わないため招待先メール列は存在しない';
create index organization_invitations_pending_org_idx
  on private.organization_invitations (organization_id)
  where used_at is null and revoked_at is null;
revoke all on table private.organization_invitations from anon;
revoke all on table private.organization_invitations from authenticated;

-- ---- trigger関数（privateスキーマ・クライアント実行不可） ----
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.set_updated_at() from public;
revoke execute on function private.set_updated_at() from anon;
revoke execute on function private.set_updated_at() from authenticated;

create trigger trg_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

-- 最後のownerを失う操作（demote・削除・他団体への付替え）を拒否する。
-- 団体ごとcascade削除中（親organizations行が既に無い）は素通しする
create function private.protect_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 親団体が既に削除されている＝organizationsのon delete cascade実行中
  if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if old.role = 'owner' and (
    tg_op = 'DELETE'
    or new.role is distinct from old.role
    or new.organization_id is distinct from old.organization_id
  ) then
    if not exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = old.organization_id
        and m.role = 'owner'
        and m.id <> old.id
    ) then
      raise exception 'last_owner';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function private.protect_last_owner() from public;
revoke execute on function private.protect_last_owner() from anon;
revoke execute on function private.protect_last_owner() from authenticated;

create trigger trg_protect_last_owner
  before update or delete on public.organization_memberships
  for each row execute function private.protect_last_owner();
