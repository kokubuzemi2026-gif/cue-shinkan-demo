-- 1回の取り出しは batch_size を超えない（D055）
-- CIで batch_size=3 に対して6件掴む事象が出た。IN サブクエリ内の
-- `for update skip locked limit` がプラン次第で再実行され得たため。
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

-- ---- 準備: 送信期限が来ている6件 ----
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-00000000cb' || to_char(n, 'FM00'))::uuid,
       'demo-cb' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-00000000cb' || to_char(n, 'FM00'))::uuid
from generate_series(1, 6) as n;
insert into public.student_notification_settings (user_id, mode)
select ('00000000-0000-0000-0000-00000000cb' || to_char(n, 'FM00'))::uuid, 'each'
from generate_series(1, 6) as n;
-- **同一文で入れるので next_attempt_at は全て同値**。同着の並び順が不安定でも
-- 超過取得が起きないことを見る（これが今回の回帰そのもの）
insert into private.email_outbox (kind, user_id, dedupe_key, status, next_attempt_at)
select 'offer_arrival',
       ('00000000-0000-0000-0000-00000000cb' || to_char(n, 'FM00'))::uuid,
       'cb-' || n, 'pending', now() - interval '1 minute'
from generate_series(1, 6) as n;

-- 呼び出しは所有者（postgres）のまま行う。関数は security definer なので
-- 実行結果はロールに依らない。service_role からの実行可否そのものは
-- 25_notification_privacy_test.sql が固定している
-- ---- 契約: 返る行数も、sendingへ進む行数も batch_size まで ----
select is(
  (select count(*)::int from public.claim_email_batch(3)),
  3,
  'T1: batch_size=3 なら3件しか返らない（6件掴む回帰の検知）'
);
select is(
  (select count(*)::int from private.email_outbox where dedupe_key like 'cb-%' and status = 'sending'),
  3,
  'T1: sendingへ進むのも3件だけ'
);
select is(
  (select coalesce(max(attempts), 0)::int from private.email_outbox where dedupe_key like 'cb-%'),
  1,
  'T1: 二重には掴まない（attemptsが1を超えない）'
);
-- 残り3件を次の取り出しで拾える
select is(
  (select count(*)::int from public.claim_email_batch(3)),
  3,
  'T1: 続けて呼ぶと残り3件を拾う'
);
select is(
  (select count(*)::int from private.email_outbox where dedupe_key like 'cb-%' and status = 'sending'),
  6,
  'T1: 2回で6件すべてがsendingへ進む'
);
select is(
  (select count(*)::int from public.claim_email_batch(3)),
  0,
  'T1: 掴むものが無ければ0件（sendingはleaseが切れるまで拾い直さない）'
);

-- ---- 境界 ----
insert into private.email_outbox (kind, user_id, dedupe_key, status, next_attempt_at)
select 'offer_arrival',
       ('00000000-0000-0000-0000-00000000cb' || to_char(n, 'FM00'))::uuid,
       'cb2-' || n, 'pending', now() - interval '1 minute'
from generate_series(1, 6) as n;
select is((select count(*)::int from public.claim_email_batch(1)), 1,
  'T1: batch_size=1 なら1件');
select is((select count(*)::int from public.claim_email_batch(200)), 5,
  'T1: batch_size が残数より大きければ残り全部（5件）');

select throws_ok(
  $$select * from public.claim_email_batch(0)$$,
  'P0001', 'invalid_batch_size',
  'T1: batch_size=0 は拒否する'
);
select throws_ok(
  $$select * from public.claim_email_batch(201)$$,
  'P0001', 'invalid_batch_size',
  'T1: batch_size=201 は拒否する'
);

-- ---- 実装の不変条件を固定する ----
-- 掴む行の確定は `as materialized` のCTEで1度だけ評価する。
-- IN サブクエリへ戻すと、プラン次第で再実行され超過取得が起きる
select ok(
  (select pg_get_functiondef(p.oid) like '%picked as materialized%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_email_batch'),
  'T1: 掴む行の確定が `as materialized` のCTEで1度だけ評価される'
);
-- 同着順の決定性も固定する（契約4・D055）。同着順の不安定さは
-- CI事象の成立条件の一つで、`, c.id` だけが黙って消える回帰を検出できないと
-- 二重防御の一方が失われる（`c.id` を外した変異体が11件全部通ることを実測した）
select ok(
  (select pg_get_functiondef(p.oid) like '%order by c.next_attempt_at, c.id%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_email_batch'),
  'T1: 同着順が `order by c.next_attempt_at, c.id` で決定的である'
);

select * from finish();
rollback;
