-- Task 010-T15: 通知まわりの権限とPIIサーフェス（D029・D042）
-- （outboxへ到達できない / 送信ワーカー用RPCはservice_role専用 /
--   outboxに宛先・本文の列が無い / 他人の設定を読めない・書けない /
--   通知RPCの戻り列に学生の希望条件・団体情報が現れない）
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000f2001', 'demo-np-a@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000f2002', 'demo-np-b@stu.kobe-u.ac.jp', now(), now(), now());
insert into public.student_accounts (user_id) values
  ('00000000-0000-0000-0000-0000000f2001'),
  ('00000000-0000-0000-0000-0000000f2002');

-- ---- outboxはanon/authenticatedから到達できない ----
select ok(not has_table_privilege('anon', 'private.email_outbox', 'SELECT'),
  'T15: anonはoutboxを読めない');
select ok(not has_table_privilege('authenticated', 'private.email_outbox', 'SELECT'),
  'T15: authenticatedはoutboxを読めない');
select ok(not has_table_privilege('authenticated', 'private.email_outbox', 'INSERT'),
  'T15: authenticatedはoutboxへ書けない');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'T15: authenticatedはprivateスキーマへ到達できない');

-- ---- outboxに宛先メール・本文の列が存在しない（D029） ----
select is_empty(
  $$select column_name::text from information_schema.columns
     where table_schema = 'private' and table_name = 'email_outbox'
       and (column_name ~ 'email' or column_name ~ 'address' or column_name ~ 'body'
            or column_name ~ 'subject' or column_name ~ 'recipient' or column_name ~ 'content')$$,
  'T15: outboxに宛先メール・件名・本文の列が存在しない'
);
select is(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.columns
    where table_schema = 'private' and table_name = 'email_outbox'),
  'attempts,created_at,dedupe_key,id,kind,last_error_code,next_attempt_at,sent_at,status,updated_at,user_id',
  'T15: outboxの列は送信の予定と結果だけ'
);

-- ---- 送信ワーカー用RPCはservice_role専用 ----
select ok(not has_function_privilege('anon', 'public.claim_email_batch(integer)', 'EXECUTE'),
  'T15: anonはclaim_email_batchを実行できない');
select ok(not has_function_privilege('authenticated', 'public.claim_email_batch(integer)', 'EXECUTE'),
  'T15: authenticatedはclaim_email_batchを実行できない');
select ok(has_function_privilege('service_role', 'public.claim_email_batch(integer)', 'EXECUTE'),
  'T15: service_roleだけがclaim_email_batchを実行できる');
select ok(not has_function_privilege('authenticated', 'public.complete_email(uuid, boolean, text)', 'EXECUTE'),
  'T15: authenticatedはcomplete_emailを実行できない');
select ok(not has_function_privilege('authenticated', 'public.email_outbox_health()', 'EXECUTE'),
  'T15: authenticatedはoutboxの健全性を読めない');

-- 実際の呼出しも拒否される
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000f2001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  'select * from public.claim_email_batch(10)',
  '42501', null,
  'T15: authenticatedのclaim_email_batch呼出はpermission denied'
);
select throws_ok(
  $$select public.complete_email('00000000-0000-0000-0000-000000000001', true)$$,
  '42501', null,
  'T15: authenticatedのcomplete_email呼出はpermission denied'
);

-- ---- 通知設定は本人だけ ----
select lives_ok(
  $$select public.save_notification_settings('daily')$$,
  'T15: 学生本人は自分の通知設定を保存できる'
);
select is(
  (select count(*)::int from public.student_notification_settings),
  1,
  'T15: RLSにより自分の設定行だけが見える'
);
reset role;

-- 相手の行を作ってから、他人からは見えないことを確かめる
insert into public.student_notification_settings (user_id, mode)
values ('00000000-0000-0000-0000-0000000f2002', 'off');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000f2001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.student_notification_settings),
  1,
  'T15: 他人の通知設定は見えない'
);
select throws_ok(
  $$update public.student_notification_settings set mode = 'each'
     where user_id = '00000000-0000-0000-0000-0000000f2002'$$,
  '42501', null,
  'T15: 直接UPDATEはgrantが無く拒否される（書込はRPCのみ）'
);
reset role;

-- ---- 学生権限が無ければ設定できない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000ffff","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.save_notification_settings('each')$$,
  'P0001', 'not_student',
  'T15: 学生権限が無ければ通知設定を保存できない'
);
reset role;

-- ---- 通知RPCの戻り列に学生の希望条件・団体情報が現れない ----
select is_empty(
  $$select p.proname::text from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(coalesce(p.proargnames, '{}')) as a(argname)
    where n.nspname = 'public'
      and p.proname in ('claim_email_batch', 'complete_email', 'email_outbox_health',
                        'save_notification_settings')
      and a.argname ~* '(interest|purpose|budget|fee|style|day|org|event|passport|response)'$$,
  'T15: 通知RPCの引数・戻り列に希望条件・団体情報・返答状態が現れない'
);

select * from finish();
rollback;
