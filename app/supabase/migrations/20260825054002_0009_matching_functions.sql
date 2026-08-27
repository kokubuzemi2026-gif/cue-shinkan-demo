-- Task 009 (2/4): マッチング・同一イベント判定のサーバー正本
-- 正本: docs/matching_and_safety.md §4 / docs/decisions.md D010・D021・D023 /
--       app/src/domain/matching.ts・delivery.ts（判定表はTypeScript実装と完全同一・両側でテスト）
--
-- D028のメール判定と同じ「TS/SQL双実装＋同一ケース表」パターン。
-- 配点・理由文・注意文・優先順・上限（理由3件/注意2件）・閾値65点を1文字も変えずに移植する。
-- 判定の同一性は app/src/domain/matchingParity.test.ts と
-- app/supabase/tests/12_matching_parity_test.sql が同じケース表で検証する。

-- ---- ラベル（domain/types.tsの*_LABELSと同一） ----
create function private.interest_label(value public.interest_category)
returns text
language sql
immutable
set search_path = ''
as $$
  select case value
    when 'outdoor' then 'アウトドア'
    when 'photo' then '写真'
    when 'travel' then '旅行'
    when 'music' then '音楽'
    when 'sports' then 'スポーツ'
    when 'film' then '映像・映画'
    when 'volunteer' then 'ボランティア'
    when 'international' then '国際交流'
  end
$$;
revoke execute on function private.interest_label(public.interest_category) from public;
revoke execute on function private.interest_label(public.interest_category) from anon;
revoke execute on function private.interest_label(public.interest_category) from authenticated;

create function private.purpose_label(value public.purpose)
returns text
language sql
immutable
set search_path = ''
as $$
  select case value
    when 'friends' then '友達を作る'
    when 'challenge' then '新しいことへ挑戦'
    when 'exercise' then '体を動かす'
    when 'creation' then '創作する'
  end
$$;
revoke execute on function private.purpose_label(public.purpose) from public;
revoke execute on function private.purpose_label(public.purpose) from anon;
revoke execute on function private.purpose_label(public.purpose) from authenticated;

create function private.day_slot_label(value public.day_slot)
returns text
language sql
immutable
set search_path = ''
as $$
  select case value
    when 'weekday_day' then '平日昼'
    when 'weekday_night' then '平日夜'
    when 'weekend' then '土日'
  end
$$;
revoke execute on function private.day_slot_label(public.day_slot) from public;
revoke execute on function private.day_slot_label(public.day_slot) from anon;
revoke execute on function private.day_slot_label(public.day_slot) from authenticated;

create function private.frequency_label(value public.frequency)
returns text
language sql
immutable
set search_path = ''
as $$
  select case value
    when 'monthly_1_2' then '月1〜2回'
    when 'weekly_1' then '週1回'
    when 'weekly_2_plus' then '週2回以上'
  end
$$;
revoke execute on function private.frequency_label(public.frequency) from public;
revoke execute on function private.frequency_label(public.frequency) from anon;
revoke execute on function private.frequency_label(public.frequency) from authenticated;

-- ---- 円表記（matching.tsのformatYen: toLocaleString('ja-JP') + '円' と同一） ----
create function private.format_yen(amount integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(amount, 'FM999,999,999') || '円'
$$;
revoke execute on function private.format_yen(integer) from public;
revoke execute on function private.format_yen(integer) from anon;
revoke execute on function private.format_yen(integer) from authenticated;

-- ---- 同一イベント判定の正規化（domain/delivery.tsのnormalizeEventTextと同一） ----
-- NFKC正規化→小文字化→空白除去。空白クラスはJavaScriptの\s（/u付き）と同じ集合を
-- \uXXXXエスケープで明示し、DBロケール差の影響を受けないようにする
-- （全角空白U+3000等の多くはNFKCで半角空白へ写像されるため、残る空白種も同一に扱う）
create function private.normalize_event_text(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    lower(normalize(value, nfkc)),
    '[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+',
    '',
    'g'
  )
$$;
revoke execute on function private.normalize_event_text(text) from public;
revoke execute on function private.normalize_event_text(text) from anon;
revoke execute on function private.normalize_event_text(text) from authenticated;

-- ---- イベントfingerprint（domain/delivery.tsのeventFingerprintと同一構造） ----
create function private.event_fingerprint(
  org_id uuid,
  event_name text,
  date_text text,
  place text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select org_id::text
    || '|' || private.normalize_event_text(event_name)
    || '|' || private.normalize_event_text(date_text)
    || '|' || private.normalize_event_text(place)
$$;
revoke execute on function private.event_fingerprint(uuid, text, text, text) from public;
revoke execute on function private.event_fingerprint(uuid, text, text, text) from anon;
revoke execute on function private.event_fingerprint(uuid, text, text, text) from authenticated;

-- ---- マッチング本体（domain/matching.tsのcalculateMatchと同一判定） ----
-- 配点: 興味35 / 目的20(1件は10) / スタイル15(隣接8) / 曜日15 / 経験10(部分5) / 費用5。
-- 閾値65点。理由は得点要素から優先順（興味→曜日→経験→目的→費用）で最大3件、
-- 注意は（費用→頻度→本気度→初心者対応）で最大2件。
-- eligible = 受信停止でない AND 対象カテゴリの受信を許可 AND 65点以上
create function private.match_passport(
  p public.student_passports,
  o_target_categories public.interest_category[],
  o_target_purposes public.purpose[],
  o_intensity public.activity_style,
  o_event_days public.day_slot[],
  o_frequency public.frequency,
  o_fee_per_event_yen integer,
  o_beginner_friendly boolean
)
returns table (eligible boolean, score integer, reasons text[], cautions text[])
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- 並びはdomain/types.tsの定数配列と同一（段差・順序比較が依存する）
  styles constant public.activity_style[] :=
    array['relaxed', 'moderate', 'serious']::public.activity_style[];
  freqs constant public.frequency[] :=
    array['monthly_1_2', 'weekly_1', 'weekly_2_plus']::public.frequency[];
  day_order constant public.day_slot[] :=
    array['weekday_day', 'weekday_night', 'weekend']::public.day_slot[];
  matched_interest public.interest_category;
  matched_purposes public.purpose[];
  first_purpose public.purpose;
  matched_day public.day_slot;
  style_gap integer;
  interest_score integer;
  purpose_score integer;
  style_score integer;
  days_score integer;
  experience_score integer;
  fee_score integer;
  fee_within boolean;
  category_allowed boolean;
  v_score integer;
  v_reasons text[] := '{}';
  v_cautions text[] := '{}';
begin
  -- 興味: 1件でも一致すれば満点。学生の登録順で最初の一致を理由に使う
  select t.i
    into matched_interest
    from unnest(p.interests) with ordinality as t(i, ord)
   where t.i = any (o_target_categories)
   order by t.ord
   limit 1;
  interest_score := case when matched_interest is not null then 35 else 0 end;

  -- 活動目的: 一致数で判定（学生の登録順を保持し、最初の一致を理由に使う）
  select coalesce(array_agg(t.pp order by t.ord), '{}')
    into matched_purposes
    from unnest(p.purposes) with ordinality as t(pp, ord)
   where t.pp = any (o_target_purposes);
  purpose_score := case
    when cardinality(matched_purposes) >= 2 then 20
    when cardinality(matched_purposes) = 1 then 10
    else 0
  end;

  -- スタイル×本気度: 強度スケール上の段差
  style_gap := abs(
    array_position(styles, p.style) - array_position(styles, o_intensity)
  );
  style_score := case style_gap when 0 then 15 when 1 then 8 else 0 end;

  -- 曜日: 参加できる開催枠が1つでもあれば満点。理由文はDAY_SLOTS定義順で決定的に選ぶ
  select t.d
    into matched_day
    from unnest(day_order) with ordinality as t(d, ord)
   where t.d = any (p.available_days)
     and t.d = any (o_event_days)
   order by t.ord
   limit 1;
  days_score := case when matched_day is not null then 15 else 0 end;

  -- 経験×初心者対応
  experience_score := case
    when o_beginner_friendly then 10
    when p.experience = 'experienced' then 10
    when p.experience = 'some' then 5
    else 0
  end;

  -- 費用: 同一単位（円/回）同士のみ比較。同額は予算内（D019）
  fee_within := o_fee_per_event_yen <= p.max_fee_per_event_yen;
  fee_score := case when fee_within then 5 else 0 end;

  v_score := interest_score + purpose_score + style_score + days_score
    + experience_score + fee_score;

  -- 理由（得点した要素のみ・優先順）
  if matched_interest is not null then
    v_reasons := v_reasons || (private.interest_label(matched_interest) || 'に興味がある');
  end if;
  if matched_day is not null then
    v_reasons := v_reasons || (private.day_slot_label(matched_day) || 'に参加しやすい');
  end if;
  if o_beginner_friendly and p.experience = 'none' then
    v_reasons := v_reasons || '未経験でも歓迎される活動'::text;
  elsif (not o_beginner_friendly) and p.experience = 'experienced' then
    v_reasons := v_reasons || '経験を活かしやすい活動'::text;
  end if;
  first_purpose := matched_purposes[1];
  if first_purpose is not null then
    v_reasons := v_reasons || ('『' || private.purpose_label(first_purpose) || '』の目的が合っている');
  end if;
  if fee_within then
    v_reasons := v_reasons || '参加費が予算内'::text;
  end if;

  -- 注意（重要な不一致は隠さない・優先順）
  if not fee_within then
    v_cautions := v_cautions || (
      '参加費（' || private.format_yen(o_fee_per_event_yen)
      || '）は希望予算（1回' || private.format_yen(p.max_fee_per_event_yen)
      || '以内）より高めです'
    );
  end if;
  if array_position(freqs, o_frequency) > array_position(freqs, p.frequency) then
    v_cautions := v_cautions
      || ('活動頻度（' || private.frequency_label(o_frequency) || '）は希望より多めです');
  end if;
  if array_position(styles, o_intensity) > array_position(styles, p.style) then
    v_cautions := v_cautions || '活動の本気度は希望より高めです'::text;
  end if;
  if (not o_beginner_friendly) and p.experience = 'none' then
    v_cautions := v_cautions || '未経験者向けの案内がないイベントです'::text;
  end if;

  -- 配信対象の判定は3条件のみ（受信停止・カテゴリ不許可・65点未満）
  category_allowed := o_target_categories && p.reception_categories;
  eligible := (not p.reception_paused) and category_allowed and v_score >= 65;
  score := v_score;
  reasons := v_reasons[1:3];
  cautions := v_cautions[1:2];
  return next;
end;
$$;
revoke execute on function private.match_passport(
  public.student_passports, public.interest_category[], public.purpose[],
  public.activity_style, public.day_slot[], public.frequency, integer, boolean
) from public;
revoke execute on function private.match_passport(
  public.student_passports, public.interest_category[], public.purpose[],
  public.activity_style, public.day_slot[], public.frequency, integer, boolean
) from anon;
revoke execute on function private.match_passport(
  public.student_passports, public.interest_category[], public.purpose[],
  public.activity_style, public.day_slot[], public.frequency, integer, boolean
) from authenticated;
