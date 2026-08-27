-- Task 009-T3: 興味パスポートの保存・分離
-- （本人だけがRPCで保存・自分の行だけSELECT可・direct DML不可・入力検証・学生権限必須）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000901', 'demo-p1@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000902', 'demo-p2@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000903', 'demo-p3@stu.kobe-u.ac.jp', now(), now(), now());
insert into public.student_accounts (user_id) values
  ('00000000-0000-0000-0000-000000000901'),
  ('00000000-0000-0000-0000-000000000902');
-- 902のパスポートは事前に存在させる（postgresで作成）
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
) values (
  '00000000-0000-0000-0000-000000000902',
  array['music']::public.interest_category[], array['creation']::public.purpose[],
  'relaxed', 'weekly_1', array['weekday_night']::public.day_slot[], 'some',
  500, false, array['music']::public.interest_category[], 2
);

-- ---- 901（学生本人）として操作 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000901","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
set local role authenticated;

select lives_ok(
  $$select public.save_student_passport(
      array['outdoor','outdoor','photo']::public.interest_category[],
      array['friends','challenge']::public.purpose[],
      'moderate', 'monthly_1_2',
      array['weekend']::public.day_slot[],
      'none', 2000, false,
      array['outdoor','photo']::public.interest_category[], 3)$$,
  'T3: 自分のパスポートをRPCで保存できる（重複入力あり）'
);
select is(
  (select p.interests from public.student_passports p
    where p.user_id = '00000000-0000-0000-0000-000000000901'),
  array['outdoor','photo']::public.interest_category[],
  'T3: 重複要素は先頭出現順を保って正規化される'
);
select is(
  (select count(*)::int from public.student_passports),
  1,
  'T3: 2行存在するが自分の1行だけが見える'
);
select is_empty(
  $$select 1 from public.student_passports
     where user_id = '00000000-0000-0000-0000-000000000902'$$,
  'T3: 他人のパスポートは見えない'
);
select throws_ok(
  $$insert into public.student_passports (
      user_id, interests, purposes, style, frequency, available_days, experience,
      max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
    ) values (
      '00000000-0000-0000-0000-000000000901',
      array['outdoor']::public.interest_category[], array['friends']::public.purpose[],
      'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
      100, false, array['outdoor']::public.interest_category[], 1)$$,
  '42501', null,
  'T3: direct INSERTは不可（保存はRPCのみ）'
);
select throws_ok(
  $$update public.student_passports set max_fee_per_event_yen = 99999$$,
  '42501', null,
  'T3: direct UPDATEは不可'
);
select throws_ok(
  $$delete from public.student_passports$$,
  '42501', null,
  'T3: direct DELETEは不可'
);
select lives_ok(
  $$select public.save_student_passport(
      array['outdoor']::public.interest_category[],
      array['friends']::public.purpose[],
      'serious', 'weekly_2_plus',
      array['weekday_day']::public.day_slot[],
      'experienced', 5000, true,
      array[]::public.interest_category[], 5)$$,
  'T3: 2回目の保存で更新できる（停止中はカテゴリ0件を許す）'
);
select is(
  (select (p.reception_weekly_limit::int, p.reception_paused)::text from public.student_passports p
    where p.user_id = '00000000-0000-0000-0000-000000000901'),
  '(5,t)',
  'T3: 更新内容（週上限5・停止中）が反映される'
);
select throws_ok(
  $$select public.save_student_passport(
      array['outdoor']::public.interest_category[],
      array['friends']::public.purpose[],
      'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
      2000, false, array['outdoor']::public.interest_category[], 0)$$,
  'P0001', 'invalid_passport',
  'T3: 週上限0は拒否（1〜5のみ）'
);
select throws_ok(
  $$select public.save_student_passport(
      array[]::public.interest_category[],
      array['friends']::public.purpose[],
      'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
      2000, false, array['outdoor']::public.interest_category[], 3)$$,
  'P0001', 'invalid_passport',
  'T3: 興味0件は拒否'
);
select throws_ok(
  $$select public.save_student_passport(
      array['outdoor']::public.interest_category[],
      array['friends']::public.purpose[],
      'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
      100001, false, array['outdoor']::public.interest_category[], 3)$$,
  'P0001', 'invalid_passport',
  'T3: 予算上限超（100,000円超）は拒否'
);
reset role;

-- ---- 903（学生権限なしの大学ユーザー）はパスポートを保存できない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000903","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.save_student_passport(
      array['outdoor']::public.interest_category[],
      array['friends']::public.purpose[],
      'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
      2000, false, array['outdoor']::public.interest_category[], 3)$$,
  'P0001', 'not_student',
  'T3: 学生権限（student_accounts行）が無ければ保存できない'
);
reset role;

-- 対照: postgresからは2行見える
select is(
  (select count(*)::int from public.student_passports),
  2,
  '対照: postgresからは2行見える'
);

select * from finish();
rollback;
