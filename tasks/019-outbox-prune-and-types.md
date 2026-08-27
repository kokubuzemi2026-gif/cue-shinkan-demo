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
7. CIの生成型差分検査が差分ゼロになる
8. `docs/runbook_operations.md` の定期作業に剪定が載っている

## Test plan

| 対象 | 方法 | ファイル |
|---|---|---|
| 権限・下限・状態ごとの取捨 | pgTAP 14件 | `app/supabase/tests/35_outbox_prune_test.sql` |
| ワーカーの並行取り出し | psql 2プロセス並行 | `app/scripts/concurrency_test.sh` |
| 生成型の差分 | CI `db-tests` の差分検査 | `.github/workflows/ci.yml` |

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
| pgTAP | 35ファイル **636テスト PASS**（622から+14） |
| 並行テスト | **15件 PASS**（10から+5） |
| oxlint / `tsc -b` / vitest / vite build | すべてgreen（ユニット365テスト） |
| 生成型の差分 | CIの差分検査で確認（下記） |

### mutation test

| 壊した箇所 | 落ちたテスト |
|---|---|
| `claim_email_batch` の `for update skip locked` → `for update` | 並行: 1件（「BはAのロックを待たない」実測 46ms → 2042ms） |
| `prune_email_outbox` の状態での絞り込みを外す（時刻だけで消す） | 35: 3件 |
| 下限チェック（`retain_days < 7`）を外す | 35: 2件 |

### 残る課題

- 剪定は**自動実行しない**。月1の手作業（`docs/runbook_operations.md` §8）
- 保持期間90日は**運用実績が無い**。閉鎖βの期間（数か月）では一度も消えない可能性が高い
- ワーカー並行テストは**ローカル/CIのPostgreSQLでのみ**実行している。hostedでの挙動は未検証
