-- Task 013 (2/2): 運営専用RPCと、停止したオファーの受信箱表示
-- 正本: docs/operations.md / docs/decisions.md D043〜D045
--
-- 権限: すべて **service_role専用**。authenticated・anonへは一切grantしない。
-- クライアントから団体状態を変える経路は存在しない（D026の原則を維持）。

-- ---- 停止した案内の未送信メールを取り消す（Task 010の送信待ち行） ----
-- offer_arrivalのdedupe_keyは配信ID。まとめ（daily_digest）は複数の案内をまとめた
-- 1行で、どの案内を含むかを保持しない設計のため取り消さない。
-- まとめの本文は「受信箱に新しい案内があります」だけで団体名・イベント名を含まず、
-- 受信箱では停止済みの案内が「募集終了」と表示されるため、誤解を生まない
create function private.cancel_offer_mail(target_delivery_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  update private.email_outbox o
     set status = 'cancelled',
         updated_at = now()
   where o.kind = 'offer_arrival'
     and o.dedupe_key = target_delivery_id::text
     and o.status = 'pending';
$$;
revoke execute on function private.cancel_offer_mail(uuid) from public;
revoke execute on function private.cancel_offer_mail(uuid) from anon;
revoke execute on function private.cancel_offer_mail(uuid) from authenticated;

-- ---- F25: 団体状態の変更（確認・停止・再開） ----
create function public.admin_set_organization_status(
  org_id uuid,
  new_status public.org_status,
  actor_label text,
  reason text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous public.org_status;
begin
  if new_status is null or actor_label is null or char_length(btrim(actor_label)) = 0 then
    raise exception 'invalid_admin_action';
  end if;

  select o.status into v_previous
    from public.organizations o
   where o.id = admin_set_organization_status.org_id
     for update;
  if v_previous is null then
    raise exception 'organization_not_found';
  end if;

  update public.organizations o
     set status = admin_set_organization_status.new_status
   where o.id = admin_set_organization_status.org_id;

  -- verified から外したら、その団体の配信中オファーもまとめて止める。
  -- 「誤配信・不正利用時に止められる」ためには、新規配信の遮断だけでは足りない。
  -- suspended だけでなく pending へ戻す場合も止めるのは、運営が「疑わしいので
  -- 審査中へ戻す」操作をしたときに配信済みの案内が生き続け、学生が返答でき
  -- 公式窓口まで開示され続けるのを防ぐため（独立レビューL2）。
  -- 「確認済みでない団体の案内は届いたままにしない」を一貫させる
  if admin_set_organization_status.new_status <> 'verified' then
    update private.offer_deliveries d
       set stopped_at = now(),
           stopped_reason = coalesce(admin_set_organization_status.reason, '団体の確認状態の変更に伴う停止')
     where d.organization_id = admin_set_organization_status.org_id
       and d.stopped_at is null;

    -- 止めた案内の未送信メールを取り消す（Task 010の送信待ち行）。
    -- 止めた直後に「新しい案内が届きました」を送ってしまうのを防ぐ
    perform private.cancel_offer_mail(d.id)
       from private.offer_deliveries d
      where d.organization_id = admin_set_organization_status.org_id;
  end if;

  insert into private.admin_audit_log (
    action, target_organization_id, actor_label, reason, previous_value, new_value
  )
  values (
    'organization_status_changed', admin_set_organization_status.org_id,
    btrim(admin_set_organization_status.actor_label),
    admin_set_organization_status.reason, v_previous::text,
    admin_set_organization_status.new_status::text
  );
end;
$$;
revoke execute on function public.admin_set_organization_status(uuid, public.org_status, text, text) from public;
revoke execute on function public.admin_set_organization_status(uuid, public.org_status, text, text) from anon;
revoke execute on function public.admin_set_organization_status(uuid, public.org_status, text, text) from authenticated;
grant execute on function public.admin_set_organization_status(uuid, public.org_status, text, text) to service_role;

-- ---- F26: 個別オファーの停止・再開 ----
create function public.admin_set_offer_stopped(
  delivery_id uuid,
  stopped boolean,
  actor_label text,
  reason text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if stopped is null or actor_label is null or char_length(btrim(actor_label)) = 0 then
    raise exception 'invalid_admin_action';
  end if;

  select d.organization_id into v_org
    from private.offer_deliveries d
   where d.id = admin_set_offer_stopped.delivery_id
     for update;
  if v_org is null then
    raise exception 'delivery_not_found';
  end if;

  update private.offer_deliveries d
     set stopped_at = case when admin_set_offer_stopped.stopped then now() else null end,
         stopped_reason = case when admin_set_offer_stopped.stopped
                               then admin_set_offer_stopped.reason else null end
   where d.id = admin_set_offer_stopped.delivery_id;

  if admin_set_offer_stopped.stopped then
    perform private.cancel_offer_mail(admin_set_offer_stopped.delivery_id);
  end if;

  insert into private.admin_audit_log (
    action, target_organization_id, target_delivery_id, actor_label, reason
  )
  values (
    case when admin_set_offer_stopped.stopped then 'offer_stopped' else 'offer_resumed' end,
    v_org, admin_set_offer_stopped.delivery_id,
    btrim(admin_set_offer_stopped.actor_label), admin_set_offer_stopped.reason
  );
end;
$$;
revoke execute on function public.admin_set_offer_stopped(uuid, boolean, text, text) from public;
revoke execute on function public.admin_set_offer_stopped(uuid, boolean, text, text) from anon;
revoke execute on function public.admin_set_offer_stopped(uuid, boolean, text, text) from authenticated;
grant execute on function public.admin_set_offer_stopped(uuid, boolean, text, text) to service_role;

-- ---- F27: 緊急停止（kill switch） ----
create function public.admin_set_delivery_paused(
  paused boolean,
  actor_label text,
  reason text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if paused is null or actor_label is null or char_length(btrim(actor_label)) = 0 then
    raise exception 'invalid_admin_action';
  end if;

  update private.platform_controls c
     set delivery_paused = admin_set_delivery_paused.paused,
         paused_reason = case when admin_set_delivery_paused.paused
                              then admin_set_delivery_paused.reason else null end,
         updated_at = now()
   where c.id;

  insert into private.admin_audit_log (action, actor_label, reason, new_value)
  values (
    case when admin_set_delivery_paused.paused then 'delivery_paused' else 'delivery_resumed' end,
    btrim(admin_set_delivery_paused.actor_label),
    admin_set_delivery_paused.reason,
    admin_set_delivery_paused.paused::text
  );
end;
$$;
comment on function public.admin_set_delivery_paused(boolean, text, text) is
  '全団体の配信を1操作で止める・戻す（D045）。判定はoffer_deliveriesの挿入トリガが行う';
revoke execute on function public.admin_set_delivery_paused(boolean, text, text) from public;
revoke execute on function public.admin_set_delivery_paused(boolean, text, text) from anon;
revoke execute on function public.admin_set_delivery_paused(boolean, text, text) from authenticated;
grant execute on function public.admin_set_delivery_paused(boolean, text, text) to service_role;

-- ---- F28: 監査記録の閲覧（運営専用） ----
create function public.admin_list_audit(max_rows integer default 100)
returns table (
  action text,
  target_organization_id uuid,
  target_delivery_id uuid,
  actor_label text,
  reason text,
  previous_value text,
  new_value text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if max_rows is null or max_rows not between 1 and 1000 then
    raise exception 'invalid_admin_action';
  end if;
  return query
    select a.action, a.target_organization_id, a.target_delivery_id, a.actor_label,
           a.reason, a.previous_value, a.new_value, a.created_at
      from private.admin_audit_log a
     order by a.created_at desc, a.id desc
     limit max_rows;
end;
$$;
revoke execute on function public.admin_list_audit(integer) from public;
revoke execute on function public.admin_list_audit(integer) from anon;
revoke execute on function public.admin_list_audit(integer) from authenticated;
grant execute on function public.admin_list_audit(integer) to service_role;

-- ---- 受信箱に「停止済み」を反映する（D044） ----
-- 停止しても受信箱から消さない。消すと「何が起きたか分からない」ため、
-- 募集終了として残し、返答導線だけを閉じる
drop function public.list_my_inbox();

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
  responded_at timestamptz,
  stopped boolean
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
           -- 停止されたオファーでは、既に開示済みでも窓口を返さない
           case when rs.choice = 'interested' and d.stopped_at is null
                then d.org_contact_label else '' end,
           case when rs.choice = 'interested' and d.stopped_at is null
                then d.org_contact_handle else '' end,
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
           rs.responded_at,
           (d.stopped_at is not null)
      from private.offer_recipients r
      join private.offer_deliveries d on d.id = r.delivery_id
      left join private.offer_reads rd on rd.delivery_id = r.delivery_id and rd.user_id = r.user_id
      left join private.offer_responses rs on rs.delivery_id = r.delivery_id and rs.user_id = r.user_id
     where r.user_id = (select auth.uid())
     order by d.delivered_at desc, d.id asc;
end;
$$;
revoke execute on function public.list_my_inbox() from public;
revoke execute on function public.list_my_inbox() from anon;
grant execute on function public.list_my_inbox() to authenticated;

-- 停止されたオファーへは返答できない（返答導線を閉じる）
create or replace function public.respond_to_offer(
  delivery_id uuid,
  choice public.response_choice
)
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
  -- D044: 停止したオファーは受信箱に残すが、返答導線だけを閉じる
  if exists (
    select 1
    from private.offer_deliveries d
    where d.id = respond_to_offer.delivery_id
      and d.stopped_at is not null
  ) then
    raise exception 'offer_stopped';
  end if;

  -- ON CONFLICTの列指定はplpgsql引数名と衝突するため制約名で指定する
  insert into private.offer_responses (delivery_id, user_id, choice)
  values (respond_to_offer.delivery_id, (select auth.uid()), respond_to_offer.choice)
  on conflict on constraint offer_responses_pkey do update set
    choice = excluded.choice,
    responded_at = now();
end;
$$;

-- ---- 団体側にも自分のオファーの停止状態を見せる（D044） ----
-- 止められた側が「なぜ反応が止まったのか」を分からないままにしない。
-- 停止理由の本文は返さない（運営の内部記述であり、団体へ開示する前提の欄ではない）
drop function public.list_org_campaigns(uuid);

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
  funnel_available boolean,
  delivered_count integer,
  viewed_count integer,
  engaged_count integer,
  planned_count integer,
  snapshot_date date,
  stopped boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if not private.is_org_member(list_org_campaigns.org_id) then
    raise exception 'not_authorized';
  end if;

  perform private.ensure_funnel_snapshots(list_org_campaigns.org_id, v_today);

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
           -- 配信人数が10人未満のofferは、どのセルも開示しない
           coalesce(s.delivered_count >= 10, false) as funnel_available,
           case when s.delivered_count >= 10
                then private.round_to_base5(s.delivered_count) end,
           case when s.delivered_count >= 10 and s.viewed_count >= 10
                then private.round_to_base5(s.viewed_count) end,
           case when s.delivered_count >= 10 and s.engaged_count >= 10
                then private.round_to_base5(s.engaged_count) end,
           case when s.delivered_count >= 10 and s.planned_count >= 10
                then private.round_to_base5(s.planned_count) end,
           coalesce(s.snapshot_date, v_today),
           (d.stopped_at is not null)
      from private.offer_deliveries d
      -- snapshotの確定（ensure_funnel_snapshots）とこの問い合わせは別の文であり、
      -- その間に他トランザクションがcommitした配信にはまだsnapshotが無い。
      -- INNER JOINだとその配信が一覧から消えるためLEFT JOINにし、
      -- snapshotが無い行は「集計に必要な人数未満」と同じ扱い（全セル非開示）で返す
      left join private.offer_funnel_snapshots s
        on s.delivery_id = d.id
       and s.snapshot_date = v_today
     where d.organization_id = list_org_campaigns.org_id
     order by d.delivered_at desc, d.id asc;
end;
$$;
comment on function public.list_org_campaigns(uuid) is
  'キャンペーン一覧と匿名ファネル。10人未満は非開示・各セル10未満は抑制・開示値は5人単位（D022・D037）。停止状態も返す（D044）';
revoke execute on function public.list_org_campaigns(uuid) from public;
revoke execute on function public.list_org_campaigns(uuid) from anon;
grant execute on function public.list_org_campaigns(uuid) to authenticated;
