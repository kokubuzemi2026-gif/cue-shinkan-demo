-- T14: 招待が単一使用・有効期限・取消を守る
-- T15: 他団体のowner/adminが招待を作成・取消できない
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000501', 'demo-inv-owner@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000502', 'demo-inv-admin@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000503', 'demo-inv-member@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000504', 'demo-inv-other@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000505', 'demo-inv-new1@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000506', 'demo-inv-new2@stu.kobe-u.ac.jp', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000507', 'demo-inv-outside@example.com', now(), now(), now());

-- org1（owner=501）とorg2（owner=504）
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated"}', true);
-- Task 015: 同意ゲートを通すため、作成済みの全ユーザーへ同意を記録する（テスト用）
insert into public.student_consents (user_id, consent_version)
  select id, private.current_consent_version() from auth.users on conflict (user_id) do nothing;
set local role authenticated;
create temp table iorg1 as select public.create_organization('招待テスト団体') as id;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000504","role":"authenticated"}', true);
set local role authenticated;
create temp table iorg2 as select public.create_organization('別団体') as id;
reset role;

-- org1へadmin(502)とmember(503)を追加（postgres・運営相当）
insert into public.organization_memberships (organization_id, user_id, role, member_label)
select id, '00000000-0000-0000-0000-000000000502', 'admin', '担当者-INVAD1' from iorg1;
insert into public.organization_memberships (organization_id, user_id, role, member_label)
select id, '00000000-0000-0000-0000-000000000503', 'member', '担当者-INVME1' from iorg1;

-- ---- 作成権限: ownerは可 / memberは不可 / 他団体ownerは不可 / owner役の招待は不可 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated"}', true);
set local role authenticated;
create temp table inv1 as select * from public.create_invitation((select id from iorg1));
select is(
  (select char_length(token)::int from inv1),
  64,
  'F7: 生トークンは256bit（hex 64文字）で一度だけ返る'
);
select throws_ok(
  $$select public.create_invitation((select id from iorg1), 'owner')$$,
  'invalid_invited_role',
  'F7: owner役の招待は作成できない'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000503","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_invitation((select id from iorg1))$$,
  'not_authorized',
  'T15: memberは招待を作成できない'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000504","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_invitation((select id from iorg1))$$,
  'not_authorized',
  'T15: 他団体のownerはこの団体の招待を作成できない'
);
reset role;

-- ---- 承諾: 大学ユーザーが1回だけ使える ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000505","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select * from public.accept_invitation((select token from inv1))$$,
  'F11: 大学ユーザーは有効な招待を承諾できる'
);
reset role;
select is(
  (select count(*)::int from public.organization_memberships
    where organization_id = (select id from iorg1)
      and user_id = '00000000-0000-0000-0000-000000000505'
      and role = 'member'),
  1,
  'F11: 承諾でmember所属が作成される'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000506","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.accept_invitation((select token from inv1))$$,
  'invalid_invitation',
  'T14: 使用済み招待は再利用できない（単一使用）'
);
reset role;

-- ---- 既メンバーの承諾はトークンを消費しない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated"}', true);
set local role authenticated;
create temp table inv2 as select * from public.create_invitation((select id from iorg1));
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000505","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.accept_invitation((select token from inv2))$$,
  'already_member',
  'F11: 既メンバーの承諾はalready_member'
);
reset role;
select is(
  (select used_at from private.organization_invitations
    where id = (select invitation_id from inv2)),
  null::timestamptz,
  'F11: already_memberではトークンを消費しない'
);

-- ---- 有効期限 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated"}', true);
set local role authenticated;
create temp table inv3 as select * from public.create_invitation((select id from iorg1));
reset role;
update private.organization_invitations
   set expires_at = now() - interval '1 second'
 where id = (select invitation_id from inv3);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000506","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.accept_invitation((select token from inv3))$$,
  'invalid_invitation',
  'T14: 期限切れ招待は承諾できない'
);
reset role;

-- ---- 取消: adminは取消可 / 他団体・memberは不可 / 取消後は承諾不可 ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated"}', true);
set local role authenticated;
create temp table inv4 as select * from public.create_invitation((select id from iorg1));
create temp table inv5 as select * from public.create_invitation((select id from iorg1));
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000504","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.revoke_invitation((select invitation_id from inv4))$$,
  'invalid_invitation',
  'T15: 他団体のownerは取消できない'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000503","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.revoke_invitation((select invitation_id from inv4))$$,
  'invalid_invitation',
  'T15: memberは取消できない'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000502","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.revoke_invitation((select invitation_id from inv4))$$,
  'F8: adminは未使用招待を取消できる'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000506","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.accept_invitation((select token from inv4))$$,
  'invalid_invitation',
  'T14: 取消済み招待は承諾できない'
);

-- ---- プレビュー: 有効な招待だけ団体名を開示。無効理由は区別しない ----
select is(
  (select organization_name from public.preview_invitation((select token from inv5))),
  '招待テスト団体',
  'F10: 承諾前に団体名を確認できる'
);
select throws_ok(
  $$select * from public.preview_invitation((select token from inv1))$$,
  'invalid_invitation',
  'F10: 使用済みトークンのプレビューは単一の無効エラー'
);
reset role;

-- ---- ドメイン外ユーザーは承諾できない ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000507","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.accept_invitation((select token from inv5))$$,
  'not_university_user',
  'F11: ドメイン外ユーザーは招待を承諾できない'
);
reset role;

select * from finish();
rollback;
