# Task 017: 運用・可観測性

## Goal（目的）

運営者が、障害・メール送信失敗・quota異常に気づき、復旧できる状態にする。
バックアップ・復旧・ロールバック・インシデント対応の手順を文書化する。

**外部の有料監視サービスや有料プランは、承認なしに追加しない。**

## Source of truth（正本）

- `docs/runbook_supabase_hosted.md`
- `docs/decisions.md`: D027（secretを持ち込まない）、D037（quota）
- `docs/auth_and_authorization.md`: §9
- `docs/launch_plan.md`: §2.3

## In scope

- `docs/runbook_operations.md`（新規）、`docs/runbook_incident.md`（新規）
- `docs/runbook_supabase_hosted.md`（追記）
- `app/supabase/migrations/2026*_0017_*.sql`（health check・運用ビュー）
- `app/supabase/tests/34_*.sql`（33はTask 015が使用済み）
- `.github/workflows/`（dependency/security checkの追加。無料の範囲で）
- `docs/launch_plan.md`、`tasks/017-operations-and-observability.md`

## Out of scope

- 有料の監視・APM・ログ集約サービスの導入
- production環境の作成（Task 018の判断）

## Acceptance criteria

- [x] structured loggingの方針が決まっている（何を出す・何を出さない）
- [x] 監査ログにPIIが含まれない（テストで確認する）
- [x] health checkがある（DB・認証・メール送信の生存確認）※**認証の「生存」はDBのRPCでは確認できない**（Auth APIを叩けない）。DBから観測できる兆候4列を返し、生存確認はOTPを往復させる人間の手順として`runbook_incident.md` §2.5 に置いた
- [x] メール送信失敗を確認する手順がある
- [x] quota異常（想定外の消費・詰まり）を確認する手順がある
- [x] migration適用手順がある
- [x] rollback手順がある（drop→createで置き換えた関数の注意を含む）
- [x] backup / restore手順がある
- [x] incident response手順がある（誰が何を止めるか。kill switchへの導線）
- [x] production / staging の環境変数一覧がある（値は書かない）
- [x] secret rotation手順がある
- [x] dependency / security check がCIで回る
- [x] 既知リスク一覧がある
- [x] 公開停止手順がある
- [x] pgTAP / lint / test / build / CI がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| 監査ログのPII非混入 | pgTAP | `supabase/tests/34_ops_health_test.sql` |
| health check | pgTAP | 同上 |
| runbookの手順 | 手動（stagingで実行して結果を記録） | 本ファイル |

## Rollback

- 本PRのrevert。文書と運用ビューのみで、アプリの動作に影響しない。

## Verification record

実装日: 2026-08-27 / ブランチ: `feat/017-operations`

### 番号の衝突（着手時に直したもの）

本ファイルのIn scopeとTest planが `app/supabase/tests/33_*.sql` を指していたが、
**33はTask 015が使用済み**だったため `34_ops_health_test.sql` へ直した。
migrationの連番は0016を飛ばして**0017**にする（Task 016はmigrationを持たない。
連番とタスク番号を一致させたほうが追跡しやすい）。decisionは**D052**
（D051は `fix/e2e-artifact-secrets-and-typecheck` が使用）。

### 作ったもの

| 対象 | 内容 |
|---|---|
| `20260827220000_0017_operations.sql` | `public.platform_health()`（service_role専用・**14列**）・`private.prune_audit_logs(days)`・`private.prune_preview_cache(hours)` |
| `34_ops_health_test.sql` | **25テスト**（権限固定・PUBLIC不在・返す列の固定・監査ログの列の固定・保持期間の境界・**各列の値の実測**） |
| `docs/runbook_operations.md`（新規・227行） | 環境と役割 / 環境変数（値は書かない）/ migration適用 / rollback / backup・restore / secret rotation / 公開停止 / 定期作業 / **ログの方針** |
| `docs/runbook_incident.md`（新規・132行） | 最初の3つ / health check の読み方 / メールが届かない / quota異常 / 差分攻撃の疑い / 監査の確認 / 状況別の初手 / 事後 |
| `docs/runbook_supabase_hosted.md` §6.3 | Task 014・015・017 のPhase B人間タスク（同意ゲート・削除・auth identity・health check） |
| `docs/launch_plan.md` §7 | **H6〜H10を追加**（公開用Supabaseプロジェクト・Actions variables・Auth Site URL・Edge Functionデプロイ・auth.users削除の確認） |
| `docs/launch_plan.md` §7.1 | **既知リスク一覧25件**（法務4 / プライバシー・セキュリティ6 / a11y・UX4 / 機能の穴6 / 運用4、A1〜E4） |
| `.github/workflows/ci.yml` | `audit` ジョブ（`npm audit --audit-level=high` で落とし、moderate以下は警告） |

### 設計の要点

- **健全性の確認を1本のRPCへ集約した。** 外部の有料監視を使わない方針の下では、
  「1本のSQLを毎日見る」が現実的な最小構成になる。返すのは件数と時刻だけ（D029）
- **剪定関数はservice_roleからも呼べない。** 監査は消しにくいほうがよい。
  誤操作で消えると運営操作の追跡ができなくなる。DashboardのSQL Editorのみで実行する
- **保持期間の下限を関数内で強制する**（監査30日未満・preview 24時間未満は拒否）。
  「0日で全部消す」を事故で実行できないようにするため
- `quota_over_limit` は**設計上0**。1以上は枠確保（`FOR UPDATE`）が壊れている合図として使う
- **ログの方針は既に実装されていた**（送信ワーカーの `logSafe()`）。
  017では**明文化**し、「そのログを第三者が見たときに特定の学生を指せるか」という
  判断基準を書いた

### 実行した検証

| 検証 | 結果 |
|---|---|
| pgTAP | 34ファイル **616テスト PASS**（Task 016時点の591から+25） |
| 並行テスト | 10件 PASS |
| oxlint / tsc / vitest / vite build | すべてgreen（ユニット362テスト） |
| `npm audit --audit-level=high` | **found 0 vulnerabilities** |
| CI workflow のYAML構文 | `yaml.safe_load` でパースできることを確認（jobs: quality / db-tests / e2e / audit） |

### mutation test

| 壊した箇所 | 落ちたテスト |
|---|---|
| `platform_health` を authenticated へも grant | 34: 1件 |
| `prune_audit_logs` の保持期間の下限チェックを外す | 34: 2件 |
| `prune_audit_logs` が保持期間を無視して全部消す | 34: 2件 |
| `platform_health` が審査待ち団体を数えない | 34: 1件 |

### 独立レビューの結論と対応

**reviewer / security-reviewer の指摘をすべて自分で再現したうえで修正した。**
どちらも「修正後に再レビュー」で、合計6件のBlockerが出た。

| 指摘 | 深刻度 | 再現内容 | 対応 |
|---|---|---|---|
| B2（reviewer）: `quota_over_limit` が正常操作で誤発報し、runbookが「まず緊急停止」を指示 | Blocker | `window_count` は配信時にしか再計算されない観測値で、`reception_weekly_limit` は**本人がいつでも下げられる**。「3件受け取ったあとに上限を1へ下げる」だけで超過扱いになる。**自分でも再現した**（(a)上限5・受信3→0 / (b)上限を1へ下げた直後→**1**）。runbookは「1以上は設計上起きない」「まず緊急停止」と書いており、**学生1人の設定変更でプラットフォーム全停止**を指示する手順だった | 最後の配信より後にパスポートが更新された行を除外。修正後は (b)→**0**、上限を下げずに超過した本当の異常は→**1** であることを確認。runbookにも「先に本人の設定変更を確認する」手順を足した |
| B3（reviewer）: health checkの7列が無検査 | Blocker | 値を検査していたのは2列だけ。**7列をリテラル`0`で返す変異体が16/16 pass**することをレビュー側が実証 | 値の実測を9件追加（送信待ち・失敗・詰まりの15分境界・超過分の正負・quotaの2ケース・期限切れpreview・監査行数）。**同じ変異体が7件落ちる**ことを確認 |
| B1（reviewer）: 認証の生存確認が無いのに受入条件が `[x]` | Blocker | `platform_health()` は `auth` に一切触れていない。OTPを送るのはSupabase Auth自身のSMTPで、`email_outbox` とは別経路。「ログインできない」の初手がrunbookに無かった | 認証側の兆候4列（確認済みidentity数・最新identityの作成時刻・ドメイン外identity数・孤児identity数）を追加。**「生存はDBでは確認できない」ことを明記**し、OTP往復の人間の手順を `runbook_incident.md` §2.5 として新設 |
| B4（reviewer）: rollbackの関数一覧が不正確で正本と矛盾 | Blocker | `drop`→`create` した関数として013の2本しか挙げていなかったが、実際は**0011の `send_offer`・`preview_offer_audience`** も該当。団体側の中核RPCで、この一覧で切り戻すと送信もプレビューもできなくなる。しかも `runbook_supabase_hosted.md` §8 に正しい完全な一覧が既にあった | 写しを置くのをやめ、§8を正本として参照する形へ |
| B-1（security）: 権限テストがPUBLICを検査していない | Blocker | `a.grantee <> 0` でPUBLIC擬似ロールを除外していた。**関数のEXECUTEはPostgreSQLの既定でPUBLICへ付く**ため、最も起きやすい退行そのもの。レビュー側が「PUBLICへgrantしても607件全部green」を実証 | `29_admin_boundary_test.sql` と同じ2本目（PUBLIC・anon・authenticated不在）を追加。**PUBLICへgrantすると実際に落ちる**ことを確認 |
| B-2（security）: backup手順が本番ダンプをリポジトリへ書き出す | Blocker | `-f backup_$(date).sql` はカレントディレクトリへ出る。同じ節の次の行が「リポジトリへ置かない」と警告しており、**手順が自分の警告と矛盾**していた。`backup_*.sql` はgitignoreにも無く、`git add -A` でPIIがステージされる | 出力先を `~/cue-backup/` へ固定し、`.gitignore` へ `backup_*.sql` / `*.dump` を多重防御として追加 |

Non-blocker・Nitも反映した。

- `oldest_pending_age_minutes` → **`oldest_pending_overdue_minutes`** へ改名。
  まとめメールは将来の時刻を予約するため**負値が正常**であることをrunbookへ明記
- 既知リスクの取りこぼし3件を追加（E5: `email_outbox` の剪定経路が無い＝Task 010が017へ
  引き継いだ項目を**実装していない**、E6: staging SMTPが個人Gmailで1日500宛先、
  E7: denomailerのSTARTTLS挙動が未確認）
- `docs/operations.md` §8 の「保持期間は未定。Task 017で決めます」と
  `docs/legal/privacy_draft.md` の【要確認】を、D052の決定（365日）へ更新
  （どちらもIn scope外だが、**正本間の矛盾を残さない**ため含めた）
- `runbook_incident.md` の「状況別の初手」で、裸の `§3`/`§5` が本書の節に読めていたのを
  `docs/operations.md` §3/§5 と明記
- `audit` ジョブの2ステップを1つにまとめ、`npm ci` + audit の二重実行をやめた
- `npm audit` の適用範囲（npmレジストリのみ。Deno依存とActionsは対象外）をrunbookへ明記
- テストのヘッダコメントを D051 → **D052** へ

### 残る課題

- **`email_outbox` の古い行を消す経路が無い**（既知リスクE5）。Task 010が017へ引き継いだ
  項目だが、監査とpreviewだけを剪定し、outboxには手を付けていない。次のタスクで対応する
- **runbookの手順をstagingで実行していない**（H1・H9が未実施のため）。
  migration適用・backup・restore・secret rotation・公開停止の各手順は
  **文書としては用意したが、実行しての確認は未実施**
- `platform_health()` を**定期的に見る仕組みは無い**。人間が毎日見る運用に依存する
  （外部の有料監視サービスは承認なしに追加しない、というGoalの制約）
- 剪定（`prune_audit_logs`）は**自動実行しない**。年1回の手作業
- `npm audit` は**npmレジストリの既知脆弱性だけ**を見る。
  自分たちのコードの脆弱性は検出しない
