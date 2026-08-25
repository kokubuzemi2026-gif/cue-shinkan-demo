-- Task 009 (1/4): サーバーデータ移行のenum・テーブル・trigger
-- 正本: docs/server_data_model.md / docs/decisions.md D019-D024・D026-D032 /
--       docs/auth_and_authorization.md §11（Task 009へ引き継ぐ契約）
--
-- 方針:
-- - 学生の正本ID = auth.uid()（student_accounts.user_id）、団体 = organizations.id へFKする
-- - 学生本人だけが読む自分の文書（興味パスポート）はpublic + RLS（読取grantのみ・書込はRPC）
-- - 配信・受信者・既読・返答は学生と団体をまたぐ機微データのためprivateスキーマに置き、
--   SECURITY DEFINER RPC経由でのみアクセスする（grantゼロ。団体へは匿名件数のみ・D029）
-- - grant/revokeはTask 009で新規作成するオブジェクトだけをスキーマ修飾で明示指定する
-- - 配信行はオファー内容と団体表示情報のsnapshotを内蔵し、以後の編集で変化しない（D023）

-- ---- enum（公開RPCの引数・戻り値と生成型に現れるためpublicへ置く。値はdomain/types.tsと同一・同順） ----
create type public.interest_category as enum (
  'outdoor', 'photo', 'travel', 'music', 'sports', 'film', 'volunteer', 'international'
);
create type public.purpose as enum ('friends', 'challenge', 'exercise', 'creation');
create type public.activity_style as enum ('relaxed', 'moderate', 'serious');
create type public.frequency as enum ('monthly_1_2', 'weekly_1', 'weekly_2_plus');
create type public.day_slot as enum ('weekday_day', 'weekday_night', 'weekend');
create type public.experience_level as enum ('none', 'some', 'experienced');
create type public.response_choice as enum ('interested', 'thinking', 'skip');

-- ---- 配列の重複要素検査（CHECK制約用。直接DML迂回でも配点操作できないようにする） ----
create function private.has_unique_elements(arr anyarray)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select arr is null
      or cardinality(arr) = (select count(distinct x) from unnest(arr) as t(x))
$$;
revoke execute on function private.has_unique_elements(anyarray) from public;
revoke execute on function private.has_unique_elements(anyarray) from anon;
revoke execute on function private.has_unique_elements(anyarray) from authenticated;

-- ---- 団体の公式窓口（matching_and_safety.md §6: 「行ってみたい」後に開示する連絡導線） ----
-- 個人の連絡先ではなく団体の公式アカウント表記のみ。未設定は空文字
alter table public.organizations
  add column contact_label text not null default ''
    constraint organizations_contact_label_length check (char_length(contact_label) <= 50),
  add column contact_handle text not null default ''
    constraint organizations_contact_handle_length check (char_length(contact_handle) <= 100);
comment on column public.organizations.contact_label is
  '公式窓口の表示名（例: 公式Instagram）。個人の連絡先は置かない';
comment on column public.organizations.contact_handle is
  '公式窓口のハンドル・URL表記。個人の連絡先は置かない';

-- ---- 興味パスポート（学生本人の文書。1人1行・PII列なし） ----
create table public.student_passports (
  user_id uuid primary key references public.student_accounts (user_id) on delete cascade,
  interests public.interest_category[] not null
    constraint student_passports_interests_bounds
      check (cardinality(interests) between 1 and 8)
    constraint student_passports_interests_unique
      check (private.has_unique_elements(interests)),
  purposes public.purpose[] not null
    constraint student_passports_purposes_bounds
      check (cardinality(purposes) between 1 and 4)
    constraint student_passports_purposes_unique
      check (private.has_unique_elements(purposes)),
  style public.activity_style not null,
  frequency public.frequency not null,
  available_days public.day_slot[] not null
    constraint student_passports_days_bounds
      check (cardinality(available_days) between 1 and 3)
    constraint student_passports_days_unique
      check (private.has_unique_elements(available_days)),
  experience public.experience_level not null,
  -- 1回あたりの予算上限（円）。月額とは比較しない（D019）
  max_fee_per_event_yen integer not null
    constraint student_passports_fee_range check (max_fee_per_event_yen between 0 and 100000),
  reception_paused boolean not null default false,
  -- 停止中はカテゴリ0件を許す（Phase 1と同じ。0件なら配信対象にならない）
  reception_categories public.interest_category[] not null
    constraint student_passports_categories_bounds
      check (cardinality(reception_categories) <= 8)
    constraint student_passports_categories_unique
      check (private.has_unique_elements(reception_categories)),
  reception_weekly_limit smallint not null
    constraint student_passports_weekly_limit_range check (reception_weekly_limit between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.student_passports is
  '興味パスポート。氏名・表示名・連絡先などのPII列は持たない。書込はsave_student_passport RPCのみ';
revoke all on table public.student_passports from anon;
revoke all on table public.student_passports from authenticated;

create trigger trg_set_updated_at
  before update on public.student_passports
  for each row execute function private.set_updated_at();

-- ---- 配信イベント（送信済みキャンペーンと受信箱の唯一の正本・D023） ----
-- オファー内容全体と団体表示情報を配信時点のsnapshotとして内蔵し、以後変更しない。
-- 団体名の変更・公式窓口の変更は受信済み表示へ影響しない
create table private.offer_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- 監査用。auth.users.idを直接持たずmembership経由で間接参照する（008の招待と同じ）
  created_by_membership_id uuid references public.organization_memberships (id) on delete set null,
  delivered_at timestamptz not null default now(),
  -- 団体表示snapshot（学生の受信箱表示の根拠。組織テーブルの後の編集で変化しない）
  org_name text not null
    constraint offer_deliveries_org_name_length check (char_length(org_name) between 1 and 100),
  org_description text not null default ''
    constraint offer_deliveries_org_description_length check (char_length(org_description) <= 500),
  org_contact_label text not null default ''
    constraint offer_deliveries_org_contact_label_length check (char_length(org_contact_label) <= 50),
  org_contact_handle text not null default ''
    constraint offer_deliveries_org_contact_handle_length check (char_length(org_contact_handle) <= 100),
  -- オファー内容snapshot
  event_name text not null
    constraint offer_deliveries_event_name_length check (char_length(event_name) between 1 and 100),
  description text not null
    constraint offer_deliveries_description_length check (char_length(description) between 1 and 500),
  reason_note text not null
    constraint offer_deliveries_reason_note_length check (char_length(reason_note) between 1 and 500),
  date_text text not null
    constraint offer_deliveries_date_text_length check (char_length(date_text) between 1 and 100),
  place text not null
    constraint offer_deliveries_place_length check (char_length(place) between 1 and 100),
  event_days public.day_slot[] not null
    constraint offer_deliveries_event_days_bounds check (cardinality(event_days) between 1 and 3)
    constraint offer_deliveries_event_days_unique check (private.has_unique_elements(event_days)),
  frequency public.frequency not null,
  fee_per_event_yen integer not null
    constraint offer_deliveries_fee_range check (fee_per_event_yen between 0 and 100000),
  beginner_friendly boolean not null,
  intensity public.activity_style not null,
  target_categories public.interest_category[] not null
    constraint offer_deliveries_target_categories_bounds
      check (cardinality(target_categories) between 1 and 8)
    constraint offer_deliveries_target_categories_unique
      check (private.has_unique_elements(target_categories)),
  target_purposes public.purpose[] not null
    constraint offer_deliveries_target_purposes_bounds
      check (cardinality(target_purposes) between 1 and 4)
    constraint offer_deliveries_target_purposes_unique
      check (private.has_unique_elements(target_purposes)),
  capacity integer not null
    constraint offer_deliveries_capacity_range check (capacity between 1 and 1000),
  deadline date not null,
  -- 同一イベント再送禁止（D023）: 団体・正規化イベント名・日時・場所のfingerprint
  event_fingerprint text not null,
  constraint offer_deliveries_no_resend unique (organization_id, event_fingerprint)
);
comment on table private.offer_deliveries is
  '配信イベント。オファー内容と団体表示のsnapshotを固定保存する（D023）。書込はsend_offer RPCのみ';
create index offer_deliveries_org_delivered_idx
  on private.offer_deliveries (organization_id, delivered_at desc);
revoke all on table private.offer_deliveries from anon;
revoke all on table private.offer_deliveries from authenticated;

-- ---- 受信者snapshot（学生ごとのscore・理由・注意点。団体からは件数でしか見えない・D029） ----
create table private.offer_recipients (
  delivery_id uuid not null references private.offer_deliveries (id) on delete cascade,
  user_id uuid not null references public.student_accounts (user_id) on delete cascade,
  score smallint not null
    constraint offer_recipients_score_range check (score between 0 and 100),
  reasons text[] not null
    constraint offer_recipients_reasons_bounds check (cardinality(reasons) between 1 and 3),
  cautions text[] not null default '{}'
    constraint offer_recipients_cautions_bounds check (cardinality(cautions) <= 2),
  primary key (delivery_id, user_id)
);
comment on table private.offer_recipients is
  '配信時点のマッチ結果snapshot（D023/D024）。学生本人の受信箱表示にのみ使い、団体へはID・一覧を返さない';
create index offer_recipients_user_idx on private.offer_recipients (user_id);
revoke all on table private.offer_recipients from anon;
revoke all on table private.offer_recipients from authenticated;

-- ---- 既読（返答とは独立。初回開封時刻を保持する） ----
create table private.offer_reads (
  delivery_id uuid not null,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  constraint offer_reads_pkey primary key (delivery_id, user_id),
  -- 受信者本人以外の既読は構造的に存在できない
  constraint offer_reads_recipient_fkey
    foreign key (delivery_id, user_id)
    references private.offer_recipients (delivery_id, user_id) on delete cascade
);
comment on table private.offer_reads is '受信箱の開封記録。書込はmark_offer_read RPCのみ（初回時刻を保持）';
revoke all on table private.offer_reads from anon;
revoke all on table private.offer_reads from authenticated;

-- ---- 返答（(delivery, user)ごとに1件へ正規化。上書き可） ----
create table private.offer_responses (
  delivery_id uuid not null,
  user_id uuid not null,
  choice public.response_choice not null,
  responded_at timestamptz not null default now(),
  constraint offer_responses_pkey primary key (delivery_id, user_id),
  constraint offer_responses_recipient_fkey
    foreign key (delivery_id, user_id)
    references private.offer_recipients (delivery_id, user_id) on delete cascade
);
comment on table private.offer_responses is
  '3段階返答（行ってみたい/あとで考える/今回は見送る）。書込はrespond_to_offer RPCのみ';
revoke all on table private.offer_responses from anon;
revoke all on table private.offer_responses from authenticated;
