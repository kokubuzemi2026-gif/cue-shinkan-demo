-- Task 014: アカウント・データのライフサイクル（本人による削除・脱退）
-- 正本: docs/decisions.md D046〜D048 / docs/server_data_model.md §12
--
-- 方針:
-- - FKの on delete は Task 008〜013 で既に全経路つながっている。削除は
--   「起点の行を消す」だけでよく、孤児データが構造的に出ない。
--   テストは全テーブルを走査して残存ゼロを確認する
-- - 受信済みオファーのsnapshotはパスポート削除では消さない（D023の履歴固定）。
--   アカウント削除では受信者行ごと消える
-- - 削除の監査に、個人を特定できる識別子を残さない（D029）

-- ---- 削除の監査記録 ----
-- 「誰の」は user_id のSHA-256だけを残す。既にその人のIDを持っている運営者が
-- 「削除が実際に走ったか」を確認できる一方、記録そのものからは人を特定できない。
-- 削除された利用者のIDを平文で持ち続けると「削除した」と言えない
create table private.deletion_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null
    constraint deletion_audit_log_action_values check (action in (
      'passport_deleted', 'account_deleted', 'membership_left'
    )),
  subject_hash text not null
    constraint deletion_audit_log_subject_hash_format check (subject_hash ~ '^[0-9a-f]{64}$'),
  -- 脱退のときだけ団体を記録する（団体側の「担当者が減った」調査のため）。
  -- 団体IDは学生個人を指さない
  organization_id uuid references public.organizations (id) on delete set null,
  removed_rows integer not null default 0
    constraint deletion_audit_log_removed_rows_range check (removed_rows between 0 and 100000),
  occurred_at timestamptz not null default now()
);
comment on table private.deletion_audit_log is
  '本人による削除の記録。user_idはSHA-256でのみ保持し、平文の識別子・メール・希望条件を持たない（D029・D046）';
create index deletion_audit_log_occurred_idx on private.deletion_audit_log (occurred_at desc);
alter table private.deletion_audit_log enable row level security;
revoke all on table private.deletion_audit_log from anon;
revoke all on table private.deletion_audit_log from authenticated;

create function private.subject_hash(subject uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest('cue-deletion-subject:' || subject::text, 'sha256'), 'hex');
$$;
comment on function private.subject_hash(uuid) is
  '削除監査用の一方向ハッシュ。既にIDを知っている場合だけ照合できる（D046）';
revoke execute on function private.subject_hash(uuid) from public;
revoke execute on function private.subject_hash(uuid) from anon;
revoke execute on function private.subject_hash(uuid) from authenticated;

-- ---- F29: 興味パスポートの削除（本人のみ） ----
-- 削除すると新規配信の対象にならない（evaluate_offer_audienceは
-- student_passportsを起点にするため、行が無い＝候補にならない）。
-- 受信済みの案内は履歴として残る（D023）
create function public.delete_student_passport()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_removed integer;
begin
  if not private.is_current_student() then
    raise exception 'not_student';
  end if;

  delete from public.student_passports p where p.user_id = v_uid;
  get diagnostics v_removed = row_count;
  if v_removed = 0 then
    raise exception 'passport_not_found';
  end if;

  insert into private.deletion_audit_log (action, subject_hash, removed_rows)
  values ('passport_deleted', private.subject_hash(v_uid), v_removed);
end;
$$;
comment on function public.delete_student_passport() is
  '興味パスポートを削除する。以後は新規配信の対象にならないが、受信済みの案内は残る（D023・D046）';
revoke execute on function public.delete_student_passport() from public;
revoke execute on function public.delete_student_passport() from anon;
grant execute on function public.delete_student_passport() to authenticated;

-- ---- F30: 団体からの脱退（本人のみ） ----
-- 最後のownerは脱退できない（既存の protect_last_owner トリガが構造で守る）。
-- ここでは、その状況を先に検出して分かりやすいエラーにする
create function public.leave_organization(org_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_removed integer;
begin
  if not public.is_university_user() then
    raise exception 'not_university_user';
  end if;

  if not exists (
    select 1 from public.organization_memberships m
     where m.organization_id = leave_organization.org_id
       and m.user_id = v_uid
  ) then
    raise exception 'not_member';
  end if;

  -- 最後のownerが抜けると、その団体は誰も管理できなくなる。
  -- その判定は protect_last_owner トリガが持つ（下のdeleteで last_owner を送出）。
  -- ここに同じ判定を書いても結果が変わらないため置かない
  delete from public.organization_memberships m
   where m.organization_id = leave_organization.org_id
     and m.user_id = v_uid;
  get diagnostics v_removed = row_count;

  insert into private.deletion_audit_log (action, subject_hash, organization_id, removed_rows)
  values ('membership_left', private.subject_hash(v_uid), leave_organization.org_id, v_removed);
end;
$$;
comment on function public.leave_organization(uuid) is
  '自分の所属を外す。最後のownerは脱退できない（last_owner）';
revoke execute on function public.leave_organization(uuid) from public;
revoke execute on function public.leave_organization(uuid) from anon;
grant execute on function public.leave_organization(uuid) to authenticated;

-- ---- F31: アカウント（CUEのデータ）の削除 ----
-- student_accounts の行を消すと、パスポート・通知設定・受信枠・送信待ちメール・
-- 受信者行（さらに既読・返答）がFKのcascadeで落ちる。
-- 所属も同時に外す。**auth identity（大学メール）はここでは消せない**ため、
-- 運営手順として docs/operations.md §9 に残す
create function public.delete_my_account()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_removed integer := 0;
  v_count integer;
begin
  if not public.is_university_user() then
    raise exception 'not_university_user';
  end if;

  -- 最後のownerである団体があると、所属の削除で protect_last_owner トリガが
  -- last_owner を送出し、トランザクション全体が巻き戻る（部分削除は起きない）。
  -- 同じ判定をここへ書いても結果は変わらないため置かない。構造の保証はトリガ側
  delete from public.organization_memberships m where m.user_id = v_uid;
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  -- 新入生権限の行を消すと、学生側のデータはFKのcascadeですべて落ちる
  delete from public.student_accounts sa where sa.user_id = v_uid;
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  if v_removed = 0 then
    raise exception 'nothing_to_delete';
  end if;

  insert into private.deletion_audit_log (action, subject_hash, removed_rows)
  values ('account_deleted', private.subject_hash(v_uid), v_removed);
end;
$$;
comment on function public.delete_my_account() is
  'CUEに保存した自分のデータをすべて消す。auth identity（大学メール）は残るため運営手順で削除する（D047）';
revoke execute on function public.delete_my_account() from public;
revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---- F32: auth identityの削除（運営専用） ----
-- 本人のRPCからは auth スキーマへ到達できないため、運営が仕上げる。
-- CUEのデータが残っている間は消させない（順序を間違えると孤児が残る）
create function public.admin_delete_auth_identity(target_user_id uuid, actor_label text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if actor_label is null or char_length(btrim(actor_label)) = 0
     or char_length(btrim(actor_label)) > 60 then
    raise exception 'invalid_admin_action';
  end if;
  if exists (select 1 from public.student_accounts sa where sa.user_id = target_user_id)
     or exists (select 1 from public.organization_memberships m where m.user_id = target_user_id) then
    raise exception 'account_data_remains';
  end if;

  delete from auth.users u where u.id = target_user_id;

  insert into private.admin_audit_log (action, actor_label)
  values ('auth_identity_deleted', btrim(actor_label));
end;
$$;
comment on function public.admin_delete_auth_identity(uuid, text) is
  'CUEのデータが無くなったauth identityを消す。本人のdelete_my_accountの後に運営が実行する（D047）';
revoke execute on function public.admin_delete_auth_identity(uuid, text) from public;
revoke execute on function public.admin_delete_auth_identity(uuid, text) from anon;
revoke execute on function public.admin_delete_auth_identity(uuid, text) from authenticated;
grant execute on function public.admin_delete_auth_identity(uuid, text) to service_role;

-- 監査記録のactionへ追加する
alter table private.admin_audit_log
  drop constraint admin_audit_log_action_values;
alter table private.admin_audit_log
  add constraint admin_audit_log_action_values check (action in (
    'organization_status_changed', 'offer_stopped', 'offer_resumed',
    'delivery_paused', 'delivery_resumed', 'auth_identity_deleted'
  ));
