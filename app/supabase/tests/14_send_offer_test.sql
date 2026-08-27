-- Task 009-T4: オファー送信の権限・週枠・再送禁止・原子性
-- （admin以上+verified団体のみ送信可 / 団体週3枠 / fingerprint再送拒否 /
--   学生週上限で0人になる送信は保存されない / 入力検証）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000a01', 'demo-send-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000a02', 'demo-send-pending@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000a03', 'demo-send-outsider@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000a04', 'demo-send-member@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000a05', 'demo-send-student@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000a06', 'demo-send-student2@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000a07', 'demo-send-student3@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000a08', 'demo-send-student4@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000a09', 'demo-send-student5@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000a10', 'demo-send-student6@stu.kobe-u.ac.jp', now(), now(), now());

-- 学生6人（週上限3・アウトドア受信）。
-- Task 011で配信可能人数の下限が5人になったため、送信が成立する条件を満たす人数を置く（D036）
insert into public.student_accounts (user_id)
select u.id from (values
  ('00000000-0000-0000-0000-000000000a05'::uuid), ('00000000-0000-0000-0000-000000000a06'::uuid),
  ('00000000-0000-0000-0000-000000000a07'::uuid), ('00000000-0000-0000-0000-000000000a08'::uuid),
  ('00000000-0000-0000-0000-000000000a09'::uuid), ('00000000-0000-0000-0000-000000000a10'::uuid)
) as u(id);
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select u.id,
  array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 3
from (values
  ('00000000-0000-0000-0000-000000000a05'::uuid), ('00000000-0000-0000-0000-000000000a06'::uuid),
  ('00000000-0000-0000-0000-000000000a07'::uuid), ('00000000-0000-0000-0000-000000000a08'::uuid),
  ('00000000-0000-0000-0000-000000000a09'::uuid), ('00000000-0000-0000-0000-000000000a10'::uuid)
) as u(id);

-- a01の団体（verified化）・a02の団体（pendingのまま）
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
set local role authenticated;
create temp table org1 as select public.create_organization('送信テスト団体') as id;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a02","role":"authenticated"}', true);
set local role authenticated;
create temp table org2 as select public.create_organization('審査待ち団体') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from org1);
-- a04をorg1のmemberとして追加（運営相当のpostgres操作）
insert into public.organization_memberships (organization_id, user_id, role, member_label)
select id, '00000000-0000-0000-0000-000000000a04', 'member', '担当者-SENDM1' from org1;

-- 送信引数を組み立てる補助（イベント名・日時・場所だけ差し替える）
-- Task 011: 送信は24時間以内の同一条件previewを必須とするため、送信前にpreviewを通す
create function pg_temp.try_send(org uuid, ev text, dt text, pl text)
returns table (delivery_id uuid, audience_band text)
language plpgsql
as $$
begin
  perform public.preview_offer_audience(
    org, ev, '説明文', '届けたい理由', dt, pl,
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    10, '2026-09-10');
  return query select * from public.send_offer(
    org, ev, '説明文', '届けたい理由', dt, pl,
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    10, '2026-09-10');
end
$$;

-- ---- 権限外の送信 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a03","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from pg_temp.try_send((select id from org1), 'X', 'D', 'P')$$,
  'P0001', 'not_authorized',
  'T4: 非メンバーは送信できない'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a04","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from pg_temp.try_send((select id from org1), 'X', 'D', 'P')$$,
  'P0001', 'not_authorized',
  'T4: memberロールは送信できない（owner/adminのみ）'
);
select throws_ok(
  $$select * from public.preview_offer_audience(
      (select id from org1), 'X', 'D', 'R', 'DT', 'P',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[], 10, '2026-09-10')$$,
  'P0001', 'not_authorized',
  'T4: memberロールはプレビューもできない'
);
select throws_ok(
  $$select public.update_organization_contact((select id from org1), '公式', '@x')$$,
  'P0001', 'not_authorized',
  'T4: memberロールは公式窓口を変更できない'
);
select lives_ok(
  $$select * from public.list_org_campaigns((select id from org1))$$,
  'T4: memberロールはキャンペーン一覧を閲覧できる'
);
reset role;

-- ---- pending団体は送信できない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a02","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from pg_temp.try_send((select id from org2), 'X', 'D', 'P')$$,
  'P0001', 'org_not_verified',
  'T4: 審査待ち（pending）団体は送信できない'
);
reset role;

-- ---- owner（a01）の送信 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select s.audience_band
     from public.preview_offer_audience(
       (select id from org1), '六甲山ハイク', '説明文', '理由', '9月13日（土）', '六甲ケーブル下',
       array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
       array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
       10, '2026-09-10') s),
  '5-9',
  'T4: プレビューは区分のみを返す（6人マッチ → 5-9・D036）'
);
select is(
  (select s.audience_band
     from pg_temp.try_send((select id from org1), '六甲山ハイク', '9月13日（土）', '六甲ケーブル下') s),
  '5-9',
  'T4: 1通目の送信が成立する（戻りは区分のみ）'
);
select throws_ok(
  $$select * from pg_temp.try_send((select id from org1), '六甲山　ハイク', '9月13日 （土）', '六甲ケーブル下 ')$$,
  'P0001', 'duplicate_event',
  'T4: 空白・全角ゆれの同一イベントは再送拒否（D023）'
);
select lives_ok(
  $$select * from pg_temp.try_send((select id from org1), 'テント泊体験会', '9月20日（土）', '北テラス広場')$$,
  'T4: 2通目（別イベント）は送信できる'
);
select lives_ok(
  $$select * from pg_temp.try_send((select id from org1), '沢歩き入門', '9月21日（日）', '住吉川')$$,
  'T4: 3通目（別イベント）は送信できる'
);
select throws_ok(
  $$select * from pg_temp.try_send((select id from org1), '夜景ハイク', '9月22日（祝）', '摩耶山')$$,
  'P0001', 'weekly_limit_reached',
  'T4: 週3キャンペーンを超える4通目は拒否（D021）'
);
select throws_ok(
  $$select * from pg_temp.try_send((select id from org1), '', '9月23日', 'どこか')$$,
  'P0001', 'invalid_offer',
  'T4: イベント名が空の送信は拒否'
);

reset role;

-- 団体表示snapshotが配信行へ固定されている（対照はpostgresで読む）
select is(
  (select d.org_name from private.offer_deliveries d
    where d.organization_id = (select id from org1)
    order by d.id limit 1),
  '送信テスト団体',
  'T4: 配信行に団体名snapshotが保存される'
);

-- ---- 学生の週上限で配信0人になる送信は保存されない ----
-- a01が別団体org3を作成しverified化。学生a05は既に週3件受信済みのため配信0人
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
set local role authenticated;
create temp table org3 as select public.create_organization('第二アウトドア会') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from org3);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from pg_temp.try_send((select id from org3), '別団体のハイク', '9月27日（日）', '再度公園')$$,
  'P0001', 'no_recipients',
  'T4: 週上限（学生3件・6人全員）到達で配信0人の送信は保存されない'
);
reset role;
select is(
  (select count(*)::int from private.offer_deliveries d where d.organization_id = (select id from org3)),
  0,
  'T4: no_recipientsの送信で配信行が残らない（原子的rollback）'
);

-- ---- suspended団体は送信できない ----
update public.organizations set status = 'suspended' where id = (select id from org1);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from pg_temp.try_send((select id from org1), '停止後イベント', '10月4日（日）', '摩耶山')$$,
  'P0001', 'org_not_verified',
  'T4: suspended団体は送信できない'
);
reset role;

select * from finish();
rollback;
