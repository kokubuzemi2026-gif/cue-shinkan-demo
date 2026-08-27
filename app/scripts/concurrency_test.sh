#!/usr/bin/env bash
# Task 011: 学生の週間受信枠が、団体をまたぐ「実際に並行する」send_offerでも破れないことを検証する。
# Task 014: 最後のownerが並行する脱退で失われないことも、同じ方法で検証する。
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
ORG_LEAVE='並行脱退検証団体'
LEAVE_1='00000000-0000-0000-0000-0000000cc801'
LEAVE_2='00000000-0000-0000-0000-0000000cc802'
WORKER_TAG='demo-worker-'
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
delete from public.organizations where name in ('$ORG_A', '$ORG_B', '$ORG_C', '$ORG_D', '$ORG_LEAVE');
delete from auth.users where email like 'demo-conc-%@stu.kobe-u.ac.jp';
delete from auth.users where email like 'demo-leave-%@stu.kobe-u.ac.jp';
delete from auth.users where email like '${WORKER_TAG}%@stu.kobe-u.ac.jp';
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
-- Task 015: 同意ゲートを通す
insert into public.student_consents (user_id, consent_version)
values ('$OWNER', private.current_consent_version()) on conflict (user_id) do nothing;
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

# ---- Task 014: 最後のownerが並行する脱退で失われないこと ----
# ownerが2人の団体で2人が同時に leave_organization を呼ぶと、ロックを取らない
# 存在判定では互いに相手を「まだいる」と見て両方が通過し、ownerが0人になる。
# 復旧経路が無い（owner membershipは create_organization でしか作れず、
# 招待は owner を招待できない）ため、必ず1人は残らなければならない
note 'Task 014 並行脱退テスト: 準備'
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
  ('$LEAVE_1', 'demo-leave-1@stu.kobe-u.ac.jp', now(), now(), now()),
  ('$LEAVE_2', 'demo-leave-2@stu.kobe-u.ac.jp', now(), now(), now());
insert into public.student_consents (user_id, consent_version)
values ('$LEAVE_1', private.current_consent_version()) on conflict (user_id) do nothing;
select set_config('request.jwt.claims',
  '{"sub":"$LEAVE_1","role":"authenticated"}', false);
set role authenticated;
select public.create_organization('$ORG_LEAVE');
reset role;
insert into public.organization_memberships (organization_id, user_id, role, member_label)
select id, '$LEAVE_2', 'owner', '担当2' from public.organizations where name = '$ORG_LEAVE';
SQL

leave_sql() { # leave_sql <user id>
  cat <<SQL
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
set local role authenticated;
select public.leave_organization((select id from public.organizations where name = '$ORG_LEAVE'));
reset role;
SQL
}

note 'Task 014 並行脱退テスト: 2人のownerを同時に脱退させる'
LEAVE_OUT="$(mktemp -d)"
{
  printf 'begin;\n'
  leave_sql "$LEAVE_1"
  printf 'select pg_sleep(2);\ncommit;\n'
} | "${PSQL[@]}" >"$LEAVE_OUT/a" 2>&1 &
LEAVE_A=$!
sleep 1
{
  printf 'begin;\n'
  leave_sql "$LEAVE_2"
  printf 'commit;\n'
} | "${PSQL[@]}" >"$LEAVE_OUT/b" 2>&1 &
LEAVE_B=$!
wait "$LEAVE_A" || true
wait "$LEAVE_B" || true

LEAVE_OWNERS="$("${PSQL[@]}" -c "select count(*)::int from public.organization_memberships m join public.organizations o on o.id = m.organization_id where o.name = '$ORG_LEAVE' and m.role = 'owner'")"
check '同時に脱退しても代表者は1人残る（管理者不在の団体を作らない）' '1' "$LEAVE_OWNERS"
# psqlはERROR行とCONTEXT行の両方にlast_ownerを出すため、ファイル単位で数える
LEAVE_REJECTED="$(grep -l 'ERROR:  last_owner' "$LEAVE_OUT"/* 2>/dev/null | wc -l | tr -d ' ')"
check '2人目の脱退は last_owner で拒否される' '1' "$LEAVE_REJECTED"
rm -rf "$LEAVE_OUT"

# ---- Task 017: 送信ワーカーの並行取り出し ----
# claim_email_batch は `for update skip locked` を使う。2つのワーカーが同時に
# 走っても (1) 同じ行を二重に掴まない (2) 相手のロック待ちで止まらない、
# の2点を実際に並行させて確かめる。
# pgTAPは1ファイル=1セッションなので、この2点はpgTAPでは検証できない。
note 'Task 017 ワーカー並行テスト: 準備'
# **安全弁**: このフェーズは claim_email_batch を直接呼ぶ。同RPCは
# `order by next_attempt_at` で**送信期限が来ている行なら何でも**掴んで
# sending へ進め、attempts を +1 する。実データのあるDBへ誤って向けると、
# 実在の pending が最大6件 sending へ落ち、leaseが切れるまで滞留する。
# 合成データ以外の利用者が居るDBでは走らせない
REAL_USERS="$("${PSQL[@]}" -c "select count(*)::int from auth.users where email not like 'demo-%'")"
if [ "${REAL_USERS:-0}" -ne 0 ]; then
  note "  中止 - demo- 以外の利用者が ${REAL_USERS} 人います。このスクリプトは合成データ専用です"
  exit 1
fi
# 第1〜3フェーズが積んだ outbox 行を消してから始める。
# 残っていると claim_email_batch が next_attempt_at 順にそちらを先に掴み、
# 「6件すべてがsendingへ進む」が本フェーズの行を数えられなくなる
"${PSQL[@]}" >/dev/null <<SQL
delete from private.email_outbox;
SQL
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000cc9' || to_char(n, 'FM00'))::uuid,
       '${WORKER_TAG}' || n || '@stu.kobe-u.ac.jp', now(), now(), now()
from generate_series(1, 6) as n;
insert into public.student_accounts (user_id)
select ('00000000-0000-0000-0000-0000000cc9' || to_char(n, 'FM00'))::uuid
from generate_series(1, 6) as n;
insert into public.student_notification_settings (user_id, mode)
select ('00000000-0000-0000-0000-0000000cc9' || to_char(n, 'FM00'))::uuid, 'each'
from generate_series(1, 6) as n;
-- 送信期限が来ている6件を積む
insert into private.email_outbox (kind, user_id, dedupe_key, status, next_attempt_at)
select 'offer_arrival',
       ('00000000-0000-0000-0000-0000000cc9' || to_char(n, 'FM00'))::uuid,
       'worker-' || n, 'pending', now() - interval '1 minute'
from generate_series(1, 6) as n;
SQL

claim_sql() { # claim_sql <batch size>
  # **`as materialized` を外さないこと。**
  # `claim_email_batch` は volatile な集合返し関数で、行を掴む副作用を持つ。
  # `select count(*) from public.claim_email_batch(3)` と素で書くと、
  # プランによっては関数ノードが再スキャンされ、**2回実行されて6件掴む**。
  # CIで実際に「Aが6件・Bが0件」が1度出た（ローカルでは再現しない）。
  # 観測はすべて整合する: count=6 / Bは掴めない / どの行もattempts=1。
  # `as materialized` は関数を1度だけ評価してCTEへ格納するため、再スキャンが起きない
  cat <<SQL
set local role service_role;
with claimed as materialized (
  select * from public.claim_email_batch($1)
)
select count(*) as claimed from claimed;
reset role;
SQL
}

note 'Task 017 ワーカー並行テスト: 2つのワーカーを同時に走らせる'
WORKER_OUT="$(mktemp -d)"
# A: 3件掴んで5秒握ったままにする
{
  printf 'begin;\n'
  claim_sql 3
  printf 'select pg_sleep(5);\ncommit;\n'
} | "${PSQL[@]}" >"$WORKER_OUT/a" 2>&1 &
WORKER_A=$!
# **固定sleepで同期しない。** Aのpsql起動が遅れるとBが先に掴んでしまい、
# `skip locked` を外した変異体でも全件okになる（空振りPASS）。
#
# ただし「掴んだ行が見えるまで待つ」のも**誤り**。claim_email_batch は
# Aの未commitトランザクション内なので、別セッションからは commit まで
# 見えない。それを待つとAが commit してロックを手放した後にBを起動することになり、
# やはり変異体を検出できない（実際にそうなることを確認した）。
#
# 観測すべきは「Aが掴み終えて、まだ握ったまま眠っている」瞬間。
# pg_stat_activity で **Aが pg_sleep を実行中**であることを見る。
# claim の次の文が pg_sleep なので、これが active ＝ claim は完了し、
# 行ロックは保持されたまま（トランザクションは開いている）。
# 自分自身のポーリング問い合わせは `select count(` で始まるため前方一致しない
A_HOLDING=no
for _ in $(seq 1 100); do
  HOLD="$("${PSQL[@]}" -c "select count(*)::int from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state = 'active' and query like 'select pg_sleep(5)%'" || echo 0)"
  if [ "${HOLD:-0}" -ge 1 ]; then A_HOLDING=yes; break; fi
  sleep 0.1
done
if [ "$A_HOLDING" != yes ]; then
  note "  FAIL - ワーカーAが10秒以内に枠を握った状態になりませんでした"
  FAILURES=$((FAILURES + 1))
fi
# B: Aがロックを握っている最中に走る。skip lockedなら待たずに残りを掴める
B_START=$(date +%s%N)
{
  printf 'begin;\n'
  claim_sql 3
  printf 'commit;\n'
} | "${PSQL[@]}" >"$WORKER_OUT/b" 2>&1
B_ELAPSED_MS=$(( ($(date +%s%N) - B_START) / 1000000 ))
wait "$WORKER_A" || true

note 'Task 017 ワーカー並行テスト: 検証'
# 先頭1文字ではなく最初の数値行を取る（batch sizeが10以上でも壊れない）
A_CLAIMED="$(grep -oE '^[0-9]+$' "$WORKER_OUT/a" | head -1)"
B_CLAIMED="$(grep -oE '^[0-9]+$' "$WORKER_OUT/b" | head -1)"
BEFORE_FAIL=$FAILURES
check 'ワーカーAは3件掴む' '3' "$A_CLAIMED"
check 'ワーカーBも3件掴む（Aが握っている行を飛ばして残りを取る）' '3' "$B_CLAIMED"
if [ "$FAILURES" -ne "$BEFORE_FAIL" ]; then
  # 掴んだ件数が想定と違うときだけ、原因を追えるだけの情報を出す。
  # 出るのは件数・状態・試行回数だけで、宛先や本文は含まない
  note '  --- 診断（この出力に宛先・本文は含まれない） ---'
  note "  A_HOLDING=$A_HOLDING  B_ELAPSED_MS=$B_ELAPSED_MS"
  note "  ワーカーAの生出力: $(tr '\n' '|' <"$WORKER_OUT/a")"
  note "  ワーカーBの生出力: $(tr '\n' '|' <"$WORKER_OUT/b")"
  note "  outboxの状態: $("${PSQL[@]}" -c "select status || '=' || count(*) || ' attempts=' || coalesce(max(attempts),0) from private.email_outbox group by status" | tr '\n' ' ')"
  note "  worker行以外のoutbox: $("${PSQL[@]}" -c "select count(*)::int from private.email_outbox where dedupe_key not like 'worker-%'")"
fi
# ロック待ちなら、Aのcommit（5秒）まで返らない。
# 正常系の実測は50ms前後、ロック待ちは5000ms前後なので、1000msなら
# どちら側にも十分な余裕がある（2000msだと検出側の余裕が数%しかなかった）
if [ "$B_ELAPSED_MS" -lt 1000 ]; then B_NOT_BLOCKED=yes; else B_NOT_BLOCKED=no; fi
check "ワーカーBはAのロックを待たない（skip locked。実測 ${B_ELAPSED_MS}ms）" 'yes' "$B_NOT_BLOCKED"
WORKER_SENDING="$("${PSQL[@]}" -c "select count(*)::int from private.email_outbox where dedupe_key like 'worker-%' and status = 'sending'")"
check '6件すべてがsendingへ進む' '6' "$WORKER_SENDING"
# 二重に掴まれた行があれば attempts が2になる
WORKER_MAX_ATTEMPTS="$("${PSQL[@]}" -c "select coalesce(max(attempts), 0)::int from private.email_outbox where dedupe_key like 'worker-%'")"
check '同じ行を二重に掴んでいない（attemptsが1を超えない＝二重送信しない）' '1' "$WORKER_MAX_ATTEMPTS"
rm -rf "$WORKER_OUT"

if [ "$FAILURES" -gt 0 ]; then
  note "並行テスト: FAIL（$FAILURES 件）"
  exit 1
fi
note '並行テスト: PASS（15件）'
