#!/usr/bin/env bash
# Task 011: 学生の週間受信枠が、団体をまたぐ「実際に並行する」send_offerでも破れないことを検証する。
#
# pgTAPは1ファイル=1セッション=1トランザクションのため、本物の競合を再現できない。
# dblinkはSupabaseのローカルスタックでは postgres が superuser ではなく
# dblink_connect_u を実行できないため使えない。
# そこで psql を2プロセス起動して、実際に並行するトランザクションを作る。
#
# 使い方:
#   CUE_DB_URL=postgresql://... scripts/concurrency_test.sh
# 既定はSupabaseローカルスタックのDB。
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "psql が見つかりません。PostgreSQLクライアントを入れてから実行してください。" >&2
  exit 1
fi

DB_URL="${CUE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -q -tA --no-psqlrc)

OWNER='00000000-0000-0000-0000-0000000cc001'
CLAIMS="{\"sub\":\"$OWNER\",\"role\":\"authenticated\"}"
ORG_A='並行検証団体A'
ORG_B='並行検証団体B'
ORG_C='並行検証団体C'
ORG_D='並行検証団体D'
FAILURES=0

note() { printf '%s\n' "$1"; }
check() { # check <説明> <期待> <実際>
  if [ "$2" = "$3" ]; then
    note "  ok   - $1"
  else
    note "  FAIL - $1 (期待: $2 / 実際: $3)"
    FAILURES=$((FAILURES + 1))
  fi
}

cleanup() {
  "${PSQL[@]}" >/dev/null <<SQL || true
delete from public.organizations where name in ('$ORG_A', '$ORG_B', '$ORG_C', '$ORG_D');
delete from auth.users where email like 'demo-conc-%@stu.kobe-u.ac.jp';
SQL
}
trap cleanup EXIT

note 'Task 011 並行配信テスト: 準備'
cleanup
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values ('$OWNER', 'demo-conc-owner@stu.kobe-u.ac.jp', now(), now(), now());
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000cc1' || to_char(n, 'FM00'))::uuid,
       'demo-conc-s' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-0000000cc1' || to_char(n, 'FM00'))::uuid
from generate_series(1, 6) as n;
-- 週間受信上限は1件。2団体が同時に配信しても1人あたり1件を超えてはならない。
-- カテゴリは他のテストと混ざらない international を使う
insert into public.student_passports (
  user_id, interests, purposes, style, frequency, available_days, experience,
  max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit)
select ('00000000-0000-0000-0000-0000000cc1' || to_char(n, 'FM00'))::uuid,
  array['international']::public.interest_category[],
  array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2',
  array['weekend']::public.day_slot[], 'none', 2000, false,
  array['international']::public.interest_category[], 1
from generate_series(1, 6) as n;
-- 枠の行を先に作っておく（実運用の定常状態）。
-- 行が無い状態だと ON CONFLICT DO NOTHING の一意制約待ちが偶然の直列化を生み、
-- 明示的な FOR UPDATE が無くてもテストが通ってしまう
insert into private.student_delivery_quota (user_id)
select ('00000000-0000-0000-0000-0000000cc1' || to_char(n, 'FM00'))::uuid
from generate_series(1, 6) as n
on conflict (user_id) do nothing;
select set_config('request.jwt.claims', '$CLAIMS', false);
set role authenticated;
select public.create_organization('$ORG_A');
select public.create_organization('$ORG_B');
select public.create_organization('$ORG_C');
select public.create_organization('$ORG_D');
reset role;
update public.organizations set status = 'verified'
 where name in ('$ORG_A', '$ORG_B', '$ORG_C', '$ORG_D');
SQL

# Task 011: 送信は24時間以内の同一条件previewを必須とするため、送信前にpreviewを通す。
# previewは同一条件なら回数を消費しないので、何度呼んでも条件数は1のまま
send_sql() { # send_sql <団体名> <イベント名>
  cat <<SQL
select set_config('request.jwt.claims', '$CLAIMS', true);
set local role authenticated;
select 1 from public.preview_offer_audience(
  (select id from public.organizations where name = '$1'),
  '$2', '説明文', '届けたい理由', '9月13日（土）', '六甲ケーブル下',
  array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
  array['international']::public.interest_category[],
  array['friends','challenge']::public.purpose[], 10, '2026-09-10');
select s.audience_band from public.send_offer(
  (select id from public.organizations where name = '$1'),
  '$2', '説明文', '届けたい理由', '9月13日（土）', '六甲ケーブル下',
  array['weekend']::public.day_slot[], 'monthly_1_2', 1500, true, 'moderate',
  array['international']::public.interest_category[],
  array['friends','challenge']::public.purpose[], 10, '2026-09-10') s;
reset role;
SQL
}

note 'Task 011 並行配信テスト: 2セッションを同時に走らせる'
OUT_A="$(mktemp)"; OUT_B="$(mktemp)"
# Aは枠を確保したままトランザクションを開いて待つ
{
  printf 'begin;\n'
  send_sql "$ORG_A" '同時配信A'
  printf 'select pg_sleep(4);\ncommit;\n'
} | "${PSQL[@]}" >"$OUT_A" 2>&1 &
PID_A=$!

# Aがロックを取るのを待ってからBを走らせる（Bは枠のロック待ちでブロックする）
sleep 1.5
# Bも明示トランザクションで囲む。SET LOCAL / set_config(..., true) は
# トランザクション外では捨てられ、権限コンテキストが設定されない
{
  printf 'begin;\n'
  send_sql "$ORG_B" '同時配信B'
  printf 'commit;\n'
} | "${PSQL[@]}" >"$OUT_B" 2>&1 &
PID_B=$!
sleep 1.5
# Bがロック待ちで止まっていることを観測する。
# 注意: これは「直列化されている」ことの傍証にすぎない。
#   枠のFOR UPDATEを外しても、枠行への UPDATE / ON CONFLICT DO NOTHING が
#   同じ待ちを生むため、この観測だけでは実装の正しさを判別できない
#   （変異テストで確認済み）。判別しているのは第2フェーズ。
# 対象を「送信中のRPCを実行しているバックエンド」に限定して偽陽性を減らす
LOCK_WAITERS="$("${PSQL[@]}" -c "select count(*)::int from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%send_offer%'" || echo 0)"

wait $PID_A || true
wait $PID_B || true

RESULT_A="$(tr -d '\r' < "$OUT_A" | grep -E '^[0-9]+-[0-9]+$|^[0-9]+\+$|^0$' | head -1 || true)"
RESULT_B="$(tr -d '\r' < "$OUT_B" | head -20 | tr '\n' ' ')"

note 'Task 011 並行配信テスト: 検証'
check '2つ目の送信がロック待ちになる（直列化の傍証。判別は第2フェーズ）' 'yes' \
  "$([ "${LOCK_WAITERS:-0}" -ge 1 ] && echo yes || echo no)"
check '1つ目の送信は6人へ成立し、区分 5-9 を返す' '5-9' "$RESULT_A"
check '2つ目の送信は週上限を検知して失敗する' 'yes' \
  "$(echo "$RESULT_B" | grep -qE 'no_recipients|insufficient_audience' && echo yes || echo no)"

MAXCNT="$("${PSQL[@]}" -c "select coalesce(max(c), 0)::int from (select count(*) as c from private.offer_recipients r join private.offer_deliveries d on d.id = r.delivery_id where d.delivered_at > now() - interval '7 days' group by r.user_id) t")"
check '学生1人あたりの週間受信は上限1件を超えない' '1' "$MAXCNT"

BROWS="$("${PSQL[@]}" -c "select count(*)::int from private.offer_deliveries d join public.organizations o on o.id = d.organization_id where o.name = '$ORG_B'")"
check '失敗した送信の配信行は残らない（部分配信が起きない）' '0' "$BROWS"

QUOTA="$("${PSQL[@]}" -c "select coalesce(sum(q.window_count), 0)::int from private.student_delivery_quota q where q.user_id::text like '00000000-0000-0000-0000-0000000cc1%'")"
check 'quotaは成立した配信の分だけ（6人×1件）で、失敗分の消費が残らない' '6' "$QUOTA"

rm -f "$OUT_A" "$OUT_B"

# ---- 第2フェーズ: 遅延を入れず4団体を同時に走らせる ----
# 第1フェーズは「Aが枠を確保している間にBが来る」形しか作れない。
# 実際の競合は「複数の送信が評価と枠確保の間で交錯する」形でも起きるため、
# 人工的な待ちを入れずに同時起動して不変条件を確かめる。
note 'Task 011 並行配信テスト: 遅延なしで4団体を同時起動'
"${PSQL[@]}" >/dev/null <<SQL
delete from private.offer_deliveries d using public.organizations o
 where o.id = d.organization_id
   and o.name in ('$ORG_A', '$ORG_B', '$ORG_C', '$ORG_D');
update private.student_delivery_quota set window_count = 0
 where user_id::text like '00000000-0000-0000-0000-0000000cc1%';
SQL

STRESS_PIDS=()
STRESS_OUT="$(mktemp -d)"
for org in "$ORG_A" "$ORG_B" "$ORG_C" "$ORG_D"; do
  {
    printf 'begin;\n'
    send_sql "$org" "同時多発-$org"
    printf 'commit;\n'
  } | "${PSQL[@]}" >"$STRESS_OUT/$org" 2>&1 &
  STRESS_PIDS+=($!)
done
for pid in "${STRESS_PIDS[@]}"; do wait "$pid" || true; done

STRESS_OK="$(grep -l '^5-9$' "$STRESS_OUT"/* 2>/dev/null | wc -l | tr -d ' ')"
check '同時起動4件のうち成立するのは1件だけ' '1' "$STRESS_OK"
STRESS_MAX="$("${PSQL[@]}" -c "select coalesce(max(c), 0)::int from (select count(*) as c from private.offer_recipients r join private.offer_deliveries d on d.id = r.delivery_id where d.delivered_at > now() - interval '7 days' group by r.user_id) t")"
check '同時多発でも学生1人あたりの週間受信は上限1件を超えない' '1' "$STRESS_MAX"
rm -rf "$STRESS_OUT"

if [ "$FAILURES" -gt 0 ]; then
  note "Task 011 並行配信テスト: FAIL（$FAILURES 件）"
  exit 1
fi
note 'Task 011 並行配信テスト: PASS（8件）'
