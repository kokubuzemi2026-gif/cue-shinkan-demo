-- Task 008 (3/4): 団体・招待のSECURITY DEFINER RPC群
-- 正本: docs/auth_and_authorization.md §5-§6
--
-- 方針:
-- - 複数行・条件付きの書込はすべてSECURITY DEFINER RPC（関数=単一トランザクションで原子的）
-- - 全RPCの入口でis_university_user()（+必要な団体role）を検証する
-- - 内部ヘルパーはprivateスキーマ（クライアント到達不能）。公開RPCだけをauthenticatedへgrant
-- - エラーメッセージにメール・トークン・存在有無のヒントを含めない

-- ---- 内部ヘルパー（private・definer RPC専用） ----

create function private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_university_user()
     and exists (
       select 1
       from public.organization_memberships m
       where m.organization_id = org_id
         and m.user_id = (select auth.uid())
     )
$$;
revoke execute on function private.is_org_member(uuid) from public;
revoke execute on function private.is_org_member(uuid) from anon;
revoke execute on function private.is_org_member(uuid) from authenticated;

create function private.org_role_at_least(org_id uuid, min_role public.org_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_university_user()
     and exists (
       select 1
       from public.organization_memberships m
       where m.organization_id = org_id
         and m.user_id = (select auth.uid())
         and case min_role
               when 'owner' then m.role = 'owner'
               when 'admin' then m.role in ('owner', 'admin')
               else true
             end
     )
$$;
revoke execute on function private.org_role_at_least(uuid, public.org_role) from public;
revoke execute on function private.org_role_at_least(uuid, public.org_role) from anon;
revoke execute on function private.org_role_at_least(uuid, public.org_role) from authenticated;

-- PIIを含まないランダムな担当者ラベル（例: 担当者-3F7A2C）
create function private.generate_member_label()
returns text
language sql
volatile
set search_path = ''
as $$
  select '担当者-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6))
$$;
revoke execute on function private.generate_member_label() from public;
revoke execute on function private.generate_member_label() from anon;
revoke execute on function private.generate_member_label() from authenticated;

-- ---- F5: 団体作成（organizations + owner membershipを原子的に作成） ----
create function public.create_organization(org_name text, org_description text default '')
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  clean_name text := btrim(coalesce(org_name, ''));
  clean_description text := btrim(coalesce(org_description, ''));
  new_org_id uuid;
  attempt integer := 0;
begin
  if not public.is_university_user() then
    raise exception 'not_university_user';
  end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 100 then
    raise exception 'invalid_org_name';
  end if;
  if char_length(clean_description) > 500 then
    raise exception 'invalid_org_description';
  end if;

  -- statusは必ずdefaultのpending（引数で受け取らない）
  insert into public.organizations (name, description)
  values (clean_name, clean_description)
  returning id into new_org_id;

  loop
    begin
      insert into public.organization_memberships (organization_id, user_id, role, member_label)
      values (new_org_id, (select auth.uid()), 'owner', private.generate_member_label());
      exit;
    exception when unique_violation then
      -- member_labelの衝突のみ想定（新規団体のため(org,user)重複はない）
      attempt := attempt + 1;
      if attempt >= 3 then
        raise;
      end if;
    end;
  end loop;

  return new_org_id;
end;
$$;
revoke execute on function public.create_organization(text, text) from public;
revoke execute on function public.create_organization(text, text) from anon;
grant execute on function public.create_organization(text, text) to authenticated;

-- ---- F6: 団体プロフィール更新（直接UPDATEの代替。statusは変更できない） ----
create function public.update_organization_profile(org_id uuid, new_name text, new_description text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  clean_name text := btrim(coalesce(new_name, ''));
  clean_description text := btrim(coalesce(new_description, ''));
begin
  if not private.org_role_at_least(org_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 100 then
    raise exception 'invalid_org_name';
  end if;
  if char_length(clean_description) > 500 then
    raise exception 'invalid_org_description';
  end if;

  -- statusはSET句に含めない（変更経路は運営専用のみ）
  update public.organizations o
     set name = clean_name,
         description = clean_description
   where o.id = org_id;
end;
$$;
revoke execute on function public.update_organization_profile(uuid, text, text) from public;
revoke execute on function public.update_organization_profile(uuid, text, text) from anon;
grant execute on function public.update_organization_profile(uuid, text, text) to authenticated;

-- ---- F7: 招待作成（owner/adminのみ。生トークンはこの戻り値で一度だけ返す） ----
create function public.create_invitation(org_id uuid, invited_role public.org_role default 'member')
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  raw_token text;
  creator_membership_id uuid;
  new_invitation_id uuid;
  new_expires_at timestamptz := now() + interval '7 days';
begin
  if not private.org_role_at_least(org_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  if invited_role = 'owner' then
    raise exception 'invalid_invited_role';
  end if;

  select m.id
    into creator_membership_id
    from public.organization_memberships m
   where m.organization_id = create_invitation.org_id
     and m.user_id = (select auth.uid());

  -- 256bitランダム。DBにはSHA-256ハッシュ（hex）のみ保存する
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into private.organization_invitations
    (organization_id, token_hash, invited_role, created_by_membership_id, expires_at)
  values
    (create_invitation.org_id,
     encode(extensions.digest(raw_token, 'sha256'), 'hex'),
     create_invitation.invited_role,
     creator_membership_id,
     new_expires_at)
  returning id into new_invitation_id;

  return query select new_invitation_id, raw_token, new_expires_at;
end;
$$;
revoke execute on function public.create_invitation(uuid, public.org_role) from public;
revoke execute on function public.create_invitation(uuid, public.org_role) from anon;
grant execute on function public.create_invitation(uuid, public.org_role) to authenticated;

-- ---- F8: 招待取消（owner/adminのみ。未使用の招待に限る） ----
create function public.revoke_invitation(invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_org uuid;
begin
  select i.organization_id
    into target_org
    from private.organization_invitations i
   where i.id = revoke_invitation.invitation_id
     for update;

  -- 不存在と権限不足を区別しない単一エラー（招待IDの存在探索を防ぐ）
  if target_org is null or not private.org_role_at_least(target_org, 'admin') then
    raise exception 'invalid_invitation';
  end if;

  update private.organization_invitations i
     set revoked_at = now()
   where i.id = revoke_invitation.invitation_id
     and i.used_at is null
     and i.revoked_at is null;

  if not found then
    raise exception 'invalid_invitation';
  end if;
end;
$$;
revoke execute on function public.revoke_invitation(uuid) from public;
revoke execute on function public.revoke_invitation(uuid) from anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- ---- F9: 招待一覧（owner/adminのみ。token_hash・作成者user_idは返さない） ----
create function public.list_invitations(org_id uuid)
returns table (
  id uuid,
  invited_role public.org_role,
  created_at timestamptz,
  expires_at timestamptz,
  state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.org_role_at_least(list_invitations.org_id, 'admin') then
    raise exception 'not_authorized';
  end if;

  return query
    select i.id,
           i.invited_role,
           i.created_at,
           i.expires_at,
           case
             when i.used_at is not null then 'used'
             when i.revoked_at is not null then 'revoked'
             when i.expires_at <= now() then 'expired'
             else 'pending'
           end
      from private.organization_invitations i
     where i.organization_id = list_invitations.org_id
     order by i.created_at desc;
end;
$$;
revoke execute on function public.list_invitations(uuid) from public;
revoke execute on function public.list_invitations(uuid) from anon;
grant execute on function public.list_invitations(uuid) to authenticated;

-- ---- F10: 招待プレビュー（承諾前に団体名・付与roleを確認する同意情報） ----
create function public.preview_invitation(invitation_token text)
returns table (
  organization_name text,
  invited_role public.org_role,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_university_user() then
    raise exception 'not_university_user';
  end if;

  return query
    select o.name, i.invited_role, i.expires_at
      from private.organization_invitations i
      join public.organizations o on o.id = i.organization_id
     where i.token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
       and i.used_at is null
       and i.revoked_at is null
       and i.expires_at > now();

  -- 無効・期限切れ・取消済み・使用済みを区別しない単一エラー
  if not found then
    raise exception 'invalid_invitation';
  end if;
end;
$$;
revoke execute on function public.preview_invitation(text) from public;
revoke execute on function public.preview_invitation(text) from anon;
grant execute on function public.preview_invitation(text) to authenticated;

-- ---- F11: 招待承諾（単一使用をFOR UPDATEで原子的に消費） ----
create function public.accept_invitation(invitation_token text)
returns table (organization_id uuid, organization_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inv record;
  new_membership_id uuid;
  attempt integer := 0;
begin
  if not public.is_university_user() then
    raise exception 'not_university_user';
  end if;

  select i.*
    into inv
    from private.organization_invitations i
   where i.token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
     for update;

  if not found
     or inv.used_at is not null
     or inv.revoked_at is not null
     or inv.expires_at <= now() then
    raise exception 'invalid_invitation';
  end if;

  -- 既メンバーはトークンを消費しない（本人自身の状態のみ通知する）
  if exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = inv.organization_id
      and m.user_id = (select auth.uid())
  ) then
    raise exception 'already_member';
  end if;

  loop
    begin
      insert into public.organization_memberships (organization_id, user_id, role, member_label)
      values (inv.organization_id, (select auth.uid()), inv.invited_role, private.generate_member_label())
      returning id into new_membership_id;
      exit;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt >= 3 then
        raise;
      end if;
    end;
  end loop;

  update private.organization_invitations i
     set used_at = now(),
         used_by_membership_id = new_membership_id
   where i.id = inv.id;

  return query
    select o.id, o.name
      from public.organizations o
     where o.id = inv.organization_id;
end;
$$;
revoke execute on function public.accept_invitation(text) from public;
revoke execute on function public.accept_invitation(text) from anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---- F12: 担当者一覧（PIIなし4列限定: ラベル・権限・参加日時・自分かどうか） ----
create function public.org_member_directory(org_id uuid)
returns table (
  member_label text,
  role public.org_role,
  joined_at timestamptz,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(org_member_directory.org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.member_label,
           m.role,
           m.joined_at,
           m.user_id = (select auth.uid())
      from public.organization_memberships m
     where m.organization_id = org_member_directory.org_id
     order by m.joined_at asc, m.member_label asc;
end;
$$;
revoke execute on function public.org_member_directory(uuid) from public;
revoke execute on function public.org_member_directory(uuid) from anon;
grant execute on function public.org_member_directory(uuid) to authenticated;
