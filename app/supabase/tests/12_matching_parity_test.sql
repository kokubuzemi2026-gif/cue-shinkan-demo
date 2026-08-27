-- Task 009-T2: SQLマッチング関数がTypeScript実装（domain/matching.ts）と同一判定であること
-- ケース表は app/src/domain/matchingParity.test.ts と完全同一（C01〜C16・期待値も同一文字列）。
-- 期待値の表記: eligible(t/f) | score | 理由を「/」連結 | 注意を「/」連結
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

-- 検証用の合成パスポート（user_id・時刻は判定に使われない）
create function pg_temp.mk_student(
  s_interests public.interest_category[],
  s_purposes public.purpose[],
  s_style public.activity_style,
  s_frequency public.frequency,
  s_days public.day_slot[],
  s_experience public.experience_level,
  s_fee integer,
  s_paused boolean,
  s_categories public.interest_category[],
  s_weekly integer
) returns public.student_passports
language sql
as $$
  select row(
    '00000000-0000-0000-0000-000000000000'::uuid,
    s_interests, s_purposes, s_style, s_frequency, s_days, s_experience,
    s_fee, s_paused, s_categories, s_weekly::smallint, now(), now()
  )::public.student_passports
$$;

create function pg_temp.match_text(
  p public.student_passports,
  o_cats public.interest_category[],
  o_purps public.purpose[],
  o_intensity public.activity_style,
  o_days public.day_slot[],
  o_freq public.frequency,
  o_fee integer,
  o_beginner boolean
) returns text
language sql
as $$
  select (case when m.eligible then 't' else 'f' end)
    || '|' || m.score::text
    || '|' || array_to_string(m.reasons, '/')
    || '|' || array_to_string(m.cautions, '/')
  from private.match_passport(p, o_cats, o_purps, o_intensity, o_days, o_freq, o_fee, o_beginner) m
$$;

-- C01: 完全一致（100点・理由は3件で打ち切り・注意なし）
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor','photo','travel']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 2000, false, array['outdoor','photo','travel']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  't|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  'C01: 完全一致は100点・理由3件・注意0件'
);

-- C02: 興味不一致でも他要素で65点（受信許可カテゴリで配信可）
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 2000, false, array['outdoor','music']::public.interest_category[], 3),
    array['music']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  't|65|土日に参加しやすい/未経験でも歓迎される活動/『友達を作る』の目的が合っている|',
  'C02: 興味0点でも65点でeligible・興味以外の理由が並ぶ'
);

-- C03: 63点はしきい値未満（不一致理由も注意2件で開示）
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'serious', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 1000, false, array['outdoor']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekday_day']::public.day_slot[], 'monthly_1_2', 1500, false),
  'f|63|アウトドアに興味がある/『友達を作る』の目的が合っている|参加費（1,500円）は希望予算（1回1,000円以内）より高めです/未経験者向けの案内がないイベントです',
  'C03: 63点はeligibleでない・費用と初心者対応の注意'
);

-- C04: 受信停止中は満点でも配信対象外
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor','photo','travel']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 2000, true, array['outdoor','photo','travel']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  'f|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  'C04: 受信停止中は100点でも配信対象外'
);

-- C05: 受信許可カテゴリ外は満点でも配信対象外
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor','photo','travel']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 2000, false, array['music']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  'f|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  'C05: 対象カテゴリの受信を許可していなければ配信対象外'
);

-- C06: 経験者×経験者向け・同額は予算内（D019）
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor']::public.interest_category[], array['creation']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'experienced', 2000, false, array['outdoor']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekday_night']::public.day_slot[], 'monthly_1_2', 2000, false),
  't|65|アウトドアに興味がある/経験を活かしやすい活動/参加費が予算内|',
  'C06: 経験を活かす理由と同額予算内の理由'
);

-- C07: 予算1円超過は減点+金額表記つき注意（3桁区切り）
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor']::public.interest_category[], array['creation']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'experienced', 2000, false, array['outdoor']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekday_night']::public.day_slot[], 'monthly_1_2', 2001, false),
  'f|60|アウトドアに興味がある/経験を活かしやすい活動|参加費（2,001円）は希望予算（1回2,000円以内）より高めです',
  'C07: 1円でも予算超過なら減点し、3桁区切りの注意を出す'
);

-- C08: 目的1件一致は部分点10
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor','photo','travel']::public.interest_category[], array['friends','exercise']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 2000, false, array['outdoor','photo','travel']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  't|90|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  'C08: 目的1件一致は10点（90点）'
);

-- C09: スタイル両端は0点・本気度が高い側なら注意
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor','photo','travel']::public.interest_category[], array['friends','challenge']::public.purpose[], 'relaxed', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 2000, false, array['outdoor','photo','travel']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'serious', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  't|85|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|活動の本気度は希望より高めです',
  'C09: ゆるく×本格的は0点+本気度の注意'
);

-- C10: 頻度が希望より多いと注意（点数には影響しない）
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor','photo','travel']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 2000, false, array['outdoor','photo','travel']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'weekly_2_plus', 1500, true),
  't|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|活動頻度（週2回以上）は希望より多めです',
  'C10: 頻度過多の注意'
);

-- C11: 頻度が希望より少ない場合は注意なし
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor','photo','travel']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', 'weekly_2_plus', array['weekend']::public.day_slot[], 'none', 2000, false, array['outdoor','photo','travel']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  't|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  'C11: 頻度が少ない側なら注意なし'
);

-- C12: 注意は優先順（費用→頻度→本気度→初心者対応）で2件まで
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'relaxed', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 1000, false, array['outdoor']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'serious', array['weekend']::public.day_slot[], 'weekly_2_plus', 1500, false),
  't|70|アウトドアに興味がある/土日に参加しやすい/『友達を作る』の目的が合っている|参加費（1,500円）は希望予算（1回1,000円以内）より高めです/活動頻度（週2回以上）は希望より多めです',
  'C12: 4候補あっても注意は先頭2件のみ'
);

-- C13: 興味の理由は学生の登録順で最初の一致
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['photo','outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 2000, false, array['outdoor','photo','travel']::public.interest_category[], 3),
    array['outdoor','photo']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  't|100|写真に興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  'C13: 興味理由は学生の登録順（オファー側の順ではない）'
);

-- C14: 曜日の理由はDAY_SLOTS定義順で決定的
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor','photo','travel']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend','weekday_night']::public.day_slot[], 'none', 2000, false, array['outdoor','photo','travel']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekday_night','weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  't|100|アウトドアに興味がある/平日夜に参加しやすい/未経験でも歓迎される活動|',
  'C14: 曜日理由は定義順（平日昼→平日夜→土日）で選ぶ'
);

-- C15: 目的の理由は学生の登録順で最初の一致
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor']::public.interest_category[], array['challenge','friends']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none', 2000, false, array['outdoor','music']::public.interest_category[], 3),
    array['music']::public.interest_category[], array['friends','challenge']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true),
  't|65|土日に参加しやすい/未経験でも歓迎される活動/『新しいことへ挑戦』の目的が合っている|',
  'C15: 目的理由は学生の登録順で最初の一致'
);

-- C16: 参加費0円は予算0円でも予算内
select is(
  pg_temp.match_text(
    pg_temp.mk_student(array['outdoor']::public.interest_category[], array['creation']::public.purpose[], 'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'some', 0, false, array['outdoor']::public.interest_category[], 3),
    array['outdoor']::public.interest_category[], array['creation']::public.purpose[], 'moderate', array['weekend']::public.day_slot[], 'monthly_1_2', 0, false),
  't|85|アウトドアに興味がある/土日に参加しやすい/『創作する』の目的が合っている|',
  'C16: 0円同士は予算内（経験「少し」は理由なしの部分点）'
);

select * from finish();
rollback;
