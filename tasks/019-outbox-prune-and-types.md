# Task 019: outboxの剪定・ワーカー並行検証・生成型の同期

## Goal（目的）

Task 010 が Task 017 へ引き継ぎ、017 が**実装しないまま既知リスクE5として残した**
「`email_outbox` の古い行を消す経路が無い」を閉じる。あわせて、017 で追加した
health check が観測している送信ワーカーの並行取り出しを**実際に並行させて**検証し、
CIが警告を出し続けている生成型の差分を解消する。

## Source of truth（正本）

- `docs/decisions.md` D041（メールに載せないもの）・D052（剪定の権限方針）・**D053（本タスク）**
- `docs/launch_plan.md` §7.1 既知リスク E5
- `docs/notifications.md`
- `tasks/010-email-notifications.md` §残る課題
- `tasks/017-operations-and-observability.md` §残る課題

## In scope

- `app/supabase/migrations/20260827230000_0018_outbox_prune.sql`（新規）
- `app/supabase/tests/35_outbox_prune_test.sql`（新規）
- `app/scripts/concurrency_test.sh`（第4フェーズ: ワーカー並行）
- `app/src/lib/database.types.ts`（`supabase gen types` の出力へ同期）
- `docs/decisions.md`（D053）
- `docs/runbook_operations.md` §8（定期作業）
- `docs/launch_plan.md` §7.1（E5を対応済みへ）
- `docs/notifications.md` §7・§8（独立レビューN3・D053で解消した項目の反映）
- `docs/legal/privacy_draft.md` §5（security-reviewer N2・保持期間の「未定」を90日へ）
- `app/supabase/tests/34_ops_health_test.sql`（独立レビューN1・`prune_audit_logs` の同じ穴）

## Out of scope

- 剪定の自動実行（cron / pg_cron）。年月次の手作業のままにする
- `email_outbox` のスキーマ変更
- 送信ワーカー本体（`send-notifications`）の変更
- 監査ログ・previewの剪定（D052で実装済み）

## Acceptance criteria

1. `private.prune_email_outbox(retain_days)` が `sent` / `failed` / `cancelled` かつ
   `updated_at` が保持期間より古い行だけを消し、削除件数を返す
2. **`pending` と `sending` は、どれだけ古くても消えない**
3. 保持期間の下限（7日）を関数内で強制し、`null` も拒否する
4. anon・authenticated・service_role・PUBLIC のいずれからも実行できない
5. `public` スキーマへ露出しない（PostgRESTから叩けない）
6. 送信ワーカーの並行取り出しが、2プロセスを実際に並行させて検証されている
   （二重に掴まない／相手のロックを待たない）
7. CIの生成型差分検査が差分を出さない（**このステップはジョブを落とさない**。
   差分は `::warning::` として出るだけなので、ログを見て確認する）
8. `docs/runbook_operations.md` の定期作業に剪定が載っている
9. `retain_days` が実際に使われている（引数を無視する実装ではテストが落ちる）
10. `public`・`private` のSECURITY DEFINER関数がすべて `search_path` を固定している

## Test plan

| 対象 | 方法 | ファイル |
|---|---|---|
| 権限・下限・状態ごとの取捨 | pgTAP 14件 | `app/supabase/tests/35_outbox_prune_test.sql` |
| ワーカーの並行取り出し | psql 2プロセス並行 | `app/scripts/concurrency_test.sh` |
| 生成型の差分 | CI `db-tests` の差分検査（**警告のみ。落ちない**） | `.github/workflows/ci.yml` |

## Rollback

- 逆migrationで `drop function private.prune_email_outbox(integer)`。
  この関数は他から呼ばれていないため、依存の作り直しは不要
- 剪定を実行してしまった行は戻らない。実行前に backup（`docs/runbook_operations.md` §5）

## Verification record

### 番号の衝突（着手時に確認したもの）

| 種類 | 使用済み | 本タスク |
|---|---|---|
| task | 012〜018 | **019** |
| migration | 0008〜0015・0017 | **0018**（0016はTask 016がmigrationを持たないため欠番のまま） |
| decision | D001〜D052 | **D053** |
| pgTAPファイル | 01〜34 | **35** |

### 作ったもの

| 対象 | 内容 |
|---|---|
| `private.prune_email_outbox(retain_days integer default 90)` | `sent`/`failed`/`cancelled` かつ古い行だけを削除し件数を返す。`security definer` / `search_path = ''` |
| pgTAP 14件 | 権限（PUBLIC含む）・`public`非露出・下限7日の境界・状態ごとの取捨・**pending/sendingが400日前でも残る**・積む経路が1本のまま・宛先/本文の列が無い |
| 並行テスト 5件追加（10→15件） | ワーカーA/Bが3件ずつ掴む・**BはAのロックを待たない**・6件すべてsendingへ進む・attemptsが1を超えない |
| 生成型 6ハンク | `student_consents` の整形、`email_outbox_health` の `Args: never`、`mark_offer_read` の順序、**`platform_health` の追加**、`Constants` へ `email_kind`/`email_status`/`notification_mode` |

### 設計の要点

- **消す条件の中心は「状態」**。時刻だけで消すと、滞留した `pending` を消して
  通知が二度と届かなくなる。`sending` も `claim_email_batch` が拾い直す対象なので残す
- **二重送信にならない根拠**を pgTAP で固定した。outboxへ積む経路は
  `private.offer_recipients` のAFTER INSERTトリガ1本だけで、受信者行は配信時に
  1度しか入らない。剪定で行が消えても、同じ配信が再び積まれることはない
- 剪定を **service_role からも呼べなくする**のはD052と同じ理由（誤操作で消させない）
- ワーカーの並行検証を**シェルへ置いた**。pgTAPは1ファイル=1セッションで
  本物の競合を作れず、`skip locked` の有無を判別できない

### 実行した検証

| 検証 | 結果 |
|---|---|
| pgTAP | 35ファイル **641テスト PASS**（622から+19。うち34へ+3・35へ+16） |
| 並行テスト | **15件 PASS**（10から+5） |
| oxlint / `tsc -b` / vitest / vite build | すべてgreen（ユニット365テスト） |
| 生成型の差分 | CIの差分検査で確認（下記） |

### mutation test

| 壊した箇所 | 落ちたテスト |
|---|---|
| `claim_email_batch` の `for update skip locked` → `for update` | 並行: 1件（「BはAのロックを待たない」実測 46ms → 2042ms） |
| `prune_email_outbox` の状態での絞り込みを外す（時刻だけで消す） | 35: 3件 |
| 下限チェック（`retain_days < 7`）だけを外す | 35: **1件**（`null` チェックも含めたガード節ごと外すと2件） |
| `make_interval(days => retain_days)` を `days => 90` へ固定（引数を無視） | 35: 1件 |
| `prune_audit_logs` の同じ変異（`days => 365` へ固定） | 34: 1件 |
| `prune_email_outbox` から `set search_path = ''` を外す | 35: 1件 |

### 独立レビュー2本の結論と対応

**どちらもBlocker 0件（承認可）。** Non-blockerのうち、次を同じPRで直した。

| 指摘 | 内容 | 対応 |
|---|---|---|
| N1（独立） | **`retain_days` が効いているかを1件も検査していない**。`make_interval(days => retain_days)` を `days => 90` に固定した変異体が641件すべて通る。`lives_ok(prune(7))` が行を入れる前に走っており、以降は既定値しか使っていなかった | 35へ「`retain_days=7` なら10日前の行も消える」を追加。**同じ穴が `prune_audit_logs`（D052）にもあった**ので、34にも下限30日で判別できる3件を追加。どちらも変異体が落ちることを確認 |
| N1（security） | **並行テストの `sleep 1` 同期が空振りしうる**。Aのpsql起動が1秒を超えると、`skip locked` を外した変異体でも全件okになる（レビュー側が再現） | `pg_stat_activity` で**Aが `pg_sleep` を実行中**（＝掴み終えて握ったまま）を観測してからBを起動する。**「掴んだ行が見えるまで待つ」は誤り**で、未commitのため見えるのはcommit後＝ロック解放後になる（実際にそれで変異体が通ることを確認した）。Aの保持を5秒、しきい値を1000msへ。実測は正常系39〜44ms・8並列負荷下105ms・変異体4872msで、両側20倍以上の余裕 |
| N3（security） | 第4フェーズが `claim_email_batch` を直接呼ぶため、実データのDBへ誤って向けると実在のpendingが `sending` へ落ちる | `demo-` 以外の利用者が居たら中止する安全弁を追加 |
| N5（独立） | 第4フェーズが第1フェーズの残留outbox行との時刻順序に暗黙依存 | seed直前に `delete from private.email_outbox` |
| N4（security）/ N8（独立） | **`security definer` + `search_path=''` を固定するテストがリポジトリ全体に無い**。0018から外しても641件全通過 | カタログ走査で `public`・`private` のSECURITY DEFINER関数全件を固定（変異体が落ちることを確認） |
| N2（独立） | `runbook_operations.md` §8 の地の文が `prune_email_outbox` を含まず、service_roleから呼べると誤読しうる | 3関数を列挙 |
| N3（独立）/ T1（security） | `docs/notifications.md` §8 が「古いoutbox行の削除（Task 017）」を未実施のまま残す | 017・019で対応済みへ。§7へ35を追加 |
| N2（security） | `docs/legal/privacy_draft.md` が送信記録の保持期間を「未定」のまま | 90日へ。D052で監査を365日に決めたときと同じ扱い |
| N4（独立） | 記録の mutation test 表が「下限チェックを外す → 2件」としていたが実測は1件 | 実測へ訂正（ガード節ごとなら2件） |
| T2（security） | 受入条件7「CIの差分検査が差分ゼロ」は、CIが警告を出すだけで落ちない実態より強い | 「警告のみ。落ちない」と明記 |
| T3（security） | `head -c 1` で先頭1文字しか見ておらず batch size 10以上で誤判定 | 最初の数値行を取る |

**持ち越し**: N7（保持期間ちょうどの境界テスト）・N9（`2147483647` は `invalid_retain_days` でなく `timestamp out of range`。abortするだけでデータは失われない）・N11（積む経路の検査をトリガ数から `prosrc` 走査へ）・T4（`cleanup` の失敗時の後片付け）。いずれも実害が確認されておらず、次の機会に回す。

### CIで1度だけ出た「Aが6件・Bが0件」について

**flakeとして片付けず、原因の仮説まで詰めた。**

観測（`5252471` の db-tests）:

| 観測 | 値 |
|---|---|
| ワーカーAが報告した件数 | **6** |
| ワーカーBが報告した件数 | **0** |
| worker行のうち `sending` になった数 | 6（=すべて） |
| `attempts` の最大 | **1** |
| Bの経過 | 30ms（待っていない） |

`claim_email_batch` は `where o.id in (... for update skip locked limit batch_size)`
なので、**1回の呼び出しで `batch_size`（=3）を超えて掴むことはできない**。
つまり「Aが6件掴んだ」はコードから説明がつかない。

仮説: `select count(*) from public.claim_email_batch(3)` と素で書いていたため、
**プランによっては関数ノードが再スキャンされ、volatileな同関数が2回実行された**。
2回 × 3件 = 6件を掴み、`count(*)` は6を返す。掴み尽くされたのでBは0件になり、
どの行も1回ずつしか掴まれていないので `attempts` は1のまま。
**4つの観測すべてと整合する。**

対応: `with claimed as materialized (...)` で関数を**1度だけ**評価するようにした。
`as materialized` はCTEを実体化するため、再スキャンが起きない。

- ローカル（PostgreSQL 16）では**再現しない**。同じ入力で A=3 / B=3 が安定
  （無負荷5回・8並列負荷下3回とも）。CIでも次のrunでは A=3 / B=3 に戻った
- したがって**この仮説は直接には実証できていない**。ただし
  「掴む副作用を持つvolatile関数を `count(*)` の直下に置かない」のは
  仮説が外れていても正しく、再スキャンが起きても件数が変わらなくなる
- 再発したときに追えるよう、失敗時だけ生出力とoutboxの状態を出す診断を残した
  （**宛先・本文は含まない**）

### 残る課題

- 剪定は**自動実行しない**。月1の手作業（`docs/runbook_operations.md` §8）
- 保持期間90日は**運用実績が無い**。閉鎖βの期間（数か月）では一度も消えない可能性が高い
- ワーカー並行テストは**ローカル/CIのPostgreSQLでのみ**実行している。hostedでの挙動は未検証
