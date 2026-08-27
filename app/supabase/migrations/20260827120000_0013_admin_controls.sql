-- Task 013 (1/2): 団体確認・停止・緊急停止（kill switch）と監査記録
-- 正本: docs/operations.md / docs/decisions.md D043〜D045 /
--       docs/matching_and_safety.md §7（偽団体・危険な勧誘）
--
-- 方針:
-- - 配信を止める判定は**配信行の挿入トリガ**へ置く。RPCの中だけに書くと、
--   将来別の挿入経路ができたときに素通りする。構造で止める
-- - 状態変更・停止はservice_role専用RPCのみ。クライアントから到達する経路を作らない
-- - 監査記録に学生の希望条件・メール・氏名を入れない（D029）

-- ---- 緊急停止（kill switch）。1行だけのテーブル ----
create table private.platform_controls (
  id boolean primary key default true
    constraint platform_controls_single_row check (id),
  delivery_paused boolean not null default false,
  paused_reason text
    constraint platform_controls_reason_length check (paused_reason is null or char_length(paused_reason) <= 200),
  updated_at timestamptz not null default now()
);
comment on table private.platform_controls is
  '全団体の配信を止める緊急停止。1行だけを持つ（D045）';
insert into private.platform_controls (id) values (true);
alter table private.platform_controls enable row level security;
revoke all on table private.platform_controls from anon;
revoke all on table private.platform_controls from authenticated;

-- ---- 個別オファーの停止（D044） ----
alter table private.offer_deliveries
  add column stopped_at timestamptz,
  add column stopped_reason text
    constraint offer_deliveries_stopped_reason_length
      check (stopped_reason is null or char_length(stopped_reason) <= 200);
comment on column private.offer_deliveries.stopped_at is
  '運営が配信を停止した時刻。停止後も受信箱には残り「募集終了」として表示する（D044）';

-- ---- 監査記録（D043） ----
-- 学生の希望条件・メール・氏名は入れない。運営操作の「誰が・何を・なぜ」だけ
create table private.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null
    constraint admin_audit_log_action_values check (action in (
      'organization_status_changed', 'offer_stopped', 'offer_resumed',
      'delivery_paused', 'delivery_resumed'
    )),
  target_organization_id uuid references public.organizations (id) on delete set null,
  target_delivery_id uuid references private.offer_deliveries (id) on delete set null,
  -- 運営側の操作者を識別するラベル。氏名・メールを入れない運用とする
  actor_label text not null
    constraint admin_audit_log_actor_length check (char_length(actor_label) between 1 and 60),
  -- 操作の理由。学生個人を特定できる記述を入れない運用とする
  reason text
    constraint admin_audit_log_reason_length check (reason is null or char_length(reason) <= 200),
  previous_value text
    constraint admin_audit_log_previous_length check (previous_value is null or char_length(previous_value) <= 60),
  new_value text
    constraint admin_audit_log_new_length check (new_value is null or char_length(new_value) <= 60),
  created_at timestamptz not null default now()
);
comment on table private.admin_audit_log is
  '運営操作の必要最小限の監査記録。学生の希望条件・メール・氏名・受信者IDを持たない（D029・D043）';
create index admin_audit_log_created_idx on private.admin_audit_log (created_at desc);
alter table private.admin_audit_log enable row level security;
revoke all on table private.admin_audit_log from anon;
revoke all on table private.admin_audit_log from authenticated;

-- ---- 配信を止める判定（構造で強制する） ----
create function private.assert_delivery_allowed()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_status public.org_status;
  v_paused boolean;
begin
  select c.delivery_paused into v_paused from private.platform_controls c where c.id;
  if coalesce(v_paused, false) then
    raise exception 'delivery_paused';
  end if;

  select o.status into v_status
    from public.organizations o
   where o.id = new.organization_id;
  if v_status is distinct from 'verified' then
    raise exception 'org_not_verified';
  end if;

  return new;
end;
$$;
comment on function private.assert_delivery_allowed() is
  '配信行の挿入時に緊急停止と団体状態を確認する。RPC内の判定だけに頼らず構造で止める（D045）';
revoke execute on function private.assert_delivery_allowed() from public;
revoke execute on function private.assert_delivery_allowed() from anon;
revoke execute on function private.assert_delivery_allowed() from authenticated;

create trigger trg_assert_delivery_allowed
  before insert on private.offer_deliveries
  for each row execute function private.assert_delivery_allowed();
-- ENABLE ALWAYS: 既定の ENABLE だと session_replication_role='replica' で不発になる。
-- 現状そのGUCはsuperuser専用でクライアントから到達できないが、
-- 将来のレプリカ・ダンプ復元経路でも確実に発火させる（防御の多層化）
alter table private.offer_deliveries enable always trigger trg_assert_delivery_allowed;

-- ---- 緊急停止中は「新しい条件」の対象規模も答えない ----
-- 緊急停止の目的は誤配信・不正利用を止めること。不正利用がpreviewでの
-- 探索そのものである場合、配信だけを止めても探索は続けられる（独立レビューL1）。
-- 判定はキャッシュへの**挿入**（＝新しい条件の評価）に置く。
-- 24時間以内の同一条件（キャッシュ命中）は既に団体が知っている値で、
-- 返しても新しい情報を渡さないため止めない
create function private.assert_preview_allowed()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_paused boolean;
begin
  select c.delivery_paused into v_paused from private.platform_controls c where c.id;
  if coalesce(v_paused, false) then
    raise exception 'delivery_paused';
  end if;
  return new;
end;
$$;
revoke execute on function private.assert_preview_allowed() from public;
revoke execute on function private.assert_preview_allowed() from anon;
revoke execute on function private.assert_preview_allowed() from authenticated;

create trigger trg_assert_preview_allowed
  before insert on private.offer_preview_cache
  for each row execute function private.assert_preview_allowed();
alter table private.offer_preview_cache enable always trigger trg_assert_preview_allowed;
