-- Task 011 (2/3): オファーpreview・送信の匿名性と並行安全性
-- 正本: docs/launch_plan.md §4 / docs/decisions.md D036-D039
--
-- 変更点:
-- - preview は生の対象人数を返さず区分（6値）だけを返す。同一条件は24時間固定、
--   団体単位でrolling 24時間あたり20条件まで（D036・D038）
-- - send は配信可能人数が5人未満なら拒否する。判定は送信時点でサーバーが再計算する（D036）
-- - 学生の週間受信枠を専用テーブルの行ロックで確保し、団体をまたぐ並行配信でも破れない（D037）
-- - 入力の早期検証を、マッチング計算より前に置く（D039）

-- 旧シグネチャを置き換える（戻り値の列が変わるためcreate or replace不可）
drop function public.preview_offer_audience(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date
);
drop function public.send_offer(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date
);

-- ---- F15': 対象規模のpreview（区分のみ・24時間固定・条件数制限） ----
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
  audience_band text,
  duplicate_event boolean,
  sent_this_week integer,
  weekly_limit integer,
  preview_conditions_used integer,
  preview_conditions_limit integer,
  band_computed_at timestamptz
)
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
comment on function public.preview_offer_audience(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date) is
  '対象規模の区分preview。生の人数は返さない。同一条件24時間固定・rolling 24時間20条件まで（D036・D038）';
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

-- ---- F16': オファー送信（最小5人・週枠の原子的確保） ----
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
  audience_band text
)
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
  audience_band := private.audience_band(v_deliverable);
  return next;
end;
$$;
comment on function public.send_offer(
  uuid, text, text, text, text, text, public.day_slot[], public.frequency, integer,
  boolean, public.activity_style, public.interest_category[], public.purpose[], integer, date) is
  'オファー配信。配信可能5人未満は拒否し、学生の週枠を専用テーブルの行ロックで原子的に確保する（D036・D037）';
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
