-- Task 009-T6 / Task 011: 団体ファネルの匿名集計（D022）・開示規則（D037）・PIIサーフェス（D029）
-- （配信⊇閲覧⊇関心⊇参加意向 / 既読なし返答も閲覧に数える / 学生単位で重複排除 /
--   10-5ルールでの抑制と丸め / 日次snapshotの安定 /
--   他団体のキャンペーン不可視 / 団体向けRPCに学生ID・PII列が存在しない）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000c01', 'demo-funnel-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000c05', 'demo-funnel-other@stu.kobe-u.ac.jp', now(), now(), now());
-- 学生12人（全員アウトドア受信・週上限5）。
-- Task 011でファネルは配信10人未満を非開示にするため、開示条件を満たす人数を置く（D037）
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000001' || to_char(n, 'FM00'))::uuid,
       'demo-funnel-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 12) as n;

insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-0000000001' || to_char(n, 'FM00'))::uuid
from generate_series(1, 12) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-0000000001' || to_char(n, 'FM00'))::uuid,
  array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 5
from generate_series(1, 12) as n;

-- c01の団体（verified）から1通送信・c05の別団体
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c01","role":"authenticated"}', true);
set local role authenticated;
create temp table forg as select public.create_organization('ファネルテスト団体') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from forg);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c01","role":"authenticated"}', true);
set local role authenticated;
create temp table fdelivery as
  select s.delivery_id as id from public.send_offer(
    (select id from forg), 'ファネル検証ハイク', '説明文', '理由', '9月13日（土）', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    12, '2026-09-11') s;
reset role;

-- 学生の行動: s1=既読2回+行ってみたい / s2=既読なしで保留 / s3〜s12=何もしない
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}', true);
set local role authenticated;
select public.mark_offer_read((select id from fdelivery));
select public.mark_offer_read((select id from fdelivery));
select public.respond_to_offer((select id from fdelivery), 'interested');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000102","role":"authenticated"}', true);
set local role authenticated;
select public.respond_to_offer((select id from fdelivery), 'thinking');
reset role;

-- ---- 団体担当者（c01）のファネル ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c01","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.list_org_campaigns((select id from forg))),
  1,
  'T6: 団体のキャンペーン一覧は1件'
);
-- 開示規則（10-5ルール・D037）: 配信12→10へ丸め、10未満のセルは数値を返さない
select is(
  (select (c.funnel_available, c.delivered_count, c.viewed_count, c.engaged_count, c.planned_count)::text
     from public.list_org_campaigns((select id from forg)) c),
  '(t,10,,,)',
  'T6: 配信12は10へ丸め、閲覧2・関心2・参加意向1は10未満のため抑制（NULL）'
);
reset role;

-- 生の集計（D022の導出規則）は snapshot 側で検査する。
-- 配信12 / 閲覧2（既読なし返答も数える・同一学生の二重既読は1） / 関心2 / 参加意向1
select is(
  (select (s.delivered_count, s.viewed_count, s.engaged_count, s.planned_count)::text
     from private.offer_funnel_snapshots s
    where s.delivery_id = (select id from fdelivery)),
  '(12,2,2,1)',
  'T6: 生のsnapshotは配信12・閲覧2（既読なし返答も数える）・関心2・参加意向1（D022）'
);

-- ---- 返答を変えても、同じ日のsnapshotは動かない（D037） ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}', true);
set local role authenticated;
select public.respond_to_offer((select id from fdelivery), 'skip');
reset role;
select is(
  (select (s.delivered_count, s.viewed_count, s.engaged_count, s.planned_count)::text
     from private.offer_funnel_snapshots s
    where s.delivery_id = (select id from fdelivery)),
  '(12,2,2,1)',
  'T6: 同じ日・同じofferのsnapshotは返答変更後も変わらない（リアルタイム更新しない）'
);

-- 翌日相当（当日snapshotを削除して再計算）では、変更後の値が反映される
delete from private.offer_funnel_snapshots
 where delivery_id = (select id from fdelivery);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c01","role":"authenticated"}', true);
set local role authenticated;
select public.list_org_campaigns((select id from forg));
reset role;
select is(
  (select (s.delivered_count, s.viewed_count, s.engaged_count, s.planned_count)::text
     from private.offer_funnel_snapshots s
    where s.delivery_id = (select id from fdelivery)),
  '(12,2,1,0)',
  'T6: 再計算されたsnapshotでは見送りへの変更が反映される（関心1・参加意向0・閲覧は不変）'
);

-- ---- 他団体のキャンペーンは見えない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c05","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.list_org_campaigns((select id from forg))$$,
  'P0001', 'not_authorized',
  'T6: 非メンバーは他団体のキャンペーン・ファネルを見られない'
);
reset role;

-- ---- PIIサーフェス（D029）: 団体向けRPCの引数・戻り列に学生ID・PII列が存在しない ----
select is(
  (select p.proargnames::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_org_campaigns'),
  '{org_id,delivery_id,delivered_at,event_name,description,reason_note,date_text,place,event_days,frequency,fee_per_event_yen,beginner_friendly,intensity,target_categories,target_purposes,capacity,deadline,funnel_available,delivered_count,viewed_count,engaged_count,planned_count,snapshot_date}',
  'T6: list_org_campaignsの戻り列はオファーsnapshotと抑制済み匿名件数のみ'
);
select is(
  (select p.proargnames::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'send_offer'),
  '{org_id,event_name,description,reason_note,date_text,place,event_days,frequency,fee_per_event_yen,beginner_friendly,intensity,target_categories,target_purposes,capacity,deadline,delivery_id,audience_band}',
  'T6: send_offerの戻りは配信IDと区分のみ（生の人数・受信者ID一覧を返さない・D036）'
);
select is(
  (select p.proargnames::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'preview_offer_audience'),
  '{org_id,event_name,description,reason_note,date_text,place,event_days,frequency,fee_per_event_yen,beginner_friendly,intensity,target_categories,target_purposes,capacity,deadline,audience_band,duplicate_event,sent_this_week,weekly_limit,preview_conditions_used,preview_conditions_limit,band_computed_at}',
  'T6: preview_offer_audienceの戻りは区分と団体自身の枠情報のみ（生の人数を返さない・D036）'
);
select is_empty(
  $$select column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = 'student_passports'
       and (column_name ~ 'email' or column_name ~ 'name' or column_name ~ 'phone'
            or column_name ~ 'photo' or column_name ~ 'gender' or column_name ~ 'nationality')$$,
  'T6: student_passportsに氏名・メール等のPII列が存在しない'
);
select is_empty(
  $$select p.proname::text from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(coalesce(p.proargnames, '{}')) as a(argname)
    where n.nspname = 'public'
      and p.proname in ('list_org_campaigns', 'send_offer', 'preview_offer_audience')
      and a.argname ~ '(user_id|email|student)'$$,
  'T6: 団体向けRPCの引数・戻り列名に学生識別子が現れない'
);

select * from finish();
rollback;
