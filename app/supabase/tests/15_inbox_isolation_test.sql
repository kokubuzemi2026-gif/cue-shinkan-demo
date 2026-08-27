-- Task 009-T5: 受信箱の分離・既読・返答
-- （受信者本人だけが自分の受信を読める / 非受信者の既読・返答は拒否 /
--   既読は初回時刻を保持 / 返答は上書き / snapshotは団体編集後も不変・D023）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000b01', 'demo-inbox-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000b02', 'demo-inbox-a@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000b03', 'demo-inbox-b@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000b04', 'demo-inbox-c@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000b05', 'demo-inbox-d@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000b06', 'demo-inbox-e@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000b07', 'demo-inbox-f@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000b08', 'demo-inbox-g@stu.kobe-u.ac.jp', now(), now(), now());

-- 学生: b02とb04〜b08はアウトドア受信（計6人＝Task 011の最小5人を満たす・D036）、
-- b03は音楽のみ受信（オファー対象外）
insert into public.student_accounts (user_id) values
  ('00000000-0000-0000-0000-000000000b02'),
  ('00000000-0000-0000-0000-000000000b03'),
  ('00000000-0000-0000-0000-000000000b04'),
  ('00000000-0000-0000-0000-000000000b05'),
  ('00000000-0000-0000-0000-000000000b06'),
  ('00000000-0000-0000-0000-000000000b07'),
  ('00000000-0000-0000-0000-000000000b08');
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
) values
  ('00000000-0000-0000-0000-000000000b02',
   array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
   'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
   2000, false, array['outdoor']::public.interest_category[], 3),
  ('00000000-0000-0000-0000-000000000b03',
   array['music']::public.interest_category[], array['creation']::public.purpose[],
   'relaxed', 'weekly_1', array['weekday_night']::public.day_slot[], 'some',
   1000, false, array['music']::public.interest_category[], 3);
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
)
select u.id,
  array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
  'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
  2000, false, array['outdoor']::public.interest_category[], 3
from (values
  ('00000000-0000-0000-0000-000000000b04'::uuid), ('00000000-0000-0000-0000-000000000b05'::uuid),
  ('00000000-0000-0000-0000-000000000b06'::uuid), ('00000000-0000-0000-0000-000000000b07'::uuid),
  ('00000000-0000-0000-0000-000000000b08'::uuid)
) as u(id);

-- b01の団体（verified・公式窓口つき）から送信
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
set local role authenticated;
create temp table borg as select public.create_organization('受信箱テスト団体', '説明文') as id;
reset role;
update public.organizations
   set status = 'verified', contact_label = '公式Instagram', contact_handle = '@inbox_test'
 where id = (select id from borg);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);
set local role authenticated;
-- Task 011: 送信前に同一条件のpreviewを通す（24時間以内のpreviewが必須）
select public.preview_offer_audience(
    (select id from borg), 'はじめての六甲山ハイク', '説明文', '理由', '9月13日（土）9:00', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    12, '2026-09-11');
create temp table bdelivery as
  select s.delivery_id as id from public.send_offer(
    (select id from borg), 'はじめての六甲山ハイク', '説明文', '理由', '9月13日（土）9:00', '六甲ケーブル下',
    array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[],
    12, '2026-09-11') s;
reset role;

-- ---- 受信者本人（b02） ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b02","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_inbox()),
  1,
  'T5: 受信者の受信箱に1件届く'
);
select is(
  (select (i.org_name, i.org_contact_handle, i.score::int)::text from public.list_my_inbox() i),
  '(受信箱テスト団体,"",100)',
  'T5: 受信行に団体表示snapshotとscoreが含まれる（返答前は公式窓口を返さない・D033）'
);
select lives_ok(
  $$select public.mark_offer_read((select id from bdelivery))$$,
  'T5: 受信者は既読を記録できる'
);
select lives_ok(
  $$select public.respond_to_offer((select id from bdelivery), 'interested')$$,
  'T5: 受信者は返答できる'
);
select is(
  (select i.response_choice::text from public.list_my_inbox() i),
  'interested',
  'T5: 返答が受信箱へ反映される'
);
select is(
  (select i.org_contact_handle from public.list_my_inbox() i),
  '@inbox_test',
  'T5: 「行ってみたい」の後にだけ公式窓口が開示される（D033）'
);
select lives_ok(
  $$select public.respond_to_offer((select id from bdelivery), 'skip')$$,
  'T5: 返答は後から変更できる'
);
select is(
  (select i.response_choice::text from public.list_my_inbox() i),
  'skip',
  'T5: 変更後の返答が反映される（1件へ上書き）'
);
select is(
  (select i.org_contact_handle from public.list_my_inbox() i),
  '',
  'T5: 見送りへ変更すると公式窓口は再び返らない（D033）'
);
reset role;

-- 既読は初回時刻を保持する（DO NOTHING）: 時刻をpostgresで書き換えても再markで上書きされない
update private.offer_reads set read_at = timestamptz '2026-08-01 00:00:00+09'
 where delivery_id = (select id from bdelivery);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b02","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.mark_offer_read((select id from bdelivery))$$,
  'T5: 既読の再記録は冪等（エラーにならない）'
);
reset role;
select is(
  (select r.read_at from private.offer_reads r where r.delivery_id = (select id from bdelivery)),
  timestamptz '2026-08-01 00:00:00+09',
  'T5: 再記録しても初回の開封時刻が保持される'
);

-- ---- 非受信者（b03）は届かず、既読・返答もできない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b03","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_inbox()),
  0,
  'T5: 対象外の学生の受信箱は空'
);
select throws_ok(
  $$select public.mark_offer_read((select id from bdelivery))$$,
  'P0001', 'not_recipient',
  'T5: 非受信者は既読を記録できない'
);
select throws_ok(
  $$select public.respond_to_offer((select id from bdelivery), 'interested')$$,
  'P0001', 'not_recipient',
  'T5: 非受信者は返答できない'
);
reset role;

-- ---- メール変更でドメイン外になった学生は全遮断される（008 T17の継続） ----
update auth.users set email = 'demo-inbox-b@gmail.com'
 where id = '00000000-0000-0000-0000-000000000b03';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b03","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.list_my_inbox()$$,
  'P0001', 'not_student',
  'T5: ドメイン外へ変更されたアカウントは受信箱を取得できない'
);
reset role;

-- ---- 学生権限のない団体担当者（b01）は受信箱を呼べない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.list_my_inbox()$$,
  'P0001', 'not_student',
  'T5: 学生権限が無ければ受信箱を取得できない'
);
reset role;

-- ---- D023: 団体名・窓口を後から変更しても受信済み表示のsnapshotは不変 ----
update public.organizations
   set name = '改名後の団体', contact_handle = '@renamed'
 where id = (select id from borg);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b02","role":"authenticated"}', true);
set local role authenticated;
-- 窓口はD033で「行ってみたい」時のみ開示されるため、開示条件を満たしてから不変性を検査する
select public.respond_to_offer((select id from bdelivery), 'interested');
select is(
  (select (i.org_name, i.org_contact_handle)::text from public.list_my_inbox() i),
  '(受信箱テスト団体,@inbox_test)',
  'T5: 団体の改名・窓口変更後も受信済みsnapshotは変わらない（D023）'
);
reset role;

select * from finish();
rollback;
