-- Task 009 (3/4): サーバーデータのSECURITY DEFINER RPC群
-- 正本: docs/server_data_model.md §4 / docs/decisions.md D021-D023・D029・D032
--
-- 方針（008と同一）:
-- - 書込・機微データ読取はすべてSECURITY DEFINER RPC（関数=単一トランザクションで原子的）
-- - 全RPCの入口でis_university_user()由来の権限（学生 or 団体role）を検証する
-- - 内部ヘルパーはprivateスキーマ（クライアント到達不能）。公開RPCだけをauthenticatedへgrant
-- - 団体向けRPCは学生ID・個人一覧を一切返さない（匿名件数のみ・D029）
-- - エラーメッセージにメール・ID・存在有無のヒントを含めない

-- ---- 内部ヘルパー: 学生権限（大学ユーザー + student_accounts行の存在） ----
create function private.is_current_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_university_user()
     and exists (
       select 1
       from public.student_accounts sa
       where sa.user_id = (select auth.uid())
     )
$$;
revoke execute on function private.is_current_student() from public;
revoke execute on function private.is_current_student() from anon;
revoke execute on function private.is_current_student() from authenticated;

-- ---- 内部ヘルパー: 先頭出現順を保つ重複除去（配点操作の防止と入力の正規化） ----
create function private.dedup_preserving_order(arr anyarray)
returns anyarray
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select array_agg(s.x order by s.ord)
      from (
        select t.x, min(t.ord) as ord
        from unnest(arr) with ordinality as t(x, ord)
        group by t.x
      ) s
    ),
    arr[1:0]
  )
$$;
revoke execute on function private.dedup_preserving_order(anyarray) from public;
revoke execute on function private.dedup_preserving_order(anyarray) from anon;
revoke execute on function private.dedup_preserving_order(anyarray) from authenticated;

-- ---- 内部ヘルパー: オファー入力の検証（preview / sendで同一の規則を強制する） ----
create function private.assert_offer_args(
  v_event_name text,
  v_description text,
  v_reason_note text,
  v_date_text text,
  v_place text,
  v_event_days public.day_slot[],
  v_target_categories public.interest_category[],
  v_target_purposes public.purpose[],
  v_fee integer,
  v_capacity integer,
  v_deadline date
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if v_event_name is null or char_length(v_event_name) not between 1 and 100
     or v_description is null or char_length(v_description) not between 1 and 500
     or v_reason_note is null or char_length(v_reason_note) not between 1 and 500
     or v_date_text is null or char_length(v_date_text) not between 1 and 100
     or v_place is null or char_length(v_place) not between 1 and 100
     or v_event_days is null or cardinality(v_event_days) not between 1 and 3
     or v_target_categories is null or cardinality(v_target_categories) not between 1 and 8
     or v_target_purposes is null or cardinality(v_target_purposes) not between 1 and 4
     or v_fee is null or v_fee not between 0 and 100000
     or v_capacity is null or v_capacity not between 1 and 1000
     or v_deadline is null then
    raise exception 'invalid_offer';
  end if;
end;
$$;
revoke execute on function private.assert_offer_args(
  text, text, text, text, text, public.day_slot[], public.interest_category[],
  public.purpose[], integer, integer, date
) from public;
revoke execute on function private.assert_offer_args(
  text, text, text, text, text, public.day_slot[], public.interest_category[],
  public.purpose[], integer, integer, date
) from anon;
revoke execute on function private.assert_offer_args(
  text, text, text, text, text, public.day_slot[], public.interest_category[],
  public.purpose[], integer, integer, date
) from authenticated;

-- ---- 内部ヘルパー: 配信対象の評価（マッチ集合と週上限D021の判定。preview / sendで共用） ----
-- limited = 判定時点から遡る7日間（下限exclusive・上限inclusive）に受信した配信数が
-- 本人の週上限に達している学生
create function private.evaluate_offer_audience(
  o_target_categories public.interest_category[],
  o_target_purposes public.purpose[],
  o_intensity public.activity_style,
  o_event_days public.day_slot[],
  o_frequency public.frequency,
  o_fee_per_event_yen integer,
  o_beginner_friendly boolean,
  at_time timestamptz
)
returns table (user_id uuid, score integer, reasons text[], cautions text[], limited boolean)
language sql
stable
set search_path = ''
as $$
  select p.user_id,
         m.score,
         m.reasons,
         m.cautions,
         (
           select count(*)
           from private.offer_recipients r
           join private.offer_deliveries d on d.id = r.delivery_id
           where r.user_id = p.user_id
             and d.delivered_at > at_time - interval '7 days'
             and d.delivered_at <= at_time
         ) >= p.reception_weekly_limit as limited
  from public.student_passports p
  cross join lateral private.match_passport(
    p, o_target_categories, o_target_purposes, o_intensity, o_event_days,
    o_frequency, o_fee_per_event_yen, o_beginner_friendly
  ) m
  where m.eligible
$$;
revoke execute on function private.evaluate_offer_audience(
  public.interest_category[], public.purpose[], public.activity_style,
  public.day_slot[], public.frequency, integer, boolean, timestamptz
) from public;
revoke execute on function private.evaluate_offer_audience(
  public.interest_category[], public.purpose[], public.activity_style,
  public.day_slot[], public.frequency, integer, boolean, timestamptz
) from anon;
revoke execute on function private.evaluate_offer_audience(
  public.interest_category[], public.purpose[], public.activity_style,
  public.day_slot[], public.frequency, integer, boolean, timestamptz
) from authenticated;

-- ---- F13: 興味パスポートの保存（作成・更新の唯一の書込経路） ----
create function public.save_student_passport(
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
  public.day_slot[], public.experience_level, integer, boolean, public.interest_category[], integer
) from public;
revoke execute on function public.save_student_passport(
  public.interest_category[], public.purpose[], public.activity_style, public.frequency,
  public.day_slot[], public.experience_level, integer, boolean, public.interest_category[], integer
) from anon;
grant execute on function public.save_student_passport(
  public.interest_category[], public.purpose[], public.activity_style, public.frequency,
  public.day_slot[], public.experience_level, integer, boolean, public.interest_category[], integer
) to authenticated;

-- ---- F14: 団体の公式窓口の更新（owner/adminのみ。個人の連絡先は置かない） ----
create function public.update_organization_contact(
  org_id uuid,
  new_label text,
  new_handle text
)
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
  if char_length(v_label) > 50 or char_length(v_handle) > 100 then
    raise exception 'invalid_org_contact';
  end if;

  update public.organizations o
     set contact_label = v_label,
         contact_handle = v_handle
   where o.id = update_organization_contact.org_id;
end;
$$;
revoke execute on function public.update_organization_contact(uuid, text, text) from public;
revoke execute on function public.update_organization_contact(uuid, text, text) from anon;
grant execute on function public.update_organization_contact(uuid, text, text) to authenticated;

-- ---- F15: 配信対象プレビュー（送信確認画面用。匿名件数のみを返す・D007/D029） ----
create function public.preview_offer_audience(
  org_id uuid,
  event_name text,
  description text,
  reason_note text,
  date_text text,
  place text,
  event_days public.day_slot[],
  frequency public.frequency,
  fee_per_event_yen integer,
  beginner_friendly boolean,
  intensity public.activity_style,
  target_categories public.interest_category[],
  target_purposes public.purpose[],
  capacity integer,
  deadline date
)
returns table (
  matched_count integer,
  limited_count integer,
  deliverable_count integer,
  duplicate_event boolean,
  sent_this_week integer,
  weekly_limit integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event_name text := btrim(coalesce(preview_offer_audience.event_name, ''));
  v_description text := btrim(coalesce(preview_offer_audience.description, ''));
  v_reason_note text := btrim(coalesce(preview_offer_audience.reason_note, ''));
  v_date_text text := btrim(coalesce(preview_offer_audience.date_text, ''));
  v_place text := btrim(coalesce(preview_offer_audience.place, ''));
  v_event_days public.day_slot[] :=
    private.dedup_preserving_order(coalesce(preview_offer_audience.event_days, '{}'));
  v_target_categories public.interest_category[] :=
    private.dedup_preserving_order(coalesce(preview_offer_audience.target_categories, '{}'));
  v_target_purposes public.purpose[] :=
    private.dedup_preserving_order(coalesce(preview_offer_audience.target_purposes, '{}'));
  v_now timestamptz := now();
  v_status public.org_status;
  v_fingerprint text;
begin
  if not private.org_role_at_least(preview_offer_audience.org_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  select o.status into v_status
    from public.organizations o
   where o.id = preview_offer_audience.org_id;
  if v_status is distinct from 'verified' then
    raise exception 'org_not_verified';
  end if;
  perform private.assert_offer_args(
    v_event_name, v_description, v_reason_note, v_date_text, v_place,
    v_event_days, v_target_categories, v_target_purposes,
    preview_offer_audience.fee_per_event_yen, preview_offer_audience.capacity,
    preview_offer_audience.deadline
  );

  v_fingerprint := private.event_fingerprint(
    preview_offer_audience.org_id, v_event_name, v_date_text, v_place
  );

  select count(*)::integer, (count(*) filter (where a.limited))::integer
    into matched_count, limited_count
    from private.evaluate_offer_audience(
      v_target_categories, v_target_purposes, preview_offer_audience.intensity,
      v_event_days, preview_offer_audience.frequency,
      preview_offer_audience.fee_per_event_yen, preview_offer_audience.beginner_friendly,
      v_now
    ) a;
  deliverable_count := matched_count - limited_count;
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
  return next;
end;
$$;
revoke execute on function public.preview_offer_audience(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date
) from public;
revoke execute on function public.preview_offer_audience(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date
) from anon;
grant execute on function public.preview_offer_audience(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date
) to authenticated;

-- ---- F16: オファー送信（配信正本の作成。重複・0人・週枠では一切書き換えない） ----
-- 団体行をFOR UPDATEでロックし、同一団体の並行送信で週枠・再送禁止が破れないよう直列化する
create function public.send_offer(
  org_id uuid,
  event_name text,
  description text,
  reason_note text,
  date_text text,
  place text,
  event_days public.day_slot[],
  frequency public.frequency,
  fee_per_event_yen integer,
  beginner_friendly boolean,
  intensity public.activity_style,
  target_categories public.interest_category[],
  target_purposes public.purpose[],
  capacity integer,
  deadline date
)
returns table (
  delivery_id uuid,
  matched_count integer,
  limited_count integer,
  deliverable_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_name text := btrim(coalesce(send_offer.event_name, ''));
  v_description text := btrim(coalesce(send_offer.description, ''));
  v_reason_note text := btrim(coalesce(send_offer.reason_note, ''));
  v_date_text text := btrim(coalesce(send_offer.date_text, ''));
  v_place text := btrim(coalesce(send_offer.place, ''));
  v_event_days public.day_slot[] :=
    private.dedup_preserving_order(coalesce(send_offer.event_days, '{}'));
  v_target_categories public.interest_category[] :=
    private.dedup_preserving_order(coalesce(send_offer.target_categories, '{}'));
  v_target_purposes public.purpose[] :=
    private.dedup_preserving_order(coalesce(send_offer.target_purposes, '{}'));
  v_now timestamptz := now();
  v_org record;
  v_fingerprint text;
  v_sent_this_week integer;
  v_membership_id uuid;
  v_delivery_id uuid;
  v_matched integer;
  v_limited integer;
  v_deliverable integer;
begin
  if not private.org_role_at_least(send_offer.org_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  -- 週枠とfingerprint判定を並行送信から守るため団体行をロックする
  select o.status, o.name, o.description, o.contact_label, o.contact_handle
    into v_org
    from public.organizations o
   where o.id = send_offer.org_id
     for update;
  if v_org.status is distinct from 'verified' then
    raise exception 'org_not_verified';
  end if;
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

  -- 配信対象の評価は1回だけ実行し、同じ評価から件数と受信者snapshotを得る。
  -- 週上限の判定はこの文の開始時点snapshotに基づくため、今回の配信自身は数えない
  with audience as (
    select a.user_id, a.score, a.reasons, a.cautions, a.limited
    from private.evaluate_offer_audience(
      v_target_categories, v_target_purposes, send_offer.intensity,
      v_event_days, send_offer.frequency, send_offer.fee_per_event_yen,
      send_offer.beginner_friendly, v_now
    ) a
  ), inserted as (
    insert into private.offer_recipients (delivery_id, user_id, score, reasons, cautions)
    select v_delivery_id, audience.user_id, audience.score::smallint,
           audience.reasons, audience.cautions
    from audience
    where not audience.limited
    returning 1
  )
  select (select count(*) from audience)::integer,
         (select count(*) from audience where audience.limited)::integer,
         (select count(*) from inserted)::integer
    into v_matched, v_limited, v_deliverable;

  -- 0人配信は保存しない（Phase 1のno-recipientsと同じ。例外で全体をrollbackする）
  if v_deliverable = 0 then
    raise exception 'no_recipients';
  end if;

  delivery_id := v_delivery_id;
  matched_count := v_matched;
  limited_count := v_limited;
  deliverable_count := v_deliverable;
  return next;
end;
$$;
revoke execute on function public.send_offer(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date
) from public;
revoke execute on function public.send_offer(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date
) from anon;
grant execute on function public.send_offer(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date
) to authenticated;

-- ---- F17: 受信箱（学生本人の受信snapshotのみ。配信の新しい順） ----
create function public.list_my_inbox()
returns table (
  delivery_id uuid,
  delivered_at timestamptz,
  organization_id uuid,
  org_name text,
  org_description text,
  org_contact_label text,
  org_contact_handle text,
  event_name text,
  description text,
  reason_note text,
  date_text text,
  place text,
  event_days public.day_slot[],
  frequency public.frequency,
  fee_per_event_yen integer,
  beginner_friendly boolean,
  intensity public.activity_style,
  target_categories public.interest_category[],
  target_purposes public.purpose[],
  capacity integer,
  deadline date,
  score integer,
  reasons text[],
  cautions text[],
  read_at timestamptz,
  response_choice public.response_choice,
  responded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_current_student() then
    raise exception 'not_student';
  end if;

  return query
    select d.id,
           d.delivered_at,
           d.organization_id,
           d.org_name,
           d.org_description,
           -- D033: 公式窓口は「行ってみたい」を選んだ後にだけ開示する。
           -- UI側の出し分けだけではAPI応答に値が載るため、サーバー側でも伏せる。
           case when rs.choice = 'interested' then d.org_contact_label else '' end,
           case when rs.choice = 'interested' then d.org_contact_handle else '' end,
           d.event_name,
           d.description,
           d.reason_note,
           d.date_text,
           d.place,
           d.event_days,
           d.frequency,
           d.fee_per_event_yen,
           d.beginner_friendly,
           d.intensity,
           d.target_categories,
           d.target_purposes,
           d.capacity,
           d.deadline,
           r.score::integer,
           r.reasons,
           r.cautions,
           rd.read_at,
           rs.choice,
           rs.responded_at
      from private.offer_recipients r
      join private.offer_deliveries d on d.id = r.delivery_id
      left join private.offer_reads rd
        on rd.delivery_id = r.delivery_id and rd.user_id = r.user_id
      left join private.offer_responses rs
        on rs.delivery_id = r.delivery_id and rs.user_id = r.user_id
     where r.user_id = (select auth.uid())
     order by d.delivered_at desc, d.id asc;
end;
$$;
revoke execute on function public.list_my_inbox() from public;
revoke execute on function public.list_my_inbox() from anon;
grant execute on function public.list_my_inbox() to authenticated;

-- ---- F18: 既読の記録（受信者本人のみ。初回開封時刻を保持する冪等操作） ----
create function public.mark_offer_read(delivery_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_current_student() then
    raise exception 'not_student';
  end if;
  if not exists (
    select 1
    from private.offer_recipients r
    where r.delivery_id = mark_offer_read.delivery_id
      and r.user_id = (select auth.uid())
  ) then
    raise exception 'not_recipient';
  end if;

  -- ON CONFLICTの列指定はplpgsql引数名と衝突するため制約名で指定する
  insert into private.offer_reads (delivery_id, user_id)
  values (mark_offer_read.delivery_id, (select auth.uid()))
  on conflict on constraint offer_reads_pkey do nothing;
end;
$$;
revoke execute on function public.mark_offer_read(uuid) from public;
revoke execute on function public.mark_offer_read(uuid) from anon;
grant execute on function public.mark_offer_read(uuid) to authenticated;

-- ---- F19: 3段階返答（受信者本人のみ。(配信,学生)ごと1件へ上書き） ----
create function public.respond_to_offer(delivery_id uuid, choice public.response_choice)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_current_student() then
    raise exception 'not_student';
  end if;
  if respond_to_offer.choice is null then
    raise exception 'invalid_response';
  end if;
  if not exists (
    select 1
    from private.offer_recipients r
    where r.delivery_id = respond_to_offer.delivery_id
      and r.user_id = (select auth.uid())
  ) then
    raise exception 'not_recipient';
  end if;

  -- ON CONFLICTの列指定はplpgsql引数名と衝突するため制約名で指定する
  insert into private.offer_responses (delivery_id, user_id, choice)
  values (respond_to_offer.delivery_id, (select auth.uid()), respond_to_offer.choice)
  on conflict on constraint offer_responses_pkey do update set
    choice = excluded.choice,
    responded_at = now();
end;
$$;
revoke execute on function public.respond_to_offer(uuid, public.response_choice) from public;
revoke execute on function public.respond_to_offer(uuid, public.response_choice) from anon;
grant execute on function public.respond_to_offer(uuid, public.response_choice) to authenticated;

-- ---- F20: 団体のキャンペーン一覧+匿名ファネル（D022。個人単位の情報は返さない） ----
-- 配信=受信者数 / 閲覧=既読または返答のある受信者数 / 関心=interested・thinking /
-- 参加意向=interested。すべてstudent単位で重複排除した匿名件数
create function public.list_org_campaigns(org_id uuid)
returns table (
  delivery_id uuid,
  delivered_at timestamptz,
  event_name text,
  description text,
  reason_note text,
  date_text text,
  place text,
  event_days public.day_slot[],
  frequency public.frequency,
  fee_per_event_yen integer,
  beginner_friendly boolean,
  intensity public.activity_style,
  target_categories public.interest_category[],
  target_purposes public.purpose[],
  capacity integer,
  deadline date,
  delivered_count integer,
  viewed_count integer,
  engaged_count integer,
  planned_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(list_org_campaigns.org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select d.id,
           d.delivered_at,
           d.event_name,
           d.description,
           d.reason_note,
           d.date_text,
           d.place,
           d.event_days,
           d.frequency,
           d.fee_per_event_yen,
           d.beginner_friendly,
           d.intensity,
           d.target_categories,
           d.target_purposes,
           d.capacity,
           d.deadline,
           (
             select count(*)::integer
             from private.offer_recipients r
             where r.delivery_id = d.id
           ),
           (
             select count(*)::integer
             from (
               select rd.user_id
               from private.offer_reads rd
               where rd.delivery_id = d.id
               union
               select rs.user_id
               from private.offer_responses rs
               where rs.delivery_id = d.id
             ) viewers
           ),
           (
             select count(*)::integer
             from private.offer_responses rs
             where rs.delivery_id = d.id
               and rs.choice in ('interested', 'thinking')
           ),
           (
             select count(*)::integer
             from private.offer_responses rs
             where rs.delivery_id = d.id
               and rs.choice = 'interested'
           )
      from private.offer_deliveries d
     where d.organization_id = list_org_campaigns.org_id
     order by d.delivered_at desc, d.id asc;
end;
$$;
revoke execute on function public.list_org_campaigns(uuid) from public;
revoke execute on function public.list_org_campaigns(uuid) from anon;
grant execute on function public.list_org_campaigns(uuid) to authenticated;
