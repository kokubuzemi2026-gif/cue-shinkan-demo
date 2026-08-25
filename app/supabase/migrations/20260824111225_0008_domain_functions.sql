-- Task 008 (2/4): 認証境界のサーバー正本（大学メール判定）
-- 正本: docs/auth_and_authorization.md §1-§2 / docs/decisions.md D028・D030
--
-- Before User Created Hookは採用しない（プラン制約）。ドメイン外のauth identityは
-- 作成され得るが、is_university_user()を全RLS・全RPCの必須条件にすることで
-- CUEの全データ・RPCへアクセス不能にする。

-- ---- F1: メール判定（判定表はapp/src/auth/universityEmail.tsと完全同一） ----
-- 規則: lower(btrim())で正規化した後、
--   ローカル部は空でなく「@」「+」「空白」を含まない / ドメインはstu.kobe-u.ac.jpへ完全一致
-- 学籍番号の文字種など、これ以上に狭い形式は推測しない（D028）
create function private.is_university_email(email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    lower(btrim(email)) ~ '^[^@+[:space:]]+@stu\.kobe-u\.ac\.jp$',
    false
  )
$$;
comment on function private.is_university_email(text) is
  '大学メール判定の正本。クライアントのisUniversityEmail()と同一の判定表を持つ（両側でテスト）';
revoke execute on function private.is_university_email(text) from public;
revoke execute on function private.is_university_email(text) from anon;
revoke execute on function private.is_university_email(text) from authenticated;

-- ---- F2: 認証済み大学ユーザー判定（全RLS・全RPCの前提） ----
-- 現在のauth.users.emailを読む（JWTクレームは使わない）ため、
-- メール変更でドメイン外になった既存アカウントもここで遮断される。
-- 加えてemail_confirmed_at IS NOT NULL（OTP検証済み）を必須とする。
create function public.is_university_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select private.is_university_email(u.email)
         and u.email_confirmed_at is not null
      from auth.users u
      where u.id = (select auth.uid())
    ),
    false
  )
$$;
comment on function public.is_university_user() is
  '認証境界の正本。全RLS policyと全SECURITY DEFINER RPCの必須条件。クライアントはaccessBlocked判定に使用';
revoke execute on function public.is_university_user() from public;
revoke execute on function public.is_university_user() from anon;
grant execute on function public.is_university_user() to authenticated;
