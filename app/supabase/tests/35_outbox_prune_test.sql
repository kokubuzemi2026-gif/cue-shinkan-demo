-- Task 019-T1: 送信し終えたoutbox行の剪定（D053）
-- Task 010が「古いoutbox行を消す経路が無い」と残し、Task 017が既知リスクE5として
-- 引き継いだ項目。**pending / sending は絶対に消さない**ことが最重要の不変条件。
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

-- ---- 権限: 掃除関数は誰からも呼べない（DB管理者のみ） ----
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'private' and p.proname = 'prune_email_outbox'
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0
           or a.grantee = 'anon'::regrole
           or a.grantee = 'authenticated'::regrole
           or a.grantee = 'service_role'::regrole)
  ),
  0,
  'T1: prune_email_outbox はanon・authenticated・service_role・PUBLICから呼べない'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'prune_email_outbox'),
  0,
  'T1: publicスキーマへは露出していない（PostgRESTから叩けない）'
);

-- ---- 下限の強制 ----
select throws_ok(
  $$select private.prune_email_outbox(6)$$,
  'P0001', 'invalid_retain_days',
  'T1: 7日未満の保持期間は拒否する'
);
select throws_ok(
  $$select private.prune_email_outbox(null)$$,
  'P0001', 'invalid_retain_days',
  'T1: NULLの保持期間も拒否する'
);
select lives_ok(
  $$select private.prune_email_outbox(7)$$,
  'T1: 下限ちょうど（7日）は通る'
);

-- ---- 掃除の対象 ----
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000f101', 'demo-prune@stu.kobe-u.ac.jp', now(), now(), now());
insert into public.student_accounts (user_id)
values ('00000000-0000-0000-0000-00000000f101');

-- updated_at は trg_set_updated_at が UPDATE のたびに now() を入れるため、
-- 古い時刻は **insert で直接** 置く（あとから update すると now() に上書きされる）
insert into private.email_outbox (kind, user_id, dedupe_key, status, next_attempt_at, updated_at) values
  -- 消える: 終わっていて十分に古い
  ('offer_arrival', '00000000-0000-0000-0000-00000000f101', 'p-sent-old',      'sent',      now(), now() - interval '100 days'),
  ('offer_arrival', '00000000-0000-0000-0000-00000000f101', 'p-failed-old',    'failed',    now(), now() - interval '100 days'),
  ('offer_arrival', '00000000-0000-0000-0000-00000000f101', 'p-cancelled-old', 'cancelled', now(), now() - interval '100 days'),
  -- 残る: 終わっているが新しい
  ('offer_arrival', '00000000-0000-0000-0000-00000000f101', 'p-sent-new',      'sent',      now(), now() - interval '10 days'),
  -- **残る: 終わっていない。どれだけ古くても消さない**
  ('offer_arrival', '00000000-0000-0000-0000-00000000f101', 'p-pending-old',   'pending',   now(), now() - interval '400 days'),
  ('offer_arrival', '00000000-0000-0000-0000-00000000f101', 'p-sending-old',   'sending',   now(), now() - interval '400 days');

select is(
  private.prune_email_outbox(90),
  3,
  'T1: 終わっていて保持期間より古い3件だけを消し、件数を返す'
);
select is(
  (select count(*)::int from private.email_outbox where dedupe_key like 'p-%-old' and status in ('sent','failed','cancelled')),
  0,
  'T1: sent・failed・cancelled の古い行は消えている'
);
select is(
  (select count(*)::int from private.email_outbox where dedupe_key = 'p-sent-new'),
  1,
  'T1: 保持期間内の行は残る'
);
select is(
  (select count(*)::int from private.email_outbox where dedupe_key = 'p-pending-old'),
  1,
  'T1: **pendingは400日前でも消さない**（消すと通知が二度と届かない）'
);
select is(
  (select count(*)::int from private.email_outbox where dedupe_key = 'p-sending-old'),
  1,
  'T1: **sendingは400日前でも消さない**（claim_email_batch が拾い直す対象）'
);
select is(
  private.prune_email_outbox(90),
  0,
  'T1: 2回目は0件（消すものが無ければ何も起きない）'
);
-- **引数が効いていることを検査する。** ここまでは既定の90日しか使っておらず、
-- `make_interval(days => retain_days)` を `days => 90` に固定した変異体が
-- 636件すべて通ってしまう（実際に確認した）。この時点で残っている終了済みの行は
-- p-sent-new（10日前）だけなので、7日を渡せば消える
select is(
  private.prune_email_outbox(7),
  1,
  'T1: retain_days=7 なら10日前の終了済み行も消える（引数が効いている）'
);

-- ---- 二重送信にならないこと ----
-- offer_arrival の dedupe_key は配信ID。積むのは
-- `after insert on private.offer_recipients` の文レベルトリガだけで、
-- 受信者行は配信時に1度しか入らない。過去の配信で再び積まれることはない。
-- ここでは「消したあと同じ dedupe_key を積み直せてしまう」ことを明示し、
-- 保持期間が配信履歴より十分に長いことを前提として固定する
select is(
  (select count(*)::int from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'offer_recipients' and not t.tgisinternal),
  1,
  'T1: outboxへ積むのは offer_recipients のトリガ1本だけ（再送の入口が増えていない）'
);
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'private.email_outbox'::regclass and contype = 'u'),
  'UNIQUE (kind, user_id, dedupe_key)',
  'T1: (kind, user_id, dedupe_key) の一意制約は残っている（同一世代の二重積みは防ぐ）'
);

-- ---- 剪定でPIIが増えないこと ----
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'private' and table_name = 'email_outbox'
      and column_name in ('email', 'to_address', 'subject', 'body', 'recipient_email')),
  0,
  'T1: email_outbox は宛先・件名・本文の列を持たない（剪定しても消す対象が無い・D041）'
);

-- ---- リポジトリ全体の不変条件: SECURITY DEFINER は search_path を固定する ----
-- 独立レビューとsecurity-reviewerが揃って指摘した既存の穴。
-- 0018から `set search_path = ''` を外しても、`security invoker` へ変えても、
-- **pgTAPは1件も落ちなかった**。実害は現状小さい（public に PUBLIC の CREATE が
-- 無いため差し替え用オブジェクトを置けない）が、`security definer` は呼び出し側の
-- search_path を引き継ぐため、修飾漏れと組み合わさると権限昇格の足場になる。
-- 個別の関数ではなくカタログを走査して固定する（今後のmigrationにも効く）
select is(
  (select coalesce(string_agg(p.proname::text, ', ' order by p.proname::text), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
         where c like 'search_path=%')),
  '',
  'T1: public・privateのSECURITY DEFINER関数は、すべてsearch_pathを固定している'
);

select * from finish();
rollback;
