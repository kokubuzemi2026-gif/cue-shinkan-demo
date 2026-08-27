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

-- ---- 団体側の操作も同意を必須にする（D050） ----
-- 独立レビュー（Task 015）で、招待経由で担当者になった未同意の利用者が
-- 団体名・窓口の変更、招待の発行、オファー送信まで到達できることを再現した。
-- 画面側は同意ゲートを最前段に置いているが、authenticatedはPostgREST経由で
-- RPCを直接呼べるため、UIの順序は防御にならない。
--
-- ゲートするのは「参加を作る・広げる」操作だけにする。受信停止・返答・脱退・
-- 削除などの**利用者が自分の露出を減らす操作**は、版が上がっても止めない
-- （止めると「いつでも受信を止められる」という約束を壊す）。
--
-- 本文はレビュー時点のカタログ定義（pg_get_functiondef）から生成し、
-- 差分は下記のガード4行だけである。
create or replace function public.accept_invitation(invitation_token text)
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
  -- Task 015: 同意していないと団体側の操作はできない（D050）
  if not private.has_current_consent((select auth.uid())) then
    raise exception 'consent_required';
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

create or replace function public.create_invitation(org_id uuid, invited_role public.org_role DEFAULT 'member'::public.org_role)
returns table (invitation_id uuid, token text, expires_at timestamp with time zone)
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
  -- Task 015: 同意していないと団体側の操作はできない（D050）
  if not private.has_current_consent((select auth.uid())) then
    raise exception 'consent_required';
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

create or replace function public.preview_offer_audience(org_id uuid, event_name text, description text, reason_note text, date_text text, place text, event_days public.day_slot[], frequency public.frequency, fee_per_event_yen integer, beginner_friendly boolean, intensity public.activity_style, target_categories public.interest_category[], target_purposes public.purpose[], capacity integer, deadline date)
returns table (audience_band text, duplicate_event boolean, sent_this_week integer, weekly_limit integer, preview_conditions_used integer, preview_conditions_limit integer, band_computed_at timestamp with time zone)
language plpgsql
volatile
security definer
set search_path = ''
as $$

declare
  v_event_name text;
  v_description text;
  v_reason_note text;
  v_date_text text;
  v_place text;
  v_event_days public.day_slot[];
  v_target_categories public.interest_category[];
  v_target_purposes public.purpose[];
  v_now timestamptz := now();
  v_status public.org_status;
  v_fingerprint text;
  v_audience_fp text;
  v_band text;
  v_computed_at timestamptz;
  v_used integer;
  v_deliverable integer;
begin
  -- 1. 権限（安価なindex参照）
  if not private.org_role_at_least(preview_offer_audience.org_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  -- Task 015: 同意していないと団体側の操作はできない（D050）
  if not private.has_current_consent((select auth.uid())) then
    raise exception 'consent_required';
  end if;

  -- 2. 入力の早期検証（btrim・重複除去・ハッシュ・マッチング計算より前・D039）
  perform private.assert_offer_input_bounds(
    preview_offer_audience.event_name, preview_offer_audience.description,
    preview_offer_audience.reason_note, preview_offer_audience.date_text,
    preview_offer_audience.place, preview_offer_audience.event_days,
    preview_offer_audience.target_categories, preview_offer_audience.target_purposes
  );

  select o.status into v_status
    from public.organizations o
   where o.id = preview_offer_audience.org_id;
  if v_status is distinct from 'verified' then
    raise exception 'org_not_verified';
  end if;

  -- 3. 正規化と意味的な検証
  v_event_name := btrim(coalesce(preview_offer_audience.event_name, ''));
  v_description := btrim(coalesce(preview_offer_audience.description, ''));
  v_reason_note := btrim(coalesce(preview_offer_audience.reason_note, ''));
  v_date_text := btrim(coalesce(preview_offer_audience.date_text, ''));
  v_place := btrim(coalesce(preview_offer_audience.place, ''));
  v_event_days := private.dedup_preserving_order(coalesce(preview_offer_audience.event_days, '{}'));
  v_target_categories :=
    private.dedup_preserving_order(coalesce(preview_offer_audience.target_categories, '{}'));
  v_target_purposes :=
    private.dedup_preserving_order(coalesce(preview_offer_audience.target_purposes, '{}'));
  perform private.assert_offer_args(
    v_event_name, v_description, v_reason_note, v_date_text, v_place,
    v_event_days, v_target_categories, v_target_purposes,
    preview_offer_audience.fee_per_event_yen, preview_offer_audience.capacity,
    preview_offer_audience.deadline
  );

  -- 4. 同一団体のpreviewを直列化して、条件数の制限が並行実行で破れないようにする。
  --    organizations行ではなくadvisory lockを使い、profile更新・send_offerと競合させない
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(preview_offer_audience.org_id::text, 11));

  v_audience_fp := private.audience_fingerprint(
    v_target_categories, v_target_purposes, preview_offer_audience.intensity,
    v_event_days, preview_offer_audience.frequency,
    preview_offer_audience.fee_per_event_yen, preview_offer_audience.beginner_friendly
  );

  -- 5. 24時間以内の同一条件は保存済みの区分を返す（母集団が変わっても動かない）。
  --    再問い合わせは条件数を消費しない
  select c.band, c.first_computed_at
    into v_band, v_computed_at
    from private.offer_preview_cache c
   where c.organization_id = preview_offer_audience.org_id
     and c.audience_fingerprint = v_audience_fp
     and c.first_computed_at > v_now - interval '24 hours';

  if v_band is null then
    -- 6. 新しい条件。rolling 24時間の条件数を確認する
    select count(*)::integer
      into v_used
      from private.offer_preview_cache c
     where c.organization_id = preview_offer_audience.org_id
       and c.first_computed_at > v_now - interval '24 hours';
    if v_used >= 20 then
      raise exception 'preview_quota_exceeded';
    end if;

    select count(*)::integer
      into v_deliverable
      from private.evaluate_offer_audience(
        v_target_categories, v_target_purposes, preview_offer_audience.intensity,
        v_event_days, preview_offer_audience.frequency,
        preview_offer_audience.fee_per_event_yen, preview_offer_audience.beginner_friendly,
        v_now
      ) a
     where not a.limited;
    v_band := private.audience_band(v_deliverable);
    v_computed_at := v_now;

    insert into private.offer_preview_cache as c (
      organization_id, audience_fingerprint, band, first_computed_at, last_accessed_at, access_count
    )
    values (preview_offer_audience.org_id, v_audience_fp, v_band, v_now, v_now, 1)
    on conflict (organization_id, audience_fingerprint) do update set
      band = excluded.band,
      first_computed_at = excluded.first_computed_at,
      last_accessed_at = excluded.last_accessed_at,
      access_count = 1;
  else
    update private.offer_preview_cache c
       set last_accessed_at = v_now,
           access_count = c.access_count + 1
     where c.organization_id = preview_offer_audience.org_id
       and c.audience_fingerprint = v_audience_fp;
  end if;

  -- 7. 団体自身に関する数値（学生の情報ではないため正確な値を返す）
  v_fingerprint := private.event_fingerprint(
    preview_offer_audience.org_id, v_event_name, v_date_text, v_place
  );
  audience_band := v_band;
  band_computed_at := v_computed_at;
  duplicate_event := exists (
    select 1
    from private.offer_deliveries d
    where d.organization_id = preview_offer_audience.org_id
      and d.event_fingerprint = v_fingerprint
  );
  sent_this_week := (
    select count(*)::integer
    from private.offer_deliveries d
    where d.organization_id = preview_offer_audience.org_id
      and d.delivered_at > v_now - interval '7 days'
      and d.delivered_at <= v_now
  );
  weekly_limit := 3;
  preview_conditions_used := (
    select count(*)::integer
    from private.offer_preview_cache c
    where c.organization_id = preview_offer_audience.org_id
      and c.first_computed_at > v_now - interval '24 hours'
  );
  preview_conditions_limit := 20;
  return next;
end;
$$;

create or replace function public.send_offer(org_id uuid, event_name text, description text, reason_note text, date_text text, place text, event_days public.day_slot[], frequency public.frequency, fee_per_event_yen integer, beginner_friendly boolean, intensity public.activity_style, target_categories public.interest_category[], target_purposes public.purpose[], capacity integer, deadline date)
returns table (delivery_id uuid, audience_band text)
language plpgsql
volatile
security definer
set search_path = ''
as $$

declare
  v_event_name text;
  v_description text;
  v_reason_note text;
  v_date_text text;
  v_place text;
  v_event_days public.day_slot[];
  v_target_categories public.interest_category[];
  v_target_purposes public.purpose[];
  v_now timestamptz := now();
  v_org record;
  v_fingerprint text;
  v_audience_fp text;
  v_band text;
  v_sent_this_week integer;
  v_membership_id uuid;
  v_delivery_id uuid;
  v_candidates uuid[];
  v_uid uuid;
  v_deliverable integer;
begin
  -- 1. 権限
  if not private.org_role_at_least(send_offer.org_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  -- Task 015: 同意していないと団体側の操作はできない（D050）
  if not private.has_current_consent((select auth.uid())) then
    raise exception 'consent_required';
  end if;

  -- 2. 入力の早期検証（組織行のロックを取る前に済ませ、ロック保持時間を短くする・D039）
  perform private.assert_offer_input_bounds(
    send_offer.event_name, send_offer.description, send_offer.reason_note,
    send_offer.date_text, send_offer.place, send_offer.event_days,
    send_offer.target_categories, send_offer.target_purposes
  );

  -- 3. 団体の週枠とfingerprint判定を並行送信から守るため団体行をロックする
  select o.status, o.name, o.description, o.contact_label, o.contact_handle
    into v_org
    from public.organizations o
   where o.id = send_offer.org_id
     for update;
  if v_org.status is distinct from 'verified' then
    raise exception 'org_not_verified';
  end if;

  -- 4. 正規化と意味的な検証
  v_event_name := btrim(coalesce(send_offer.event_name, ''));
  v_description := btrim(coalesce(send_offer.description, ''));
  v_reason_note := btrim(coalesce(send_offer.reason_note, ''));
  v_date_text := btrim(coalesce(send_offer.date_text, ''));
  v_place := btrim(coalesce(send_offer.place, ''));
  v_event_days := private.dedup_preserving_order(coalesce(send_offer.event_days, '{}'));
  v_target_categories := private.dedup_preserving_order(coalesce(send_offer.target_categories, '{}'));
  v_target_purposes := private.dedup_preserving_order(coalesce(send_offer.target_purposes, '{}'));
  perform private.assert_offer_args(
    v_event_name, v_description, v_reason_note, v_date_text, v_place,
    v_event_days, v_target_categories, v_target_purposes,
    send_offer.fee_per_event_yen, send_offer.capacity, send_offer.deadline
  );

  select count(*)::integer
    into v_sent_this_week
    from private.offer_deliveries d
   where d.organization_id = send_offer.org_id
     and d.delivered_at > v_now - interval '7 days'
     and d.delivered_at <= v_now;
  if v_sent_this_week >= 3 then
    raise exception 'weekly_limit_reached';
  end if;

  v_fingerprint := private.event_fingerprint(
    send_offer.org_id, v_event_name, v_date_text, v_place
  );
  if exists (
    select 1
    from private.offer_deliveries d
    where d.organization_id = send_offer.org_id
      and d.event_fingerprint = v_fingerprint
  ) then
    raise exception 'duplicate_event';
  end if;

  -- 送信は「対象を確認してから送る」導線（product_spec.md §7 団体 4→5）の後段であり、
  -- 24時間以内に同じ対象条件のpreviewを通っていることを必須にする。
  --
  -- これは差分攻撃の遮断でもある（D038）。送信の失敗は例外で全体をrollbackするため、
  -- 失敗した送信は配信行もpreviewの条件数も消費しない。ゲートが無いと
  -- `no_recipients`（0人）と `insufficient_audience`（1〜4人）の区別が
  -- 「回数制限も監査記録も無い1人単位の判定器」になり、
  -- previewへ課した20条件/24時間の制限を完全に迂回できてしまう
  -- （実測: 16回の呼び出しで特定学生の予算上限を1円単位で確定できた）。
  -- previewを必須にすることで、探索の手数はpreviewの予算に縛られる。
  v_audience_fp := private.audience_fingerprint(
    v_target_categories, v_target_purposes, send_offer.intensity,
    v_event_days, send_offer.frequency, send_offer.fee_per_event_yen,
    send_offer.beginner_friendly
  );
  select c.band
    into v_band
    from private.offer_preview_cache c
   where c.organization_id = send_offer.org_id
     and c.audience_fingerprint = v_audience_fp
     and c.first_computed_at > v_now - interval '24 hours';
  if v_band is null then
    raise exception 'preview_required';
  end if;

  select m.id
    into v_membership_id
    from public.organization_memberships m
   where m.organization_id = send_offer.org_id
     and m.user_id = (select auth.uid());

  begin
    insert into private.offer_deliveries (
      organization_id, created_by_membership_id, delivered_at,
      org_name, org_description, org_contact_label, org_contact_handle,
      event_name, description, reason_note, date_text, place,
      event_days, frequency, fee_per_event_yen, beginner_friendly, intensity,
      target_categories, target_purposes, capacity, deadline, event_fingerprint
    )
    values (
      send_offer.org_id, v_membership_id, v_now,
      v_org.name, v_org.description, v_org.contact_label, v_org.contact_handle,
      v_event_name, v_description, v_reason_note, v_date_text, v_place,
      v_event_days, send_offer.frequency, send_offer.fee_per_event_yen,
      send_offer.beginner_friendly, send_offer.intensity,
      v_target_categories, v_target_purposes, send_offer.capacity, send_offer.deadline,
      v_fingerprint
    )
    returning id into v_delivery_id;
  exception when unique_violation then
    raise exception 'duplicate_event';
  end;

  -- 5. マッチ候補（週枠の判定前）を確定し、学生ごとの枠を確保する対象を決める
  select coalesce(array_agg(a.user_id order by a.user_id), '{}')
    into v_candidates
    from private.evaluate_offer_audience(
      v_target_categories, v_target_purposes, send_offer.intensity,
      v_event_days, send_offer.frequency, send_offer.fee_per_event_yen,
      send_offer.beginner_friendly, v_now
    ) a;

  if cardinality(v_candidates) = 0 then
    raise exception 'no_recipients';
  end if;

  -- 6. 枠の行を用意し、user_id昇順で1行ずつロックする。
  --    昇順の固定順序により、団体をまたぐ並行送信でデッドロックしない（D037）
  insert into private.student_delivery_quota (user_id)
  select c.uid from unnest(v_candidates) as c(uid)
  on conflict (user_id) do nothing;

  foreach v_uid in array v_candidates loop
    perform 1
      from private.student_delivery_quota q
     where q.user_id = v_uid
       for update;
  end loop;

  -- 7. ロック取得後に週枠を再計算して受信者を確定する。
  --    ここはロック待ちの後の新しい文＝READ COMMITTEDの新しいsnapshotのため、
  --    先にcommitした並行トランザクションの配信が必ず見える。
  --    上限を now() で閉じないのは、並行トランザクションのdelivered_atが
  --    自分のトランザクション開始時刻より後になり得るため（取りこぼすと上限が破れる）。
  --    対象は手順6でロック済みのcandidatesに限る（未ロックの新規学生は今回の配信に含めない）。
  with inserted as (
    insert into private.offer_recipients (delivery_id, user_id, score, reasons, cautions)
    select v_delivery_id, a.user_id, a.score::smallint, a.reasons, a.cautions
      from private.evaluate_offer_audience(
        v_target_categories, v_target_purposes, send_offer.intensity,
        v_event_days, send_offer.frequency, send_offer.fee_per_event_yen,
        send_offer.beginner_friendly, v_now
      ) a
      join public.student_passports p on p.user_id = a.user_id
     where a.user_id = any (v_candidates)
       and (
         select count(*)
         from private.offer_recipients r
         join private.offer_deliveries d on d.id = r.delivery_id
         where r.user_id = a.user_id
           and d.id <> v_delivery_id
           and d.delivered_at > v_now - interval '7 days'
       ) < p.reception_weekly_limit
    returning user_id
  )
  select count(*)::integer into v_deliverable from inserted;

  -- 8. 匿名性の下限（D036）。0人・1〜4人は一切書き込まずに全体をrollbackする
  if v_deliverable = 0 then
    raise exception 'no_recipients';
  end if;
  if v_deliverable < 5 then
    raise exception 'insufficient_audience';
  end if;

  -- 9. 枠の観測値を更新する。手順7とは別の文にする必要がある:
  --    同一文のCTEは同じsnapshotを見るため、直前に挿入した受信者行が数えられない
  update private.student_delivery_quota q
     set window_count = (
           select count(*)::smallint
           from private.offer_recipients r
           join private.offer_deliveries d on d.id = r.delivery_id
           where r.user_id = q.user_id
             and d.delivered_at > v_now - interval '7 days'
         ),
         window_started_at = v_now - interval '7 days',
         last_delivered_at = v_now,
         updated_at = v_now
   where q.user_id in (
     select r.user_id from private.offer_recipients r where r.delivery_id = v_delivery_id
   );

  delivery_id := v_delivery_id;
  -- 送信時点で数え直した人数ではなく、previewで確定した区分を返す。
  -- 同一条件の結果を24時間固定する規則（D038）を送信の応答でも守り、
  -- 送信を「その瞬間の人数」の観測手段にしない
  audience_band := v_band;
  return next;
end;
$$;

create or replace function public.update_organization_contact(org_id uuid, new_label text, new_handle text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$

declare
  v_label text := btrim(coalesce(new_label, ''));
  v_handle text := btrim(coalesce(new_handle, ''));
begin
  if not private.org_role_at_least(update_organization_contact.org_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  -- Task 015: 同意していないと団体側の操作はできない（D050）
  if not private.has_current_consent((select auth.uid())) then
    raise exception 'consent_required';
  end if;
  if char_length(v_label) > 50 or char_length(v_handle) > 100 then
    raise exception 'invalid_org_contact';
  end if;

  update public.organizations o
     set contact_label = v_label,
         contact_handle = v_handle
   where o.id = update_organization_contact.org_id;
end;
$$;

create or replace function public.update_organization_profile(org_id uuid, new_name text, new_description text)
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
  -- Task 015: 同意していないと団体側の操作はできない（D050）
  if not private.has_current_consent((select auth.uid())) then
    raise exception 'consent_required';
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
