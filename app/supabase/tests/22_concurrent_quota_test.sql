-- Task 011-T12: 学生の週間受信枠の原子的確保（D037）
-- 団体をまたぐ「実際に並行する」send_offerを2セッションで走らせ、
-- 学生の週間上限が破れないこと・部分配信やquotaだけの消費が残らないことを確認する。
--
-- 並行実行にはdblinkを使う（このテスト内でのみ作成し、rollbackで消える）。
-- 接続a・bはそれぞれ独立したセッション＝独立したトランザクションになるため、
-- pgTAPの単一トランザクション内からは作れない本物の競合を再現できる。
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink;
set local search_path = public, extensions;

select plan(9);

-- 接続情報（自分自身へ接続する。superuser実行のためdblink_connect_uを使う）
create function pg_temp.conninfo() returns text language sql as $$
  select 'dbname=' || current_database()
      || ' port=' || current_setting('port')
      || ' user=' || current_user
$$;

select dblink_connect_u('setup', pg_temp.conninfo());
select dblink_connect_u('conn_a', pg_temp.conninfo());
select dblink_connect_u('conn_b', pg_temp.conninfo());

-- 前回の失敗で残った可能性のあるデータを先に消す（冪等）
select dblink_exec('setup', $sql$
  delete from public.organizations where name in ('並行テスト団体A', '並行テスト団体B');
  delete from auth.users where email like 'demo-conc-%@stu.kobe-u.ac.jp';
$sql$);

-- ---- 固定データを別セッションでcommitする（テスト本体のトランザクションからは見えないため） ----
select dblink_exec('setup', $sql$
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
  values ('00000000-0000-0000-0000-00000000c001', 'demo-conc-owner@stu.kobe-u.ac.jp', now(), now(), now());
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
  select ('00000000-0000-0000-0000-000000c10' || to_char(n, 'FM000'))::uuid,
         'demo-conc-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
  from generate_series(1, 6) as n;
  insert into public.student_accounts (user_id)
  select ('00000000-0000-0000-0000-000000c10' || to_char(n, 'FM000'))::uuid
  from generate_series(1, 6) as n;
  -- 週間受信上限は1件。2団体が同時に配信しても、1人あたり1件を超えてはならない
  insert into public.student_passports (
    user_id, interests, purposes, style, frequency, available_days, experience,
    max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit
  )
  select ('00000000-0000-0000-0000-000000c10' || to_char(n, 'FM000'))::uuid,
    array['international']::public.interest_category[], array['friends','challenge']::public.purpose[],
    'moderate', 'monthly_1_2', array['weekend']::public.day_slot[], 'none',
    2000, false, array['international']::public.interest_category[], 1
  from generate_series(1, 6) as n;
$sql$);
select dblink_exec('setup', $sql$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', false);
  set role authenticated;
  select public.create_organization('並行テスト団体A');
  select public.create_organization('並行テスト団体B');
  reset role;
$sql$);
select dblink_exec('setup', $sql$
  update public.organizations set status = 'verified'
   where name in ('並行テスト団体A', '並行テスト団体B');
$sql$);

-- 送信用セッションの準備（例外を握りつぶして結果を文字列で返すラッパをpg_tempへ作る）
create function pg_temp.prepare_sender(conn text) returns void language sql as $$
  select dblink_exec(conn, $sql$
    select set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', false);
    create function pg_temp.try_send(org_name text, ev text) returns text
    language plpgsql as $fn$
    declare v_band text;
    begin
      set local role authenticated;
      select s.audience_band into v_band
        from public.send_offer(
          (select id from public.organizations where name = org_name),
          ev, '説明文', '届けたい理由', '9月13日（土）', '六甲ケーブル下',
          array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
          array['international']::public.interest_category[],
          array['friends','challenge']::public.purpose[], 10, '2026-09-10') s;
      return 'ok:' || v_band;
    exception when others then
      return 'error:' || sqlerrm;
    end
    $fn$;
  $sql$)
$$;
select pg_temp.prepare_sender('conn_a');
select pg_temp.prepare_sender('conn_b');

-- ---- 本番: Aがトランザクションを開いたまま枠を確保し、Bを同時に走らせる ----
select dblink_exec('conn_a', 'begin');
select dblink_send_query('conn_a', $sql$select pg_temp.try_send('並行テスト団体A', '同時配信A')$sql$);
create temp table res_a as
  select * from dblink_get_result('conn_a') as t(result text);
-- 非同期問い合わせは結果が尽きるまでget_resultを呼ぶ必要がある（残すと次のコマンドが出せない）
select count(*) from dblink_get_result('conn_a') as t(result text);

-- Aはまだcommitしていない（枠の行ロックを保持している）。ここでBを走らせる
select dblink_send_query('conn_b', $sql$select pg_temp.try_send('並行テスト団体B', '同時配信B')$sql$);
select pg_sleep(0.7);

-- Bがロック待ちで実際にブロックされていること（＝直列化が効いていること）を観測する
select ok(
  (select count(*) > 0 from pg_stat_activity a
    where a.datname = current_database()
      and a.wait_event_type = 'Lock'
      and a.state = 'active'),
  'T12: 2つ目の送信は1つ目が枠を確保している間ロック待ちになる（団体をまたいで直列化される）'
);

select is((select result from res_a), 'ok:5-9',
  'T12: 1つ目の送信は6人へ成立する');

-- Aをcommitして枠を解放する
select dblink_exec('conn_a', 'commit');
create temp table res_b as
  select * from dblink_get_result('conn_b') as t(result text);
select count(*) from dblink_get_result('conn_b') as t(result text);

select ok(
  (select result like 'error:%' from res_b),
  'T12: 2つ目の送信は、1つ目のcommit後に週上限を検知して失敗する'
);
select ok(
  (select result in ('error:insufficient_audience', 'error:no_recipients') from res_b),
  'T12: 失敗理由は配信可能人数不足（週上限で全員が対象外になったため）'
);

-- ---- 不変条件: 学生1人あたりの受信は週上限（1件）を超えない ----
select is(
  (select max(cnt)::int from (
     select r.user_id, count(*) as cnt
       from dblink('setup', $sql$
         select r.user_id, count(*)::bigint
           from private.offer_recipients r
           join private.offer_deliveries d on d.id = r.delivery_id
          where d.delivered_at > now() - interval '7 days'
          group by r.user_id
       $sql$) as r(user_id uuid, cnt bigint)
      group by r.user_id, r.cnt
   ) t),
  1,
  'T12: 並行配信後も、学生1人あたりの週間受信は上限1件を超えない（D037）'
);
select is(
  (select cnt::int from dblink('setup', $sql$
     select count(*)::bigint from private.offer_deliveries d
      join public.organizations o on o.id = d.organization_id
     where o.name = '並行テスト団体B'
   $sql$) as t(cnt bigint)),
  0,
  'T12: 失敗した送信の配信行は残らない（部分配信が起きない）'
);
select is(
  (select cnt::int from dblink('setup', $sql$
     select coalesce(sum(q.window_count), 0)::bigint
       from private.student_delivery_quota q
       join public.student_accounts sa on sa.user_id = q.user_id
      where sa.user_id::text like '00000000-0000-0000-0000-000000c10%'
   $sql$) as t(cnt bigint)),
  6,
  'T12: quotaは成立した配信の分だけ（6人×1件）で、失敗分の消費が残らない'
);

-- ---- 再試行で二重配信されない（同一イベントのfingerprint再送禁止） ----
select is(
  (select result from dblink('conn_a',
     $sql$select pg_temp.try_send('並行テスト団体A', '同時配信A')$sql$) as t(result text)),
  'error:duplicate_event',
  'T12: 同一イベントの再試行は duplicate_event で拒否され、二重配信されない'
);

-- ---- 並行トランザクションのdelivered_atが自分より後でも週枠に数える ----
-- （自トランザクション開始時刻で上限を閉じると、後からcommitされた配信を取りこぼす）
select dblink_exec('setup', $sql$
  update private.offer_deliveries set delivered_at = now() + interval '5 seconds'
   where organization_id = (select id from public.organizations where name = '並行テスト団体A');
$sql$);
select is(
  (select result from dblink('conn_b',
     $sql$select pg_temp.try_send('並行テスト団体B', '未来時刻の同時配信')$sql$) as t(result text)),
  'error:no_recipients',
  'T12: 自分より後の時刻でcommitされた配信も週枠に数える（取りこぼしで上限が破れない）'
);

-- ---- 後片付け（別セッションでcommitしたデータを明示的に消す） ----
select dblink_exec('setup', $sql$
  delete from public.organizations where name in ('並行テスト団体A', '並行テスト団体B');
  delete from auth.users where email like 'demo-conc-%@stu.kobe-u.ac.jp';
$sql$);
select dblink_disconnect('conn_a');
select dblink_disconnect('conn_b');
select dblink_disconnect('setup');

select * from finish();
rollback;
