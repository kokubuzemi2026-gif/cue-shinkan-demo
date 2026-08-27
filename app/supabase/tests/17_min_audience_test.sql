-- Task 011-T7: 配信の最小人数（k=5・D036）と入力検証・DoS（D039）
-- （0人 / 1〜4人 / 5人ちょうど / preview後に人数が減った場合 /
--   巨大payload・過大配列・NULL要素・空配列・重複の扱い）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000d001', 'demo-min-owner@stu.kobe-u.ac.jp', now(), now(), now());
-- 学生6人（全員アウトドア受信・週上限5）
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-00000000d1' || to_char(n, 'FM00'))::uuid,
       'demo-min-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-00000000d1' || to_char(n, 'FM00'))::uuid
from generate_series(1, 6) as n;
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select ('00000000-0000-0000-0000-00000000d1' || to_char(n, 'FM00'))::uuid,
  array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 5
from generate_series(1, 6) as n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
set local role authenticated;
create temp table morg as select public.create_organization('最小人数テスト団体') as id;
reset role;
update public.organizations set status = 'verified' where id = (select id from morg);

-- Task 011: 送信は24時間以内の同一条件previewを必須とする
create function pg_temp.try_send(ev text, dt text, pl text)
returns table (delivery_id uuid, audience_band text)
language plpgsql
as $$
begin
  perform public.preview_offer_audience(
    (select id from morg), ev, '説明文', '届けたい理由', dt, pl,
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    10, '2026-09-10');
  return query select * from public.send_offer(
    (select id from morg), ev, '説明文', '届けたい理由', dt, pl,
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    10, '2026-09-10');
end
$$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;

-- ---- 0人（対象カテゴリに誰も該当しない） ----
select lives_ok(
  $$select public.preview_offer_audience(
      (select id from morg), '音楽会', '説明文', '理由', '9月13日（土）', '大学会館',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array['music']::public.interest_category[], array['creation']::public.purpose[],
      10, '2026-09-10')$$,
  'T7: 0人の条件でもpreviewは通る（区分0を返す）'
);
select throws_ok(
  $$select * from public.send_offer(
      (select id from morg), '音楽会', '説明文', '理由', '9月13日（土）', '大学会館',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array['music']::public.interest_category[], array['creation']::public.purpose[],
      10, '2026-09-10')$$,
  'P0001', 'no_recipients',
  'T7: 対象0人の送信は no_recipients で拒否される'
);
reset role;

-- ---- 1〜4人（匿名性不足） ----
-- 6人のうち4人だけを残し、2人の受信を停止する
update public.student_passports set reception_paused = true
 where user_id in (
   '00000000-0000-0000-0000-00000000d105'::uuid,
   '00000000-0000-0000-0000-00000000d106'::uuid
 );
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from pg_temp.try_send('4人ハイク', '9月13日（土）', '六甲ケーブル下')$$,
  'P0001', 'insufficient_audience',
  'T7: 配信可能4人の送信は insufficient_audience で拒否される（k=5・D036）'
);
select is(
  (select s.audience_band from public.preview_offer_audience(
     (select id from morg), '4人ハイク', '説明文', '理由', '9月13日（土）', '六甲ケーブル下',
     array['weekend']::public.day_slot[], 'monthly_1_2', 1400, true, 'moderate',
     array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
     10, '2026-09-10') s),
  '1-4',
  'T7: 4人のpreviewは区分 1-4 を返す（参加費1400の条件）'
);
reset role;
select is(
  (select count(*)::int from private.offer_deliveries d where d.organization_id = (select id from morg)),
  0,
  'T7: insufficient_audienceの送信で配信行が残らない（原子的rollback）'
);
select is(
  (select coalesce(sum(q.window_count), 0)::int from private.student_delivery_quota q),
  0,
  'T7: 拒否された送信でquotaだけが消費されて残ることがない'
);

-- ---- 5人ちょうど（境界） ----
update public.student_passports set reception_paused = false
 where user_id = '00000000-0000-0000-0000-00000000d105'::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select s.audience_band from pg_temp.try_send('5人ハイク', '9月13日（土）', '六甲ケーブル下') s),
  '5-9',
  'T7: 配信可能5人ちょうどの送信は成立する（境界）'
);
reset role;
select is(
  (select count(*)::int from private.offer_recipients r
    join private.offer_deliveries d on d.id = r.delivery_id
   where d.organization_id = (select id from morg)),
  5,
  'T7: 5人へ配信された受信者行が保存される'
);

-- ---- preview後に人数が減っても基準を破れない（送信時点でサーバーが再計算する） ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select s.audience_band from public.preview_offer_audience(
     (select id from morg), '後で減る会', '説明文', '理由', '9月20日（土）', '再度公園',
     array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
     array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
     10, '2026-09-18') s),
  '5-9',
  'T7: preview時点では5人（5-9）'
);
reset role;
-- previewの後で1人が受信を停止する
update public.student_passports set reception_paused = true
 where user_id = '00000000-0000-0000-0000-00000000d105'::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from pg_temp.try_send('後で減る会', '9月20日（土）', '再度公園')$$,
  'P0001', 'insufficient_audience',
  'T7: previewが5-9でも、送信時点で4人なら拒否される（サーバー側で再計算・D036）'
);

-- ---- 入力検証・DoS（D039） ----
select throws_ok(
  $$select * from pg_temp.try_send(repeat('a', 4001), '9月21日', 'どこか')$$,
  'P0001', 'payload_too_large',
  'T7: 4000バイトを超える文字列はマッチング計算より前に拒否される'
);
select throws_ok(
  $$select * from public.send_offer(
      (select id from morg), 'X', repeat('b', 100000), '理由', '9月21日', 'どこか',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
      10, '2026-09-10')$$,
  'P0001', 'payload_too_large',
  'T7: 巨大payload（100KB）は payload_too_large で拒否される'
);
select throws_ok(
  $$select * from public.send_offer(
      (select id from morg), 'X', '説明文', '理由', '9月21日', 'どこか',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      (select array_agg('outdoor'::public.interest_category) from generate_series(1, 65)),
      array['friends']::public.purpose[], 10, '2026-09-10')$$,
  'P0001', 'payload_too_large',
  'T7: 65要素の配列は重複除去より前に拒否される'
);
select throws_ok(
  $$select * from public.send_offer(
      (select id from morg), 'X', '説明文', '理由', '9月21日', 'どこか',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array[null]::public.interest_category[], array['friends']::public.purpose[],
      10, '2026-09-10')$$,
  'P0001', 'invalid_offer',
  'T7: 配列内のNULL要素は拒否される（重複除去で畳まれてすり抜けない）'
);
select throws_ok(
  $$select * from public.send_offer(
      (select id from morg), 'X', '説明文', '理由', '9月21日', 'どこか',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array[]::public.interest_category[], array['friends']::public.purpose[],
      10, '2026-09-10')$$,
  'P0001', 'invalid_offer',
  'T7: 空配列は拒否される'
);
select throws_ok(
  $$select * from public.send_offer(
      (select id from morg), 'X', '説明文', '理由', '9月21日', 'どこか',
      array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
      10, null)$$,
  'P0001', 'invalid_offer',
  'T7: 必須項目のNULLは拒否される'
);
select throws_ok(
  $$select * from pg_temp.try_send(repeat('a', 101), '9月21日', 'どこか')$$,
  'P0001', 'invalid_offer',
  'T7: 101文字のイベント名は意味的な検証で拒否される（境界+1）'
);
reset role;

-- 重複要素は正規化され、配点操作に使えない（同じ目的を4回指定しても1件として扱う）
update public.student_passports set reception_paused = false
 where user_id = '00000000-0000-0000-0000-00000000d105'::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.preview_offer_audience(
      (select id from morg), '重複指定会', '説明文', '理由', '9月28日（日）', '摩耶山',
      array['weekend','weekend','weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array['outdoor','outdoor']::public.interest_category[],
      array['friends','friends','friends','friends']::public.purpose[], 10, '2026-09-26');
    select * from public.send_offer(
      (select id from morg), '重複指定会', '説明文', '理由', '9月28日（日）', '摩耶山',
      array['weekend','weekend','weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
      array['outdoor','outdoor']::public.interest_category[],
      array['friends','friends','friends','friends']::public.purpose[], 10, '2026-09-26')$$,
  'T7: 重複要素を含む送信は正規化されて成立する'
);
reset role;
select is(
  (select (d.event_days, d.target_categories, d.target_purposes)::text
     from private.offer_deliveries d
    where d.organization_id = (select id from morg) and d.event_name = '重複指定会'),
  '({weekend},{outdoor},{friends})',
  'T7: 保存された配列は重複除去済み（配点操作に使えない）'
);
select ok(
  (select cardinality(private.dedup_preserving_order(
     array['friends','friends','challenge','friends']::public.purpose[])) = 2),
  'T7: 重複除去は先頭出現順を保ったまま件数を正規化する'
);

select * from finish();
rollback;
