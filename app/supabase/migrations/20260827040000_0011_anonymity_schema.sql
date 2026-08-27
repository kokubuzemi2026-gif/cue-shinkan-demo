-- Task 011 (1/3): 匿名性・並行quota・preview監査のためのスキーマとヘルパー
-- 正本: docs/launch_plan.md §4 / docs/decisions.md D036-D039 /
--       docs/matching_and_safety.md §5・§7 / docs/server_data_model.md §4-§5
--
-- 方針（008・009と同一）:
-- - 新規オブジェクトだけをスキーマ修飾で明示revoke/grantする（deny by default）
-- - 団体・学生をまたぐ機微データはprivateスキーマ + SECURITY DEFINER RPC限定（grantゼロ）
-- - 監査記録に学生の希望条件（raw）を残さない。団体の指定条件はfingerprint（SHA-256）だけを保存する
-- - 生の対象人数はAPI応答・エラーメッセージへ出さない（区分だけを返す）

-- ---- 対象人数の区分（D036）。生の人数の代わりにこの6値だけを外部へ返す ----
create function private.audience_band(n integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n is null or n <= 0 then '0'
    when n < 5 then '1-4'
    when n < 10 then '5-9'
    when n < 25 then '10-24'
    when n < 50 then '25-49'
    else '50+'
  end
$$;
comment on function private.audience_band(integer) is
  '対象人数を6区分へ丸める。生の人数を団体へ返さないための唯一の変換点（D036）';
revoke execute on function private.audience_band(integer) from public;
revoke execute on function private.audience_band(integer) from anon;
revoke execute on function private.audience_band(integer) from authenticated;

-- ---- 5人単位への丸め（D037: 英国ONSの10-5ルールを参考にした丸め。四捨五入） ----
create function private.round_to_base5(n integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when n is null or n <= 0 then 0 else ((n + 2) / 5) * 5 end
$$;
comment on function private.round_to_base5(integer) is
  '開示可能な集計値を5人単位へ丸める（12→10 / 13→15）。法令準拠を主張するものではない';
revoke execute on function private.round_to_base5(integer) from public;
revoke execute on function private.round_to_base5(integer) from anon;
revoke execute on function private.round_to_base5(integer) from authenticated;

-- ---- 配列の正規化（fingerprint用。順序非依存＝マッチ判定は集合演算のみに依存する） ----
create function private.canonical_enum_array(arr anyarray)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select string_agg(distinct t.x::text, ',' order by t.x::text) from unnest(arr) as t(x)),
    ''
  )
$$;
revoke execute on function private.canonical_enum_array(anyarray) from public;
revoke execute on function private.canonical_enum_array(anyarray) from anon;
revoke execute on function private.canonical_enum_array(anyarray) from authenticated;

-- ---- 対象条件のfingerprint（D038） ----
-- マッチ判定へ実際に影響する7項目だけを正規化してSHA-256にする。
-- イベント名・日時テキスト・場所・説明文は対象集合を変えないため含めない
-- （含めると、同じ対象条件のまま文言だけ変えてpreview回数制限を回避できてしまう）。
create function private.audience_fingerprint(
  o_target_categories public.interest_category[],
  o_target_purposes public.purpose[],
  o_intensity public.activity_style,
  o_event_days public.day_slot[],
  o_frequency public.frequency,
  o_fee_per_event_yen integer,
  o_beginner_friendly boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      private.canonical_enum_array(o_target_categories) || '|' ||
      private.canonical_enum_array(o_target_purposes) || '|' ||
      coalesce(o_intensity::text, '') || '|' ||
      private.canonical_enum_array(o_event_days) || '|' ||
      coalesce(o_frequency::text, '') || '|' ||
      coalesce(o_fee_per_event_yen::text, '') || '|' ||
      coalesce(o_beginner_friendly::text, ''),
      'sha256'
    ),
    'hex'
  )
$$;
comment on function private.audience_fingerprint(
  public.interest_category[], public.purpose[], public.activity_style,
  public.day_slot[], public.frequency, integer, boolean) is
  '対象条件の正規化ハッシュ。raw条件を監査ログへ残さないための一方向変換（D038）';
revoke execute on function private.audience_fingerprint(
  public.interest_category[], public.purpose[], public.activity_style,
  public.day_slot[], public.frequency, integer, boolean) from public;
revoke execute on function private.audience_fingerprint(
  public.interest_category[], public.purpose[], public.activity_style,
  public.day_slot[], public.frequency, integer, boolean) from anon;
revoke execute on function private.audience_fingerprint(
  public.interest_category[], public.purpose[], public.activity_style,
  public.day_slot[], public.frequency, integer, boolean) from authenticated;

-- ---- 入力の早期検証（D039）: 高コストなSQL処理より前に、生の引数のまま拒否する ----
-- assert_offer_args（009）は btrim・重複除去のあとの意味的な検証。
-- こちらはその前段で、巨大payload・過大な配列長・NULL要素を弾く。
create function private.assert_offer_input_bounds(
  r_event_name text,
  r_description text,
  r_reason_note text,
  r_date_text text,
  r_place text,
  r_event_days public.day_slot[],
  r_target_categories public.interest_category[],
  r_target_purposes public.purpose[]
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- 巨大payload: 意味上の上限（100/500文字）より十分大きい固定バイト長で先に切る。
  -- btrim・正規表現・ハッシュを走らせる前に判定する
  if octet_length(coalesce(r_event_name, '')) > 4000
     or octet_length(coalesce(r_description, '')) > 4000
     or octet_length(coalesce(r_reason_note, '')) > 4000
     or octet_length(coalesce(r_date_text, '')) > 4000
     or octet_length(coalesce(r_place, '')) > 4000 then
    raise exception 'payload_too_large';
  end if;

  -- 過大な配列長: 重複除去（unnest + group by）を走らせる前に判定する。
  -- enumの値数（8 / 4 / 3）より十分大きい固定値で切る
  if cardinality(coalesce(r_event_days, '{}')) > 64
     or cardinality(coalesce(r_target_categories, '{}')) > 64
     or cardinality(coalesce(r_target_purposes, '{}')) > 64 then
    raise exception 'payload_too_large';
  end if;

  -- NULL要素: 重複除去でひとつに畳まれて後段の検証をすり抜けるため、ここで拒否する
  if array_position(coalesce(r_event_days, '{}'), null) is not null
     or array_position(coalesce(r_target_categories, '{}'), null) is not null
     or array_position(coalesce(r_target_purposes, '{}'), null) is not null then
    raise exception 'invalid_offer';
  end if;
end;
$$;
revoke execute on function private.assert_offer_input_bounds(
  text, text, text, text, text, public.day_slot[],
  public.interest_category[], public.purpose[]) from public;
revoke execute on function private.assert_offer_input_bounds(
  text, text, text, text, text, public.day_slot[],
  public.interest_category[], public.purpose[]) from anon;
revoke execute on function private.assert_offer_input_bounds(
  text, text, text, text, text, public.day_slot[],
  public.interest_category[], public.purpose[]) from authenticated;

-- ---- 学生の週間受信枠（D037）: 団体をまたぐ並行配信を直列化する専用テーブル ----
-- 週の定義はD021のローリング7日（下限exclusive・上限inclusive）を維持する。
-- 比較はtimestamptz同士＝UTCの絶対時刻で行い、ローカルtimezoneに依存しない。
-- window_count / window_started_at は運用観測用の非正規化値で、判定の正本ではない
-- （正本は private.offer_recipients × offer_deliveries.delivered_at のローリング集計）。
create table private.student_delivery_quota (
  user_id uuid primary key references public.student_accounts (user_id) on delete cascade,
  window_count smallint not null default 0
    constraint student_delivery_quota_count_range check (window_count >= 0),
  window_started_at timestamptz,
  last_delivered_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table private.student_delivery_quota is
  '学生1人1行の週間受信枠。send_offerがFOR UPDATEで確保し、団体をまたぐ同時配信を直列化する（D037）';
alter table private.student_delivery_quota enable row level security;
revoke all on table private.student_delivery_quota from anon;
revoke all on table private.student_delivery_quota from authenticated;

-- ---- 対象人数previewのキャッシュ兼監査（D038） ----
-- 同一条件は24時間同じ区分を返し、団体単位でrolling 24時間あたり20条件までに制限する。
-- 保存するのは団体自身の指定条件のfingerprintと区分だけで、学生の希望条件は残さない。
create table private.offer_preview_cache (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audience_fingerprint text not null
    constraint offer_preview_cache_fingerprint_format check (audience_fingerprint ~ '^[0-9a-f]{64}$'),
  band text not null
    constraint offer_preview_cache_band_values
      check (band in ('0', '1-4', '5-9', '10-24', '25-49', '50+')),
  first_computed_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  access_count integer not null default 1
    constraint offer_preview_cache_access_count_range check (access_count >= 1),
  primary key (organization_id, audience_fingerprint)
);
comment on table private.offer_preview_cache is
  'preview結果の24時間固定と条件数の制限。学生の希望条件・生の対象人数は保存しない（D038）';
create index offer_preview_cache_window_idx
  on private.offer_preview_cache (organization_id, first_computed_at desc);
alter table private.offer_preview_cache enable row level security;
revoke all on table private.offer_preview_cache from anon;
revoke all on table private.offer_preview_cache from authenticated;

-- ---- ファネルの日次snapshot（D037） ----
-- 生の件数を保存し、開示時に10-5ルール（抑制＋5人単位の丸め）を適用する。
-- 同じ日・同じofferには常に同じsnapshotを返す（日中の返答増加で数値が動かない）。
-- snapshot_dateはAsia/Tokyoの暦日（利用者が日本在住のため）。
create table private.offer_funnel_snapshots (
  delivery_id uuid not null references private.offer_deliveries (id) on delete cascade,
  snapshot_date date not null,
  delivered_count integer not null,
  viewed_count integer not null,
  engaged_count integer not null,
  planned_count integer not null,
  computed_at timestamptz not null default now(),
  primary key (delivery_id, snapshot_date)
);
comment on table private.offer_funnel_snapshots is
  'ファネルの日次snapshot（生の件数）。開示は10-5ルール適用後の値のみ（D037）';
alter table private.offer_funnel_snapshots enable row level security;
revoke all on table private.offer_funnel_snapshots from anon;
revoke all on table private.offer_funnel_snapshots from authenticated;
