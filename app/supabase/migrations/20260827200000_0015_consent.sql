-- Task 015: 同意バージョンの記録と、同意前の書込拒否
-- 正本: docs/decisions.md D050 / docs/legal/terms_draft.md / docs/legal/privacy_draft.md
--
-- 方針:
-- - 同意の「現在の版」は関数の定数で持つ。版を上げたら、その版に同意していない
--   利用者は再同意を求められる（needs_consent が true になる）
-- - 「同意前に登録できない」は画面の出し分けだけに頼らず、書込RPCの中で構造で止める
--   （save_student_passport と create_organization の両方。利用規約は両方の役割に及ぶ）
-- - 記録は user_id と同意した版・時刻だけ。文書本文や差分は持たない

-- ---- 現在の同意版 ----
-- 版は単調増加の整数。利用規約・プライバシーポリシーをまとめて1つの版で扱う
-- （画面では両方を同時に提示する）。文言を実質的に変えたらこの数を上げる
create function private.current_consent_version()
returns integer
language sql
immutable
set search_path = ''
as $$ select 1 $$;
comment on function private.current_consent_version() is
  '現在必要な同意の版。文言を実質的に変えたら上げる。上げると未同意者は再同意を求められる（D050）';
revoke execute on function private.current_consent_version() from public;
revoke execute on function private.current_consent_version() from anon;
revoke execute on function private.current_consent_version() from authenticated;

-- ---- 同意の記録（本人の最新版だけを保持する） ----
create table public.student_consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  consent_version integer not null
    constraint student_consents_version_positive check (consent_version >= 1),
  agreed_at timestamptz not null default now()
);
comment on table public.student_consents is
  '利用規約・プライバシーポリシーへの同意。本人の最新の同意版だけを持つ（D050）';
alter table public.student_consents enable row level security;
revoke all on table public.student_consents from anon;
revoke all on table public.student_consents from authenticated;
-- 本人だけが自分の同意状況を読める。書込はRPCのみ
grant select on table public.student_consents to authenticated;
create policy student_consents_select_own on public.student_consents
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---- 同意しているかの判定（構造で使う） ----
create function private.has_current_consent(subject uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.student_consents c
    where c.user_id = subject
      and c.consent_version >= private.current_consent_version()
  );
$$;
revoke execute on function private.has_current_consent(uuid) from public;
revoke execute on function private.has_current_consent(uuid) from anon;
revoke execute on function private.has_current_consent(uuid) from authenticated;

-- ---- F33: 同意状況の取得（画面用） ----
create function public.my_consent()
returns table (agreed_version integer, current_version integer, needs_consent boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_university_user() then
    raise exception 'not_university_user';
  end if;
  current_version := private.current_consent_version();
  select c.consent_version into agreed_version
    from public.student_consents c
   where c.user_id = (select auth.uid());
  needs_consent := coalesce(agreed_version, 0) < current_version;
  return next;
end;
$$;
comment on function public.my_consent() is
  '自分の同意状況。needs_consentがtrueなら（初回・版が上がった）再同意が必要（D050）';
revoke execute on function public.my_consent() from public;
revoke execute on function public.my_consent() from anon;
grant execute on function public.my_consent() to authenticated;

-- ---- F34: 同意の記録 ----
create function public.record_consent(version integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_university_user() then
    raise exception 'not_university_user';
  end if;
  -- 画面が提示した版と現在の版が食い違うとき（古い画面のまま同意した等）は拒否する。
  -- 未来の版・過去の版への同意を記録しない
  if version is null or version <> private.current_consent_version() then
    raise exception 'consent_version_mismatch';
  end if;

  insert into public.student_consents (user_id, consent_version, agreed_at)
  values ((select auth.uid()), version, now())
  on conflict (user_id) do update set
    consent_version = excluded.consent_version,
    agreed_at = excluded.agreed_at;
end;
$$;
comment on function public.record_consent(integer) is
  '現在の版への同意を記録する。画面の版が古いと consent_version_mismatch（D050）';
revoke execute on function public.record_consent(integer) from public;
revoke execute on function public.record_consent(integer) from anon;
grant execute on function public.record_consent(integer) to authenticated;

-- ---- 同意前は登録できない（構造で止める） ----
-- 画面の出し分けだけに頼らず、書込RPCの中で確認する。
-- 「登録前に同意」を守るため、興味パスポートの保存と団体の作成の両方を止める
create or replace function public.save_student_passport(
  interests public.interest_category[],
  purposes public.purpose[],
  style public.activity_style,
  frequency public.frequency,
  available_days public.day_slot[],
  experience public.experience_level,
  max_fee_per_event_yen integer,
  reception_paused boolean,
  reception_categories public.interest_category[],
  reception_weekly_limit integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_interests public.interest_category[] :=
    private.dedup_preserving_order(coalesce(save_student_passport.interests, '{}'));
  v_purposes public.purpose[] :=
    private.dedup_preserving_order(coalesce(save_student_passport.purposes, '{}'));
  v_days public.day_slot[] :=
    private.dedup_preserving_order(coalesce(save_student_passport.available_days, '{}'));
  v_categories public.interest_category[] :=
    private.dedup_preserving_order(coalesce(save_student_passport.reception_categories, '{}'));
begin
  if not private.is_current_student() then
    raise exception 'not_student';
  end if;
  -- Task 015: 同意していないと登録できない
  if not private.has_current_consent((select auth.uid())) then
    raise exception 'consent_required';
  end if;
  if cardinality(v_interests) not between 1 and 8
     or cardinality(v_purposes) not between 1 and 4
     or cardinality(v_days) not between 1 and 3
     or cardinality(v_categories) > 8
     or save_student_passport.style is null
     or save_student_passport.frequency is null
     or save_student_passport.experience is null
     or save_student_passport.max_fee_per_event_yen is null
     or save_student_passport.max_fee_per_event_yen not between 0 and 100000
     or save_student_passport.reception_paused is null
     or save_student_passport.reception_weekly_limit is null
     or save_student_passport.reception_weekly_limit not between 1 and 5 then
    raise exception 'invalid_passport';
  end if;

  insert into public.student_passports as sp (
    user_id, interests, purposes, style, frequency, available_days, experience,
    max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
  )
  values (
    (select auth.uid()), v_interests, v_purposes,
    save_student_passport.style, save_student_passport.frequency, v_days,
    save_student_passport.experience, save_student_passport.max_fee_per_event_yen,
    save_student_passport.reception_paused, v_categories,
    save_student_passport.reception_weekly_limit::smallint
  )
  on conflict (user_id) do update set
    interests = excluded.interests,
    purposes = excluded.purposes,
    style = excluded.style,
    frequency = excluded.frequency,
    available_days = excluded.available_days,
    experience = excluded.experience,
    max_fee_per_event_yen = excluded.max_fee_per_event_yen,
    reception_paused = excluded.reception_paused,
    reception_categories = excluded.reception_categories,
    reception_weekly_limit = excluded.reception_weekly_limit;
end;
$$;
revoke execute on function public.save_student_passport(
  public.interest_category[], public.purpose[], public.activity_style, public.frequency,
  public.day_slot[], public.experience_level, integer, boolean,
  public.interest_category[], integer) from public;
revoke execute on function public.save_student_passport(
  public.interest_category[], public.purpose[], public.activity_style, public.frequency,
  public.day_slot[], public.experience_level, integer, boolean,
  public.interest_category[], integer) from anon;
grant execute on function public.save_student_passport(
  public.interest_category[], public.purpose[], public.activity_style, public.frequency,
  public.day_slot[], public.experience_level, integer, boolean,
  public.interest_category[], integer) to authenticated;

-- create_organization も同意を必須にする（利用規約は団体担当者にも及ぶ）
create or replace function public.create_organization(org_name text, org_description text default '')
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
  -- Task 015: 同意していないと団体を作れない
  if not private.has_current_consent((select auth.uid())) then
    raise exception 'consent_required';
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

-- 同意記録もアカウント削除で消す（再登録時は再同意が必要になる）。
-- student_consents は auth.users を参照するため、student_accounts のcascadeでは落ちない。
-- delete_my_account の残存検査（全テーブル走査）がこれを検出したため、明示的に消す
create or replace function public.delete_my_account()
returns table (removed_rows integer, blocking_organizations integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_removed integer := 0;
  v_count integer;
begin
  if not public.is_university_user() then
    raise exception 'not_university_user';
  end if;

  delete from public.organization_memberships m
   where m.user_id = v_uid
     and not (
       m.role = 'owner'
       and not exists (
         select 1 from public.organization_memberships other
          where other.organization_id = m.organization_id
            and other.role = 'owner'
            and other.user_id <> v_uid
       )
     );
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  delete from public.student_accounts sa where sa.user_id = v_uid;
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  -- Task 015: 同意記録を消す（auth.usersを参照するためcascadeで落ちない）
  delete from public.student_consents c where c.user_id = v_uid;
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  select count(*)::integer into blocking_organizations
    from public.organization_memberships m
   where m.user_id = v_uid;

  if v_removed = 0 and blocking_organizations = 0 then
    raise exception 'nothing_to_delete';
  end if;

  if v_removed > 0 then
    perform private.record_deletion('account_deleted', v_removed);
  end if;
  removed_rows := v_removed;
  return next;
end;
$$;
comment on function public.delete_my_account() is
  'CUEに保存した自分のデータを消す。最後のownerである団体の所属だけは残し、その数を返す（D047・D049）。同意記録も消す（D050）。auth identityは運営手順で削除する';
