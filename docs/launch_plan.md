# 閉鎖β版 v1.0 リリース計画（正本）

- Status: In progress
- 作成: 2026-08-27
- 対象: 実在する神戸大学の新入生・団体担当者を安全に受け入れられる「閉鎖β版 v1.0」
- 位置づけ: **v1.0の完成条件・残タスク・依存関係・進捗・人間待ち項目の唯一の正本**。
  個別の仕様は各正本（`docs/auth_and_authorization.md` / `docs/server_data_model.md` /
  `docs/matching_and_safety.md`）に従い、本書はそれらを束ねる。
- 実行規約: `docs/agent_harness.md`（Plan → Implement → Verify → Review → Repair）

## 1. 現在地（2026-08-27時点）

| 項目 | 値 |
|---|---|
| `develop` | `18c1e3a`（PR #13 merge後。本書作成時点は `f28d834`） |
| `main` | `646278f`（Phase 1公開デモ・凍結中） |
| 完了Task | 000〜009, 012, 013(hook fix) |
| migration | 13本（0008×4・0009×4・0011×3・0010×2）。`20260824111223`〜`20260827080002` |
| unit test | 345件 / 28ファイル（Task 011前は317 / 24） |
| pgTAP | 399件 / 26ファイル（Task 011前は229 / 16） |
| 並行テスト | 8件（`npm run db:test:concurrency`） |
| hookテスト | 201件 |
| lint / build / CI | green |
| hosted staging | Supabase `cue-shinkan-staging`（`ap-northeast-1`）。0008・0009のmigration適用済み、Task 008 Phase B完了 |

Phase 2はTask 008（認証・権限）とTask 009（サーバーデータ）まで完了している。
学生の登録・パスポート・オファー受信・返答、団体のオファー作成・送信・ファネルは
サーバー側（RLS + SECURITY DEFINER RPC）で動作する。

## 2. v1.0の完成像と現状のgap

凡例: ✅ 実装済み / ⚠️ 部分的 / ❌ 未実装

### 2.1 新入生

| 完成像 | 状態 | 担当Task |
|---|---|---|
| 大学メールOTPで登録・ログイン | ✅ | 008 |
| 複数ロールの安全な切替 | ✅ | 008 |
| パスポートの登録・更新 | ✅ | 009 |
| パスポートの**削除** | ❌ | 014 |
| 個人情報を団体へ非公開のままオファー受信 | ✅ | 009 |
| オファー到着のメール通知 | ✅（実送信はhosted待ち） | 010 |
| 受信箱で確認し3段階で返答 | ✅ | 009 |
| 「行ってみたい」後だけ公式窓口を開示 | ✅ | 009 |
| 通知設定の管理 | ✅ | 010 |
| アカウント・データ削除の自己管理 | ❌ | 014 |

### 2.2 団体担当者

| 完成像 | 状態 | 担当Task |
|---|---|---|
| 個人アカウント認証・組織と権限の分離 | ✅ | 008 |
| 自分のデータを自分で削除できる | ✅ パスポート削除・アカウント削除・団体からの脱退（D046〜D048） | 014 |
| 確認済み団体だけが配信できる | ✅ 運営RPCでの確認・停止・再開と、配信行トリガでの強制（D043・D045） | 013 |
| 公式窓口・担当者・オファーの管理 | ⚠️ 窓口とオファーは可。**担当者の削除・role変更・脱退が未実装** | 014 |
| 個人を特定できない**粗い**対象規模だけを確認できる | ✅ | 011 |
| 匿名性を満たす対象へだけ配信できる | ✅ | 011 |
| 拒否を推測できない、時間固定・丸め済みファネル | ✅ | 011 |
| 他団体のデータを閲覧・更新できない | ✅ | 008/009 |

### 2.3 運営者

| 完成像 | 状態 | 担当Task |
|---|---|---|
| 団体の確認・停止・再開 | ✅ `admin_set_organization_status`（service_role専用） | 013 |
| オファーの停止・kill switch | ✅ `admin_set_offer_stopped` / `admin_set_delivery_paused` | 013 |
| 監査記録 | ⚠️ 運営操作は`private.admin_audit_log`へ記録（PII無し）。認証・配信の監査は017 | 013/017 |
| 障害・メール送信失敗・quota異常の把握 | ⚠️ `email_outbox_health()` はある。quota・障害の手順は017 | 010/017 |
| backup・復旧・rollback・incident runbook | ⚠️ `runbook_supabase_hosted.md` §8にrollbackのみ | 017 |
| service role key・SMTP認証情報をクライアントへ出さない | ✅ 維持（010で再確認） | 010/017 |

### 2.4 品質

| 完成像 | 状態 | 担当Task |
|---|---|---|
| スマホ主要導線 | ✅ | 006/008/009 |
| アクセシビリティ（キーボード・focus・label・contrast） | ⚠️ 体系的な検証が未実施 | 016 |
| loading / empty / error / retry | ⚠️ 主要画面にあるが全画面の網羅は未確認 | 016 |
| 認証・RLS・RPC・匿名性・E2Eの自動テスト | ⚠️ 匿名性・並行処理・メール・quotaが未テスト | 011/010/016 |
| staging実環境検証 | ⚠️ 008のみ完了。009以降は未実施 | Phase B |
| release PRと公開後smoke test | ❌ | 018 |
| P0/P1既知不具合ゼロ | 判定待ち | 018 |

## 3. Task一覧と依存関係

```
011 匿名性・安全・並行処理  ─┬─> 010 メール通知 ─┬─> 016 UX/a11y/E2E ─> 018 リリース
013 団体確認・運営kill switch ┘                  │
014 アカウント・データライフサイクル ────────────┤
015 プライバシー・同意・法的文書draft ───────────┤
017 運用（logging/health/runbook/secret） ───────┘
```

| Task | 内容 | 状態 | PR | 依存 |
|---|---|---|---|---|
| 011 | 匿名性（k=5・区分preview・10–5ファネル）・並行quota・入力検証 | **完了（developへmerge済み `ee08d12`）** | [#12](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/12) | — |
| 010 | メール通知（outbox・digest・設定・unsubscribe） | **完了（developへmerge済み `18c1e3a`）。実メール送信のみhosted待ち** | [#13](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/13) | 011 |
| 013 | 団体確認（pending/verified/suspended）・停止・kill switch・監査 | **完了（developへmerge済み `e8b333c`）** | [#14](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/14) | — |
| 014 | アカウント・データライフサイクル（削除・脱退・孤児データ） | **完了（developへmerge済み `7da6919`）** | [#15](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/15) | 013 |
| 015 | プライバシー・同意・利用規約draft・同意バージョン | **完了（developへmerge済み `1c3bb28`）** | [#16](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/16) | — |
| 016 | UX・アクセシビリティ・完全E2E | **実装完了・CIと独立レビュー確認中** | [#17](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/17) | 010〜015 |
| 017 | 運用（structured logging・health・runbook・secret rotation） | 未着手（仕様は `tasks/017-*.md`） | — | 010 |
| 018 | リリース（release notes・smoke test・staging記録・main PR） | 未着手（仕様は `tasks/018-*.md`） | — | 全部 |

番号の重複回避: 既存Task番号は000〜009・012。013以降を新規に使う（010・011は既存の意味を保持）。
decision番号は既存D001〜D035。新規はD036以降。

## 4. Task 011の確定仕様（ユーザー確定事項・2026-08-27）

再質問せずこのまま実装する確定事項。

### 4.1 配信対象の最小人数

- 配信に必要な最小対象人数は **5人**
- 0人 → 対象なし（`no_recipients`）
- 1〜4人 → 匿名性不足として**配信を拒否**（`insufficient_audience`）
- クライアントだけでなく **DB/RPC側で強制**する
- 配信直前にサーバー側で**再計算**し、preview後に人数が変わっても基準を破れない

### 4.2 対象人数preview（区分のみ）

正確な人数を返さず、次の区分だけを返す。

`0` / `1-4` / `5-9` / `10-24` / `25-49` / `50+`

- 生の人数をAPI応答・ログ・エラーメッセージ・クライアント状態へ含めない
- 同一条件の結果は **24時間固定**
- 団体単位で**異なるpreview条件をrolling 24時間あたり20回まで**
- 条件は正規化して**fingerprint化**し、rawの学生希望条件を監査ログへ残さない
- 条件を少しずつ変えて特定学生の予算上限・曜日等を推測する**差分攻撃をテストで再現**して防止を確認

### 4.3 団体向けファネル（英国ONS 10–5ルール参考）

- 配信人数 **10人未満**ではファネルを非表示にし「集計に必要な人数未満」と返す
- 10人以上でも、各セルが **10未満**なら数値を返さず `suppressed`
- 開示可能な数値は **5人単位へ丸める**
- パーセントから抑制値を逆算できるため**パーセントも返さない**
- リアルタイム更新せず、**1日1回の安定したsnapshot**を返す
- 同じ日・同じofferには常に同じsnapshotを返す
- UI上で抑制を**0人と誤解させない**
- 個人の拒否情報を返すRPC・迂回経路が存在しないことを確認する

英国ONSの10–5ルールを参考にした仕様であることをdecisionへ記録する。**法令準拠は断定しない。**

### 4.4 週間受信上限（並行処理）

- quotaを**専用テーブル**で管理する
- DBトランザクション内で**原子的に確保**する
- **並行RPCを実際に走らせるテスト**を追加する
- 失敗時に部分配信やquotaだけの消費が残らない
- 再試行で二重配信されない
- week境界とtimezoneを明示する

### 4.5 入力検証・DoS

配列長 / 文字列長 / 重複 / NULL / 空配列 / 未知のenum / 過剰な条件数 / 巨大payload を、
**高コストなSQL処理より前に**拒否する。境界値と敵対的入力のテストを追加する。

## 5. 検証環境の制約（重要）

本セッションの実行環境には **Dockerデーモンが無く `supabase start` を起動できない**。
そのため次の分担で検証する。

| 検証 | ローカル | CI |
|---|---|---|
| lint / unit test / build | ✅ 実行する | ✅ |
| pgTAP | ✅ PostgreSQL 16 + Supabase相当スキャフォールド（`auth.users` / `auth.uid()` / anon・authenticated・service_role / pgcrypto / pgtap）へ全migrationを適用して実行 | ✅ 本物のSupabaseスタック |
| 並行テスト（psql複数プロセス） | ✅ `npm run db:test:concurrency` | ✅ `db-tests` ジョブ |
| E2E（Playwright） | ❌ 実行不可（Supabase API/Authが必要） | ✅ `e2e` ジョブ |
| hosted staging | 人間操作が必要な項目のみ§7へ | — |

ローカルのスキャフォールドは**CIの代替ではなく前倒し検証**であり、最終判定はCIで行う。

### スキャフォールドとSupabaseの差（Task 011で判明）

ローカルのスキャフォールドはsuperuser（`postgres`）で動くが、**Supabaseのローカルスタックでは
`postgres` はsuperuserではない**。superuser限定の機能（`dblink_connect_u` など）は
ローカルで通ってもCIで落ちる。DB側のテストを書くときは、superuser前提の機能に依存しないこと。

## 6. 完了条件（Definition of Done for v1.0）

- [ ] Task 010・011・013〜018がすべて`develop`へmerge済み
- [ ] P0/P1の既知不具合ゼロ
- [ ] 未解決の認証・RLS・privacy blockerゼロ
- [ ] 全CI green（quality / db-tests / e2e）
- [ ] staging E2E green
- [ ] migration・rollback確認済み
- [ ] secret漏洩なし（リポジトリ・CI・PR・ログ）
- [ ] 合成データ以外がcommitされていない
- [ ] privacy / termsのdraftがあり、要確認箇所が明示されている
- [ ] 公開後smoke testとrollback手順がある
- [ ] release notesと既知制限がある
- [ ] `develop` → `main` のrelease PRに独立レビューとセキュリティレビューを実施
- [ ] main反映後のdeploy監視とsmoke test完了
- [ ] `v1.0.0` のrelease / tag作成

## 7. 人間が行う必要のある操作（Blocker候補）

ここに記録し、**該当項目の待ちで他の作業を止めない**。
最終的なチェックリストは§9へまとめる。

| # | 操作 | 理由 | 状態 |
|---|---|---|---|
| H1 | Supabase stagingへの新規migration適用 | Supabaseアクセストークン（個人所有）が必要 | 未実施 |
| H2 | 大学メールでのOTP実機確認 | 本人所有メールの受信が必要 | 未実施 |
| H3 | SMTP認証情報のDashboard設定 | secretをチャット・リポジトリへ置かない運用 | Task 008時に設定済み・010で再確認 |
| H4 | privacy policy / 利用規約の最終承認 | 法的文書の最終判断 | 未実施 |
| H5 | `main`へのrelease PR merge判断 | 公開範囲の変更 | 未実施 |

## 8. 進捗ログ

| 日付 | 内容 |
|---|---|
| 2026-08-27 | 現状調査・gap analysis・本書作成。Task 011着手 |
| 2026-08-27 | Task 011実装完了。PR #12作成、CI（quality / db-tests / e2e）green。
  pgTAP 229→316件、unit 317→328件、並行テスト8件を追加。独立レビュー実施中 |
| 2026-08-27 | Task 010・013〜018のタスク仕様を `tasks/` へ作成 |
| 2026-08-27 | Task 010完了。独立レビュー2本でBlocker 5件（通知停止が効かない／滞留／
  まとめの日境界2件／SMTP平文）を検出・修正し、PR #13をdevelopへsquash merge（`18c1e3a`）。
  merge後のdevelopで再検証し全green（pgTAP 399 / unit 345 / 並行8 / hook 201）。Task 013着手 |
| 2026-08-27 | 独立レビュー2本でBlocker（送信経路の差分攻撃oracle）を検出・修正。
  PR #12をdevelopへsquash merge（`ee08d12`）。merge後のdevelopで再検証し全green
  （pgTAP 337 / unit 329 / 並行8 / hook 201 / CI 3ジョブ）。Task 010着手 |

| 2026-08-27 | Task 013完了（PR #14 `e8b333c`）→ Task 014完了（PR #15 `7da6919`）。
  Task 015実装。独立レビュー2本が同じギャップ（未同意の担当者が招待経由で団体を操作できる）を
  指摘、自分で再現して同意ゲートを2→8 RPCへ拡張。pgTAP 591件 |

| 2026-08-27 | Task 015をdevelopへsquash merge（`1c3bb28`）。merge後のdevelopで再検証し全green
  （pgTAP 591 / 並行10 / unit 362 / hook 201）。Task 016着手 |

## 9. 次回再開時の開始点

本書§3の表で「未着手」の最小番号のTaskから再開する。
再開時は必ず次を再確認する。

1. `git fetch origin && git log --oneline -5 origin/develop`
2. open PRとCIの状態
3. 本書§3の状態表と§7の人間待ち項目
