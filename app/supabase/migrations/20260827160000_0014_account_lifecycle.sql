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
-- 主体（誰が消したか）を**記録しない**。
-- 当初は user_id のSHA-256を残す設計だったが、独立レビューで
-- `join auth.users u on subject_hash = digest('cue-deletion-subject:'||u.id, 'sha256')`
-- によりメールアドレスへ戻せることを実証された。saltもHMAC鍵も無く、
-- プレフィックスは公開リポジトリの定数で、候補IDは**同じDBの中**にある。
-- しかもD047の設計上、退会後もauth.usersは運営が消すまで残るため、
-- 「退会直後の利用者」がもっとも確実に特定できてしまう。
--
-- 同じDBにauth.usersがある以上、user_idの決定的な関数はどれも照合可能になる。
-- そこで主体を持たず、**日次の集計**だけを残す。
-- 運営が知りたい「削除が動いているか・どれだけ消えたか」には足り、
-- 利用者1人が保存と削除を繰り返しても行が増え続けない（DoSの入口を塞ぐ）
create table private.deletion_audit_log (
  action text not null
    constraint deletion_audit_log_action_values check (action in (
      'passport_deleted', 'account_deleted', 'membership_left'
    )),
  occurred_on date not null,
  event_count integer not null default 0
    constraint deletion_audit_log_event_count_range check (event_count >= 0),
  removed_rows integer not null default 0
    constraint deletion_audit_log_removed_rows_range check (removed_rows >= 0),
  updated_at timestamptz not null default now(),
  constraint deletion_audit_log_pkey primary key (action, occurred_on)
);
comment on table private.deletion_audit_log is
  '本人による削除の日次集計。主体（誰が）を持たない。同一DBにauth.usersがある限り、user_idの決定的な関数はすべて照合可能になるため（D046）';
alter table private.deletion_audit_log enable row level security;
revoke all on table private.deletion_audit_log from anon;
revoke all on table private.deletion_audit_log from authenticated;

-- 日次1行へ畳む。行数は「操作の種類 × 日数」で有界
create function private.record_deletion(deletion_action text, rows_removed integer)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into private.deletion_audit_log (action, occurred_on, event_count, removed_rows)
  values (deletion_action, (now() at time zone 'Asia/Tokyo')::date, 1, rows_removed)
  on conflict (action, occurred_on) do update set
    event_count = private.deletion_audit_log.event_count + 1,
    removed_rows = private.deletion_audit_log.removed_rows + excluded.removed_rows,
    updated_at = now();
$$;
revoke execute on function private.record_deletion(text, integer) from public;
revoke execute on function private.record_deletion(text, integer) from anon;
revoke execute on function private.record_deletion(text, integer) from authenticated;

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

  -- M-1: 「新しい案内は届かなくなります」と伝える以上、送信待ちの案内メールも止める。
  -- パスポート削除は利用者の最も強い「止めて」の意思表示で、
  -- ここが素通りすると削除後にオファー通知が届く
  update private.email_outbox o
     set status = 'cancelled', updated_at = now()
   where o.user_id = v_uid
     and o.status = 'pending';

  perform private.record_deletion('passport_deleted', v_removed);
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

  perform private.record_deletion('membership_left', v_removed);
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
-- 戻り値で「何が残ったか」を伝える。
-- 当初は void で、最後のownerである団体が1つでもあると
-- **学生側のデータも含めて全部巻き戻っていた**（独立レビューH-1で実証）。
-- 団体を1人で作った担当者は `create_organization` の仕様上ほぼ全員が単独ownerで、
-- ownerを増やす経路が無い（招待はownerを招待できず、role変更RPCも無い）。
-- つまり「退会も、学生としてのデータ削除も、運営経由の削除も一切できない」
-- 利用者が構造的に生まれていた。
--
-- 新入生としてのデータと、団体担当者としての所属は別のもの。
-- 前者の削除を後者の事情で止めない
create function public.delete_my_account()
returns table (removed_rows integer, blocking_organizations integer)
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

  -- 1. 自分が最後のownerでない所属だけを外す。
  --    最後のownerの団体を外すと管理者不在になるため残す（D048）
  delete from public.organization_memberships m
   where m.user_id = v_uid
     and not (
       m.role = 'owner'
       and not exists (
         select 1 from public.organization_memberships other
          where other.organization_id = m.organization_id
            and other.role = 'owner'
            and other.user_id <> v_uid
       )
     );
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  -- 2. 新入生権限の行を消すと、学生側のデータはFKのcascadeですべて落ちる
  delete from public.student_accounts sa where sa.user_id = v_uid;
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  -- 3. 外せなかった所属（＝自分が最後のownerの団体）の数を返す
  select count(*)::integer into blocking_organizations
    from public.organization_memberships m
   where m.user_id = v_uid;

  if v_removed = 0 and blocking_organizations = 0 then
    raise exception 'nothing_to_delete';
  end if;

  if v_removed > 0 then
    perform private.record_deletion('account_deleted', v_removed);
  end if;
  removed_rows := v_removed;
  return next;
end;
$$;
comment on function public.delete_my_account() is
  'CUEに保存した自分のデータを消す。最後のownerである団体の所属だけは残し、その数を返す（D047・D049）。auth identity（大学メール）は運営手順で削除する';
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
  -- 存在しないIDでも成功していると、呼び出し側は消えたか判別できず、
  -- 監査行だけが無意味に積み上がる（独立レビューM-2）
  if not found then
    raise exception 'identity_not_found';
  end if;

  -- 対象のIDは記録しない。削除した利用者の識別子を残せば「削除した」と言えない
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

-- ---- 最終ownerガードを並行実行でも守る（独立レビューB1） ----
-- 元の存在判定はロックを取らない素のSELECTだった。ownerが2人いる団体で
-- 2人が同時に脱退（または退会）すると、READ COMMITTEDでは互いに相手の行を
-- 「まだ存在する」と見るため**両方が通過**し、ownerが0人の団体が残る。
--
-- 復旧できないのが致命的で、owner membershipを作れる経路は create_organization
-- だけ（招待は organization_invitations_role_not_owner CHECK で owner を招待できない）。
-- role変更RPCも団体削除も未実装のため、ownerを二度と作れない団体が残る。
--
-- 存在判定へ for update を足し、相手の削除対象行をロックする。
-- 先にcommitした側の結果を見てから再評価されるため、後続は last_owner で止まる。
-- Task 014が organization_memberships への最初のDELETE経路であり、
-- この競合はここで初めて到達可能になった
create or replace function private.protect_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 親団体が既に削除されている＝organizationsのon delete cascade実行中
  if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if old.role = 'owner' and (
    tg_op = 'DELETE'
    or new.role is distinct from old.role
    or new.organization_id is distinct from old.organization_id
  ) then
    if not exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = old.organization_id
        and m.role = 'owner'
        and m.id <> old.id
      -- 並行する脱退・退会を直列化する（B1）
      for update
    ) then
      raise exception 'last_owner';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- M-4: 最終ownerガードが唯一の防御になった以上、Task 013の2つのトリガと同じ基準へ揃える。
-- 既定の ENABLE は session_replication_role='replica'（論理レプリケーションのapply・
-- pg_restore --data-only --disable-triggers・PITR/branch復元）で不発になる
alter table public.organization_memberships enable always trigger trg_protect_last_owner;

-- L-2: 退会時のcascadeが email_outbox だけO(N)になっていた
-- （既存indexは (kind, user_id, dedupe_key) で先頭列が違う）
create index email_outbox_user_idx on private.email_outbox (user_id);
