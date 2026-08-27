-- Task 011 (3/3): 団体ファネルの抑制・丸め・日次snapshot
-- 正本: docs/launch_plan.md §4.3 / docs/decisions.md D022・D037
--
-- 英国ONSの10-5ルールを参考にした開示規則（法令準拠を主張するものではない・D037）:
-- - 配信人数が10人未満のofferはファネルを一切開示しない
-- - 10人以上でも、各セルが10未満なら数値を返さずNULL（suppressed）にする
-- - 開示する数値は5人単位へ丸める
-- - パーセントは返さない（抑制値を逆算できるため）
-- - 同じ日・同じofferには常に同じsnapshotを返す（日中の返答増加で数値が動かない）

drop function public.list_org_campaigns(uuid);

-- ---- 当日snapshotの確定（list_org_campaignsのOUTパラメータ名と衝突しないよう関数を分ける） ----
create function private.ensure_funnel_snapshots(target_org_id uuid, snapshot_day date)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into private.offer_funnel_snapshots (
    delivery_id, snapshot_date, delivered_count, viewed_count, engaged_count, planned_count
  )
  select d.id,
         snapshot_day,
         (
           select count(*)::integer
           from private.offer_recipients r
           where r.delivery_id = d.id
         ),
         (
           select count(*)::integer
           from (
             select rd.user_id from private.offer_reads rd where rd.delivery_id = d.id
             union
             select rs.user_id from private.offer_responses rs where rs.delivery_id = d.id
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
   where d.organization_id = target_org_id
  on conflict (delivery_id, snapshot_date) do nothing
$$;
comment on function private.ensure_funnel_snapshots(uuid, date) is
  '当日のファネルsnapshotが無いofferだけ1回だけ確定する。並行呼出しでは先勝ち（do nothing）';
revoke execute on function private.ensure_funnel_snapshots(uuid, date) from public;
revoke execute on function private.ensure_funnel_snapshots(uuid, date) from anon;
revoke execute on function private.ensure_funnel_snapshots(uuid, date) from authenticated;

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
  snapshot_date date
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
           (s.delivered_count >= 10) as funnel_available,
           case when s.delivered_count >= 10
                then private.round_to_base5(s.delivered_count) end,
           case when s.delivered_count >= 10 and s.viewed_count >= 10
                then private.round_to_base5(s.viewed_count) end,
           case when s.delivered_count >= 10 and s.engaged_count >= 10
                then private.round_to_base5(s.engaged_count) end,
           case when s.delivered_count >= 10 and s.planned_count >= 10
                then private.round_to_base5(s.planned_count) end,
           s.snapshot_date
      from private.offer_deliveries d
      join private.offer_funnel_snapshots s
        on s.delivery_id = d.id
       and s.snapshot_date = v_today
     where d.organization_id = list_org_campaigns.org_id
     order by d.delivered_at desc, d.id asc;
end;
$$;
comment on function public.list_org_campaigns(uuid) is
  'キャンペーン一覧と匿名ファネル。10人未満は非開示・各セル10未満は抑制・開示値は5人単位（D022・D037）';
revoke execute on function public.list_org_campaigns(uuid) from public;
revoke execute on function public.list_org_campaigns(uuid) from anon;
grant execute on function public.list_org_campaigns(uuid) to authenticated;
