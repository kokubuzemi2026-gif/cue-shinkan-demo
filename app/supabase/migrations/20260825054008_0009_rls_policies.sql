-- Task 009 (4/4): RLS有効化・policy・テーブルgrant
-- 正本: docs/server_data_model.md §5 / docs/auth_and_authorization.md §7・§11
--
-- 方針（008と同一）:
-- - deny by default: Task 009の新規テーブルに限り、必要な最小grantだけを明示付与する
-- - すべてのpolicyは (select public.is_university_user()) を必須条件に含める
-- - 読取だけが必要なpublicテーブル（student_passports）はRLS+SELECT grant、
--   書込はRPC経由のみ（INSERT/UPDATE/DELETEのgrantを与えない）
-- - privateスキーマの配信4テーブルはgrantゼロ+RLS有効policyゼロ（RPC経由のみ・多層防御）

alter table public.student_passports enable row level security;
alter table private.offer_deliveries enable row level security;
alter table private.offer_recipients enable row level security;
alter table private.offer_reads enable row level security;
alter table private.offer_responses enable row level security;

-- ---- student_passports: 自分の行だけSELECT可能。書込はsave_student_passport RPCのみ ----
create policy student_passports_select_own
  on public.student_passports
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_university_user())
  );

grant select on table public.student_passports to authenticated;

-- private.offer_deliveries / offer_recipients / offer_reads / offer_responses:
-- policyなし・grantなし（SECURITY DEFINER RPC経由のみ）
