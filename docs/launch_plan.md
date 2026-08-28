# 閉鎖β版 v1.0 リリース計画（正本）

- Status: In progress
- 作成: 2026-08-27
- 対象: 実在する神戸大学の新入生・団体担当者を安全に受け入れられる「閉鎖β版 v1.0」
- 位置づけ: **v1.0の完成条件・残タスク・依存関係・進捗・人間待ち項目の唯一の正本**。
  個別の仕様は各正本（`docs/auth_and_authorization.md` / `docs/server_data_model.md` /
  `docs/matching_and_safety.md`）に従い、本書はそれらを束ねる。
- 実行規約: `docs/agent_harness.md`（Plan → Implement → Verify → Review → Repair）

## 1. 現在地（2026-08-28時点）

| 項目 | 値 |
|---|---|
| `develop` | `6bf1829`（PR #27 merge後） |
| `main` | `646278f`（Phase 1公開デモ・**公開中**・凍結） |
| 完了Task | **000〜021**（020は `607891f`・021は `6bf1829`）。**022はhosted再検証待ち**（D058） |
| migration | **20本**（0008×4・0009×4・0011×3・0010×2・0013×2・0014・0015・0017・0018・0019） |
| unit test | **376件 / 32ファイル**（022で+3） |
| pgTAP | **653件 / 36ファイル** |
| 並行テスト | **15件**（`npm run db:test:concurrency`） |
| hookテスト | 201件 |
| lint / build / CI | green（quality / db-tests / e2e / audit の4ジョブ） |
| hosted staging | Supabase `cue-shinkan-staging`（`ap-northeast-1`）。**全20本適用済み**（2026-08-28・H1完了）。H6の決定（2026-08-28）で**このプロジェクトを公開用へ昇格**する。※本書の旧記載「0008・0009まで適用済み」は誤りで、実態は0008の4本のみだった（`tasks/009-server-data-migration.md` Phase B「未実施」が正） |

Phase 2の**実装はTask 021まで完了**している。学生の登録・パスポート・オファー受信・返答、
団体のオファー作成・送信・ファネル、メール通知、運営の確認・停止・緊急停止、
本人によるデータ削除、同意管理、health checkまでがサーバー側
（RLS + SECURITY DEFINER RPC）で動作する。

**残るのは人間の操作だけ**（§7 H2・H4・H5・H10、**H9の再デプロイ**、smoke test。H1・H3・H6〜H8・H11は2026-08-28完了）。実装側からは進められない。

> **2026-08-28（smoke test B）: メール通知は現時点で1通も送れていない。** 送信ワーカーは動いているが、
> SMTPライブラリ（denomailer）がEdge Runtimeで動かず、outboxが `attempts=5` / `failed` になった。
> Task 022（D058）で `npm:nodemailer` へ置き換え済み。**新コードの再デプロイ（人間の操作）と
> 実送達の再確認が済むまで、メール通知は動作しないものとして扱う。**

## 2. v1.0の完成像と現状のgap

凡例: ✅ 実装済み / ⚠️ 部分的 / ❌ 未実装
**最終更新: 2026-08-28（Task 021完了・H11完了時点）**

### 2.1 新入生

| 完成像 | 状態 | 担当Task |
|---|---|---|
| 大学メールOTPで登録・ログイン | ✅ | 008 |
| 複数ロールの安全な切替 | ✅ | 008 |
| パスポートの登録・更新 | ✅ | 009 |
| パスポートの**削除** | ✅ `delete_student_passport`（D046） | 014 |
| 個人情報を団体へ非公開のままオファー受信 | ✅ | 009 |
| オファー到着のメール通知 | ⚠️ ワーカーは稼働中だが**実送達は失敗を確認済み**（smoke test B・2026-08-28）。Task 022で修正済み・**再デプロイ待ち** | 010/022 |
| 受信箱で確認し3段階で返答 | ✅ | 009 |
| 「行ってみたい」後だけ公式窓口を開示 | ✅ | 009 |
| 通知設定の管理 | ✅ オファーごと / 1日1回 / 通知しない | 010 |
| アカウント・データ削除の自己管理 | ✅ `delete_my_account`（D047・D049）。**auth identityは運営が別途削除**（H10） | 014 |
| 登録前に規約・ポリシーへ同意する | ✅ 8つのRPCをDBで同意ゲート（D050） | 015 |

### 2.2 団体担当者

| 完成像 | 状態 | 担当Task |
|---|---|---|
| 個人アカウント認証・組織と権限の分離 | ✅ | 008 |
| 自分のデータを自分で削除できる | ✅ パスポート削除・アカウント削除・団体からの脱退（D046〜D048） | 014 |
| 確認済み団体だけが配信できる | ✅ 運営RPCでの確認・停止・再開と、配信行トリガでの強制（D043・D045） | 013 |
| 公式窓口・担当者・オファーの管理 | ⚠️ 窓口とオファーは可。**担当者の削除・role変更・団体の削除が未実装**（§7.1 D1・D2） | 014 |
| 個人を特定できない**粗い**対象規模だけを確認できる | ✅ 区分のみ（D036） | 011 |
| 匿名性を満たす対象へだけ配信できる | ✅ 最小5人をDBで強制（D036） | 011 |
| 拒否を推測できない、時間固定・丸め済みファネル | ✅ 10未満非開示・5単位丸め・日次snapshot（D037） | 011 |
| 他団体のデータを閲覧・更新できない | ✅ | 008/009 |

### 2.3 運営者

| 完成像 | 状態 | 担当Task |
|---|---|---|
| 団体の確認・停止・再開 | ✅ `admin_set_organization_status`（service_role専用） | 013 |
| オファーの停止・kill switch | ✅ `admin_set_offer_stopped` / `admin_set_delivery_paused` | 013 |
| 監査記録 | ✅ `private.admin_audit_log`（運営操作・PII無し）+ `private.deletion_audit_log`（削除の日次集計）。保持365日で剪定（D052） | 013/014/017 |
| 障害・メール送信失敗・quota異常の把握 | ✅ `platform_health()` 14列（service_role専用・件数と時刻だけ）+ `email_outbox_health()`（D052） | 010/017 |
| backup・復旧・rollback・incident runbook | ✅ `docs/runbook_operations.md`（環境変数・migration・rollback・backup/restore・secret rotation・公開停止5段階・定期作業・ログの方針）+ `docs/runbook_incident.md`（状況別の初手）。**migration適用は2026-08-28にstagingで実施済み（§4代替手順）。backup・restore・rollbackの実行演習は未実施** | 017 |
| 古いデータの掃除 | ✅ 監査365日 / preview 48時間 / outbox 90日。いずれも**DB管理者のみ・手作業**（D052・D053） | 017/019 |
| service role key・SMTP認証情報をクライアントへ出さない | ✅ 維持（010で再確認・018でビルド成果物を実測） | 010/017/018 |

### 2.4 品質

| 完成像 | 状態 | 担当Task |
|---|---|---|
| スマホ主要導線 | ✅ | 006/008/009 |
| アクセシビリティ（キーボード・focus・label・contrast） | ⚠️ 体系的に検証し、コントラスト2件とフォーカス移動を修正。**入力欄の枠が1.4.11未達・スクリーンリーダー実機未確認**（§7.1 C1・C2） | 016 |
| loading / empty / error / retry | ✅ 主要画面を確認 | 016 |
| 認証・RLS・RPC・匿名性・E2Eの自動テスト | ✅ pgTAP **653件**（36ファイル）/ 並行15件 / unit 373件 / E2E | 008〜020 |
| staging実環境検証 | ⚠️ **migrationは全20本適用済み（2026-08-28）**。smoke test Bは2026-08-28に実施し、**配信・匿名性・ファネルは合格／実メール送達は失敗**（Task 022で修正・再デプロイ待ち）。`tasks/009` Phase B残りは未実施 | Phase B |
| release PRと公開後smoke test | ⚠️ 手順は用意済み（production用A・staging用Bに分割）。**実行は公開後**（merge前提のH6〜H8は2026-08-28完了） | 018 |
| P0/P1既知不具合ゼロ | ⚠️ §7.1 の28件へ重大度を付与。**P0は0件・P1は7件**（公開判断で受容が要る） | 018 |

## 3. Task一覧と依存関係

```
011 匿名性・安全・並行処理  ─┬─> 010 メール通知 ─┬─> 016 UX/a11y/E2E ─> 018 リリース
013 団体確認・運営kill switch ┘                  │
014 アカウント・データライフサイクル ────────────┤
015 プライバシー・同意・法的文書draft ───────────┤
017 運用（logging/health/runbook/secret） ─> 019 outbox剪定・型同期 ┘
```

| Task | 内容 | 状態 | PR | 依存 |
|---|---|---|---|---|
| 011 | 匿名性（k=5・区分preview・10–5ファネル）・並行quota・入力検証 | **完了（developへmerge済み `ee08d12`）** | [#12](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/12) | — |
| 010 | メール通知（outbox・digest・設定・unsubscribe） | **完了（developへmerge済み `18c1e3a`）。実メール送信のみhosted待ち** | [#13](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/13) | 011 |
| 013 | 団体確認（pending/verified/suspended）・停止・kill switch・監査 | **完了（developへmerge済み `e8b333c`）** | [#14](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/14) | — |
| 014 | アカウント・データライフサイクル（削除・脱退・孤児データ） | **完了（developへmerge済み `7da6919`）** | [#15](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/15) | 013 |
| 015 | プライバシー・同意・利用規約draft・同意バージョン | **完了（developへmerge済み `1c3bb28`）** | [#16](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/16) | — |
| 016 | UX・アクセシビリティ・完全E2E | **完了（developへmerge済み `623f85a`）** | [#17](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/17) | 010〜015 |
| 017 | 運用（structured logging・health・runbook・secret rotation） | **完了（developへmerge済み `cebabdd`）** | [#20](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/20) | 010 |
| 019 | outboxの剪定・ワーカー並行検証・生成型の同期 | **完了（developへmerge済み `05e2701`）** | [#21](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/21) | 017 |
| 018 | リリース（release notes・smoke test・deploy設定・main PR） | **完了（developへmerge済み `2d4fc9f`）** | [#22](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/22) | 全部 |
| 020 | 入口分離（新入生／団体担当者の入口とログイン後の初期表示・D056） | **完了（developへmerge済み `607891f`）** | [#25](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/25) | 016 |
| 021 | OTP送信のCAPTCHA（Cloudflare Turnstile・D057・H11b） | **完了（developへmerge済み `6bf1829`）** | [#27](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/27) | 008 |
| 022 | 送信ワーカーのSMTPをnodemailerへ置換（D058。smoke test Bで実送信が全失敗したため） | **実装完了・hosted再検証待ち** | [#30](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/30) | 010 |

番号の重複回避: 既存Task番号は000〜009・012。013以降を新規に使う（010・011は既存の意味を保持）。
decision番号は **D058まで使用済み**（D054はTask 018＝PR #22、D055はPR #24、D056はTask 020＝PR #25、D057はTask 021、D058はTask 022）。新規はD059以降。migrationの連番は **0019まで**（0012・0016は欠番）。

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

状態は2026-08-28時点。**未達はすべて `docs/launch_plan.md` §7 の
人間待ち項目（H2・H4・H5・H10）とsmoke test・release PRの作成・判断が原因**で、実装側からは進められない。

| 条件 | 状態 | 根拠・残る作業 |
|---|---|---|
| Task 010・011・013〜018がすべて`develop`へmerge済み | **達成** | 008〜020がmerge済み（018は `2d4fc9f`・020は `607891f`） |
| P0/P1の既知不具合ゼロ | **一部** | §7.1 の28件へ重大度を付与した結果、**P0は0件、P1は7件**（A1 法令未確認 / B1 auth identity残存 / B3 その削除挙動が未検証 / B7 Attack Protection＝2026-08-28設定済み・実機確認はsmoke A / C1 WCAG 1.4.11未達 / E3 送信ワーカー＝2026-08-28設置済み・実配信確認はsmoke A/B / E6 SMTP上限）。**P1は公開判断で明示的に受容が要る**。2件（B6・E5）は対応済み |
| 未解決の認証・RLS・privacy blockerゼロ | **達成** | 各タスクの独立レビュー・security-reviewerでBlocker 0 |
| 全CI green | **達成** | quality / db-tests / e2e / audit |
| staging E2E green | **未達** | smoke test Bの実メール部分が未達（H9-2の再デプロイ後に再確認）。H1は2026-08-28完了 |
| migration・rollback確認済み | **一部** | ローカル**20 migration**の適用は毎回検証。**hostedへの適用は2026-08-28完了（全20本）**。hostedでの切り戻し演習は未実施 |
| secret漏洩なし | **達成** | `VITE_*` 以外をビルドへ入れないことを実測。E2Eアーティファクトの入力値漏れも塞いだ（D051） |
| 合成データ以外がcommitされていない | **達成** | テストデータは `demo-*@stu.kobe-u.ac.jp` の合成のみ |
| privacy / termsのdraftがあり、要確認箇所が明示されている | **達成** | `docs/legal/`・【要確認】（D050）。**法令適合は運営者の最終確認事項** |
| 公開後smoke testとrollback手順がある | **達成** | `tasks/018-release-v1.md` §公開後smoke test / `docs/runbook_operations.md` §4・§7 |
| release notesと既知制限がある | **達成** | `docs/release_notes_v1.0.md` / §7.1 |
| release PRに独立レビューとセキュリティレビューを実施 | **未達** | `develop → main` のrelease PRはまだ作っていない。Task 018のPR（base=develop）では**独立レビュー3周（Blocker 4→3→3件）・security-reviewer 2周（4→1件）**を実施し、すべて修正した |
| main反映後のdeploy監視とsmoke test完了 | **未達** | H6〜H8・H11は2026-08-28完了。**H9-2（ワーカー再デプロイ）**・release PRのmerge判断（H5）・公開後smoke testが残る |
| `v1.0.0` のrelease / tag作成 | **未達** | main反映後に作る |

## 7. 人間が行う必要のある操作（Blocker候補）

ここに記録し、**該当項目の待ちで他の作業を止めない**。
最終的なチェックリストは§9へまとめる。

| # | 操作 | 理由 | 状態 |
|---|---|---|---|
| H1 | Supabase stagingへの新規migration適用 | Supabaseアクセストークン（個人所有）が必要 | **完了（2026-08-28）**。CLI環境が無いため、Dashboard SQL Editor＝`docs/runbook_supabase_hosted.md` §4の代替手順（トークン不要）で16本を適用し全20本。記帳・`platform_health()` 1行・Exposed schemasに`private`なしを確認 |
| H2 | 大学メールでのOTP実機確認 | 本人所有メールの受信が必要 | 未実施 |
| H3 | SMTP認証情報のDashboard設定 | secretをチャット・リポジトリへ置かない運用 | **完了扱い（2026-08-28）**。H6でstaging昇格を決定したため、staging設定済み（008・010）のSMTPをそのまま使う |
| H4 | privacy policy / 利用規約の最終承認 | 法的文書の最終判断 | 未実施 |
| H5 | `main`へのrelease PR merge判断 | 公開範囲の変更 | 未実施 |
| H6 | **公開用Supabaseプロジェクトの決定**（stagingを流用するか、productionを新規に作るか） | Supabaseアカウントの操作。Freeプランの範囲なら課金は発生しない | **完了（2026-08-28）**。既存 `cue-shinkan-staging` を昇格する |
| H7 | **GitHub Actions **secrets** へ `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` を設定** | どちらもブラウザへ出る値だが、**貼り間違いの封じ込めのためsecretへ置く**（D054。`vars.*` はログでマスクされない）。**チャットへ貼らない**。貼り間違えたら**先にSupabaseで失効**させる | **完了（2026-08-28）**。dry_run空撃ちの1回目でURL形式検査が正しく停止（貼り間違いを検出）→修正後の2回目でbuild・検証green・deploy skip |
| H8 | **Supabase Auth の Site URL を公開URLへ変更**（**Redirect URLsは追加しない**・§7.2） | Dashboardの操作 | **完了（2026-08-28）**。Site URLのみ変更・Redirect URLs追加なし |
| H9 | 送信ワーカー（Edge Function）のデプロイとスケジュール設定 | Supabaseアクセストークンが必要（`docs/runbook_supabase_hosted.md` §6.1） | **完了（2026-08-28）**。Dashboardのみで実施: エディタで2ファイルをデプロイ・Secrets6件・Integrations→Cron（`*/5 * * * *`・pg_net拡張を導入）。関数の「Verify JWT with legacy secret」は**OFF**（legacyキー無効化済みの本プロジェクトでは何も通らず恒常401になるため。権限はDB側RPCが握る）。`CUE_SMTP_PORT`は**465**（587のSTARTTLSはEdgeで`invalid cmd`・E7）。稼働確認: Invocations 200×2・`email_outbox_health()`全0（当時はキューが空）。**その後のsmoke test Bで実送信が全失敗し、Task 022（D058）で修正。新コードの再デプロイが未実施＝H9は「要再実施」** |
| H10 | 本番Supabaseでの `auth.users` 削除挙動の確認 | Dashboardでの実操作が必要（`docs/operations.md` §9） | 未実施 |
| **H11** | **公開前に Supabase Auth の Attack Protection（CAPTCHA・レート制限）を設定** | Dashboardの操作。**D030はこれをTask 011へ委ねたが、011のscopeに入っておらず実施されていない**（独立レビューで発覚） | **完了（2026-08-28）**。レート制限（メール送信20/時＝送信元Gmailの500/日の内側・他は既定のまま）＋Task 021 merge後にDashboardでCAPTCHA（Turnstile）を有効化・Secret KeyはDashboardのみ。**実機でのウィジェット付きログイン確認は公開後smoke test A** |

### H6〜H8 が揃うまで `main` へmergeしない（重要）

→ **この条件は2026-08-28に充足した**（H6: staging昇格 / H7: secrets設定＋dry_run検証 /
H8: Site URLのみ変更。§7表・§7.2参照）。以下は判断の背景として残す。

**Task 018で実装側の手当ては済んでいる。** `deploy-pages.yml` の build は
Actions **secrets** から `VITE_SUPABASE_*` を受け取り（D054）、直後の検証ステップが
「値の形式」と「バンドルへ入っているか」を確認して、揃っていなければ
deployを止める（`sb_secret_*` の貼り間違えもここで落ちる）。

それでも **H6〜H8 が無ければ公開できない**。
`src/lib/supabaseClient.ts` はどちらかが空だと `null` を返し、`AppRoot` は
`SetupNotice`（「接続設定が必要です」）を表示する。

公開URLは**いまPhase 1のlocalStorageデモとして動いている**（`main` の内容）。
Phase 2では `src/demo/DemoApp.tsx` が `AppRoot` から到達不能なので、
**設定なしでmergeすると「動いているデモ」が案内画面に置き換わる**。
Task 018のsmoke testも全滅する。

実装側の手当て（Task 018・**実装済み**）:

- `deploy-pages.yml` の build step へ `env:` を足した（値は `${{ secrets.* }}` の参照だけ）
- ビルド成果物に設定が入っているかを、**値を出さずに**確認するステップを足した
- 鍵の種類を許可リスト（`sb_publishable_*`）で検査し、secret keyの混入を止めた

残るのは **人間の操作だけ**（H6〜H8・H11 は2026-08-28完了。**H9-2（ワーカー再デプロイ）**・公開判断まわりの H2・H4・H5・smoke testが残る）。設定しないまま `main` へmergeすると、
検証ステップが落ちてdeployされない（**いま公開されているページはそのまま残る**）。

## 7.1 既知リスク一覧（公開前に運営者が読む）

**重大度**: P0 = 公開してはいけない / P1 = 公開判断で明示的に受容が要る /
P2 = 受容したうえで運用で見る / — = 対応済み。
独立レビューで「§7.1 にP0/P1が無い」を §6 の根拠にしていたが、
**そもそも分類していなかった**ため、ここで明示する。

各タスクの「残る課題」と `docs/operations.md` §8 を1か所へ集めたもの。
**直せていないものを直したことにしない。** 公開の判断はこの一覧を読んでから行う。

### A. 法務・同意

| # | 重大度 | 内容 | 影響 | いまの扱い |
|---|---|---|---|---|
| A1 | **P1** | **法令適合は未確認**。利用規約・プライバシーポリシーはドラフト | 公開後に不備が判明する可能性 | `【要確認】`で該当箇所を明示。運営者の最終確認（H4） |
| A2 | **P2** | 事業者情報・連絡先・準拠法・委託先が未確定 | 問い合わせ先が機能しない | プレースホルダーとして明示。公開判断時に確定 |
| A3 | **P2** | 保存期間の上限（無操作・卒業後）が未定 | データが無期限に残る | 監査ログは年1回の剪定を用意（`docs/runbook_operations.md` §8）。利用者データの上限は未定 |
| A4 | **P2** | 10–5ルールは英国ONSの公開手法を参考にしたもので、**法令準拠を主張しない**（D037） | 開示水準の妥当性が第三者検証を経ていない | decisionへ明記。運営者の最終確認 |

### B. プライバシー・セキュリティ

| # | 重大度 | 内容 | 影響 | いまの扱い |
|---|---|---|---|---|
| B1 | **P1** | **退会後もauth identity（大学メール）が残る**（D047） | 削除したはずのメールがDBに残る | 運営が `admin_delete_auth_identity` で消す運用。自動化されていない。画面で「ログイン情報の削除は運営が行う」と伝えている |
| B2 | **P2** | `admin_delete_auth_identity` の監査記録は**対象を持たない** | service_role keyが漏れた場合の事後追跡ができない | 「誰を消したか」を残さない設計の代償。Supabase側のログ（保持期間短）に依存 |
| B3 | **P1** | 本番Supabaseでの `auth.users` 削除の挙動が未検証 | 子テーブル・`auth.audit_log_entries` にメールが残る可能性 | H10 で確認する |
| B4 | **P2** | 運営操作は**SQL Editorから**行う（運営画面UIが無い） | 人間の操作ミスを機械的に防げない。`actor_label` の正しさは運用依存 | 手順を `docs/operations.md` に固定 |
| B5 | **P2** | 対象人数の `0` と `1–4` を区別する（D036の残余リスク） | 小集団の在・不在が観測できる | 受容済み。preview条件数の上限と24時間固定で回数を制限 |
| B6 | **—** | E2Eの失敗アーティファクトに入力値が残り得た | OTP・招待URLの露出 | `PLAYWRIGHT_NO_COPY_PROMPT` で停止（D051・PR #19でdevelopへmerge済み）。`test-results/` はgitignore、CIに `upload-artifact` は無い。**`toMatchAriaSnapshot` の失敗は環境変数で止まらない**ため、OTP・招待URLが出ている画面では使わない |
| B7 | **P1** | **Auth の CAPTCHA が無効**で、Supabase既定のメール送信レート制限だけが防壁。D030は緩和策をTask 011へ委ねたが、011のscopeに入っておらず未実施 | publishable keyは公開バンドルに必ず入るため、公開後は誰でもAuth APIを直接呼べる。任意アドレスへOTPを送らせられ、(a) 新歓期間中に実在の新入生がログインできない (b) 送信元Gmailが停止する（E6と複合） | **設定済み（2026-08-28）**: レート制限強化（メール20/時）＋Task 021（D057・Turnstile）をmergeし、DashboardでCAPTCHAを有効化した（H11b）。**実機でのウィジェット付きログイン往復は公開後smoke test Aで確認する**（それまで実機未検証のP1として扱う） |

### C. アクセシビリティ・UX

| # | 重大度 | 内容 | 影響 | いまの扱い |
|---|---|---|---|---|
| C1 | **P1** | **細線の枠が1.4.11（非テキスト3:1）を満たさない**。`.choice-chip`(0.16) / `.text-input`(0.18) / `.club-input`(0.24) / `.status-pending`(0.25) が白地で**1.39〜1.68**。`.button-primary` の coral 背景と周囲の境界も2.79 | 入力欄の境界が見えにくい利用者がいる | 3:1に届かせるにはalpha 0.50が必要で、アプリ全体の見え方が変わる。**公開前に運営者の判断が必要** |
| C2 | **P2** | スクリーンリーダー実機（VoiceOver / TalkBack）での確認が未実施 | 読み上げ順・読み上げ内容の問題を検出できていない | 自動検証は「フォーカスが移ること」までしか保証しない |
| C3 | **P2** | 390pxの目視確認が未実施 | 横スクロール以外のレイアウト崩れ | E2Eは横スクロールの有無だけを自動判定 |
| C4 | **P2** | セッションの**期限切れ**・**別端末でのログアウト**が未検証 | その経路で画面が壊れる可能性 | `sb-*` を消した場合のみ検証済み |

### D. 機能の穴

| # | 重大度 | 内容 | 影響 | いまの扱い |
|---|---|---|---|---|
| D1 | **P2** | 団体そのものの削除が未実装 | 不要な団体が残る | 最終ownerガードと配信snapshotの整合を別途設計する必要がある |
| D2 | **P2** | 担当者の削除・role変更（他人を外す操作）が未実装 | 担当者を交代できない | 運営がSQLで対応する |
| D3 | **P2** | **まとめメールは取り消せない**（D044） | 停止直後に「新しい案内があります」が届き得る | 本文に団体名・イベント名を含まないため誤解は生まない |
| D4 | **P2** | 停止を団体へ能動的に通知する仕組みが無い | 団体は自分の画面を見て初めて気づく | — |
| D5 | **P2** | 緊急停止は**配信済みの案内を止めない** | 配信済みのものは個別停止が必要 | `docs/operations.md` §3・§4 |
| D6 | **P2** | 単独ownerが退会すると、その団体の所属だけが残る（D049） | 団体が宙に浮く | 戻り値で件数を返し画面で伝える。運営が引き取る |

### E. 運用

| # | 重大度 | 内容 | 影響 | いまの扱い |
|---|---|---|---|---|
| E1 | **P2** | **Freeプロジェクトは約1週間の非アクティブでpauseされ得る** | 突然ログインできなくなる | 定期的に稼働を確認する |
| E2 | **P2** | **Authログの保持期間が短い** | 認証障害の事後調査ができない | 発生当日中に調査する |
| E3 | **P1** | 実メール送信がhosted未検証。**送信ワーカー（Edge Function）が未デプロイ**（H9） | デプロイしないとメール通知が**1通も飛ばない**。release notesは通知を機能として挙げている | **未解決（2026-08-28時点）**: ワーカーは設置・稼働しているが、smoke test Bで**実送信が全失敗**した（denomailerがEdge Runtimeで動かず `attempts=5` で `failed`・E7）。Task 022（D058）で `npm:nodemailer` へ置き換え済みだが、**hostedへ再デプロイするまでメール通知は1通も飛ばない**。公開前に再デプロイと実送達の確認が必須 |
| E4 | **P2** | 外部の監視サービスを使っていない | 障害に気づくのが遅れる | `platform_health()` を毎日見る運用（`docs/runbook_operations.md` §8）。**有料サービスは承認なしに追加しない** |
| E5 | **—** | ~~`email_outbox` の古い行を消す経路が無い~~ **対応済み（Task 019）** | — | `private.prune_email_outbox(retain_days)`（既定90日）を追加。**pending・sending は消さない**。定期作業へ登録した（`docs/runbook_operations.md` §8） |
| E6 | **P1** | **staging のSMTPは個人のGmail（1日500宛先）** | 本番の規模で頭打ちになる。送信元ドメインも借り物 | 本番は独自ドメイン＋専用プロバイダが必要（`docs/runbook_supabase_hosted.md` §7）。**H6と同時に判断する** |
| E7 | **P2** | denomailer 1.6.0 のSTARTTLS挙動が未確認 | 465以外のポートで平文送信になる可能性 | hosted stagingで実配信を確認するときに、ポートと暗号化を目視する（H9） → **2026-08-28: 465（暗黙TLS）を採用。さらにsmoke test Bで実送信が全失敗し（`Interrupted: operation canceled`・`attempts=5`で`failed`）、denomailer自体がEdge Runtimeで使えないことが判明した。Task 022で `npm:nodemailer` へ置き換え（D058）。実送信の成功はデプロイ後の再送で確認する（未検証）** |

## 7.2 人間の操作チェックリスト（公開までに必要なものだけ）

**実装側からは実行できない**操作だけを、実行順にまとめる（§7 の H1〜H11 を網羅する。H5 は段階3の release PR に含む）。
Supabaseアカウント・GitHubリポジトリ設定・本人所有の大学メールが要るため。

> **secretをチャットへ貼らないでください。** 値はDashboardとGitHubの設定画面へ
> 直接入力します。この文書にも実値は書きません（`docs/runbook_operations.md` §2）。

### 段階1: 接続先を決める（mergeの前）

- [x] **H6 公開用Supabaseプロジェクトを決める** — **2026-08-28完了: 既存 `cue-shinkan-staging` を昇格**。
  送信元は当面staging設定（個人Gmail・E6）のまま、release PR判断時にP1として受容可否を決める
  - なぜ: 接続先が決まらないと以降すべてが進まない
  - 画面: https://supabase.com/dashboard → プロジェクト一覧
  - 入力場所: 既存の `cue-shinkan-staging` を昇格するか、新規作成（Region: `ap-northeast-1`）
  - 成功判定: Project Settings → **API** に **Project URL** が表示される
    （`docs/runbook_supabase_hosted.md` §5 と同じ画面）
  - 注意: **Freeプランの範囲で行う。有料プランへの変更は別途相談**
  - **同時に決める（§7.1 E6・P1）**: 送信元をどうするか。
    stagingのSMTPは**個人Gmail（1日500宛先）**の暫定構成で、本番は
    独自ドメイン＋専用プロバイダが要る。ここで決めないと H3 の作業が決まらない

- [x] **H3 メール送信（SMTP）を設定する** — **2026-08-28完了扱い: staging昇格のため既存設定（2026-08-25移行済み）をそのまま使う。新規作業なし**
  - なぜ: **新規プロジェクトを作った場合、これが無いと新入生にOTPが1通も届かない。**
    2026-06-03以降に作成された新規Freeプロジェクトは、標準メールプロバイダのままだと
    **本文・件名を変更できず**（6桁コード形式にできない）、しかも
    **組織メンバーのアドレス宛にしか配信されない**
    （`docs/runbook_supabase_hosted.md` §3-2・プラットフォーム制約）
  - **stagingを昇格する場合は設定済み**（2026-08-25にカスタムSMTPへ移行済み）。
    **新規作成した場合は必須**
  - 画面: Supabase Dashboard → Project Settings → Authentication → SMTP Settings
  - 入力場所: H6で決めた送信元のホスト・ポート・ユーザー・パスワード・From
    （**値はDashboardへ直接入力。リポジトリ・チャット・CIへ置かない**）
  - 続けて: Authentication → Email Templates の「Magic Link」と「Confirm signup」の
    **両方**を、リンクではなく **6桁コード `{{ .Token }}` だけ**の本文へ差し替える
    （`app/supabase/templates/otp_code.html` と同等。§3-2）
  - 成功判定: **組織メンバー以外**の大学メールアドレス宛にOTPが届き、
    本文が6桁コード形式になっている

- [x] **H7 GitHub Actions の secrets に接続設定を入れる** — **2026-08-28完了**。
  dry_run空撃ち1回目はURL形式検査が停止（Project URL以外を貼った貼り間違いを設計どおり検出）。
  貼り直し後の2回目でbuild・検証・deploy skipまで全green（run 33135812020）
  - なぜ: 公開ビルドに接続先が埋め込まれないと「接続設定が必要です」の案内画面になる
  - 画面: リポジトリ → Settings → Secrets and variables → Actions → **Secrets** タブ
  - 入力場所: 「New repository secret」から2つ
    - `VITE_SUPABASE_URL` … Supabase の Project URL（`https://<ref>.supabase.co`）
    - `VITE_SUPABASE_PUBLISHABLE_KEY` … Project Settings → API Keys の **publishable key**（`sb_publishable_…`）
  - 成功判定: Secrets 一覧に2つ並ぶ（値は表示されない。それが正しい）
  - **Variables タブではありません**（D054。variables はログでマスクされない）
  - **`sb_secret_…` を貼らないこと。** 貼った場合は設定し直す前に Dashboard で失効させる

- [x] **H8 Auth の Site URL を公開URLへ変更する** — **2026-08-28完了**（Site URLのみ変更・Redirect URLs追加なし。Dashboard上で目視確認）
  - なぜ: いまは `http://localhost:5173/cue-shinkan-demo/` のまま（§3-3 の決定）。
    **本アプリはOTPコード方式でリンクを使わない**ため
    （`emailRedirectTo` を渡さず `verifyOtp` の6桁コード、`detectSessionInUrl: false`）、
    Site URL がログインを直接壊すわけではない。それでも本番でlocalhostを指したままにしない。
    テンプレートを既定へ戻した場合、既定文面の `{{ .SiteURL }}` がlocalhostを指す
  - 画面: Supabase Dashboard → Authentication → URL Configuration
  - 入力場所: **Site URL のみ** に `https://kokubuzemi2026-gif.github.io/cue-shinkan-demo/`
  - **Redirect URLs は追加しない**（`docs/runbook_supabase_hosted.md` §3-3。
    OTPコード方式でリダイレクトを使わない）
  - 成功判定: Authentication → URL Configuration の **Site URL が公開URLになっている**
    （OTP往復はSite URLの有無で結果が変わらないため、H8の判定には使えない）

- [x] **H11 Auth の Attack Protection を有効にする** — **2026-08-28完了**（H11aレート制限 + H11b CAPTCHA有効化。実機確認はsmoke test A）
  - なぜ: publishable key は公開バンドルに必ず入る。既定では CAPTCHA が無効で、
    Supabase 既定のレート制限だけが防壁（§7.1 B7・**P1**）。
    任意アドレスへ OTP を送らせられ、送信元Gmail（§7.1 E6）が止まりうる
  - **H11a レート制限 — 2026-08-28完了**: Authentication → Rate Limits で
    メール送信を**20/時**へ（20×24=480/日 ≤ 送信元Gmailの500/日）。他は既定のまま
    （説明会等で同一IPの正規利用者を弾かないため）。1時間に20人超の一斉登録イベント時だけ
    一時的に引き上げる
  - **H11b CAPTCHA — アプリ側はTask 021（D057）で実装。有効化は次の順で行う**:
    1. Task 021のmerge後であること。**有効化した時点からhosted Authはcaptchaトークン必須**になる
       （公開中のPhase 1デモはSupabase Auth不使用のため影響しないが、以後hostedでの
       ログイン確認はwidget入りビルド＝Task 021以降のビルド経由でしか通らない）
    2. Actions secretsに `VITE_TURNSTILE_SITE_KEY`（TurnstileのSite Key）があること
       — 2026-08-28設定済み。**Secret Keyと取り違えないこと**（どちらも `0x` で始まり
       機械判別できない。取り違えた場合はTurnstileでSecret Keyをローテーションする）
    3. Supabase Dashboard → Authentication → Attack Protection →
       CAPTCHA を有効化 → provider **Turnstile** → **Secret Key** を入力
       （Secret KeyはこのDashboard欄にだけ入力。チャット・リポジトリ禁止）
  - 成功判定: 公開後smoke test Aで、ログイン画面にウィジェットが表示され、
    通常のOTP送信が**通る**こと（過剰に締めていない）

### 段階2: hosted で通す（mergeの前が望ましい）

- [x] **H1 migration を適用する** — **2026-08-28完了**。
  実施記録: CLI環境が無いため、Dashboard SQL Editor＝`docs/runbook_supabase_hosted.md` §4の
  代替手順（postgres権限でSQLを番号順に実行し `schema_migrations` へ記帳）で実施。
  適用前の実態は**0008の4本のみ**（本書の旧記載「0008・0009まで適用済み」は誤り。
  `tasks/009` Phase B「未実施」が正）だったため、**0009×4を含む16本**を各ファイル個別の
  `begin`〜記帳〜`commit` で適用した。検証: `schema_migrations` 20行（番号順）/
  `platform_health()` 1行（実装に例外握りつぶしが無いため、auth系4列の権限エラーなしを含意）/
  Exposed schemasは `public, graphql_public` のみ。切り戻し演習と手元バックアップは未実施
  （staging実データは合成のみのため省略を受容）
  - なぜ: stagingへ未適用のmigrationが残っていた（適用済みは0008の4本のみだった）
  - 画面: 端末（Supabaseアクセストークンが要る）
  - 入力場所: `cd app && npx supabase link --project-ref <ref> && npx supabase db push`
  - 成功判定: `npx supabase migration list` でローカルとリモートの差分が無い。
    適用後に `select * from public.platform_health();` が1行返る
  - 事前に必ず: `docs/runbook_operations.md` §3 の手順（差分確認 → migrationを読む → backup → 適用 → `platform_health()` 確認）

- [ ] **H2 大学メールで OTP を1往復させる**
  - なぜ: Authの生存はDBのRPCでは確認できない（`docs/runbook_incident.md` §2.5）
  - 画面: 公開URL（または `npm run dev`）のログイン画面
  - 入力場所: 運営者本人の `@stu.kobe-u.ac.jp`
  - 成功判定: メールが届き、6桁コードでログインできる。件名・本文にコード以外の情報が無い

- [ ] **H9-2 送信ワーカーを nodemailer 版へ再デプロイする**（Task 022・D058）
  - なぜ: 初回デプロイ（denomailer）は**実送信が1通も成功しない**ことがsmoke test Bで判明した
  - 画面: Dashboard → Edge Functions → `send-notifications` → エディタで
    `index.ts` と `emailTemplate.ts` をTask 022の内容へ更新してDeploy
  - 続けて: SQL Editorで `update private.email_outbox set status='pending', attempts=0,
    next_attempt_at=now(), last_error_code=null where status='failed';`
  - 成功判定: **5分以内に実メールが届く**。届かない場合は `last_error_code` を見る
    （`smtp_auth` / `smtp_tls` / `smtp_stream` 等で原因が切り分けられる）
  - **`logger` / `debug` を有効にしないこと**（SMTP会話に全宛先と本文が載る・D042）

- [x] **H9 送信ワーカー（Edge Function）をデプロイする** — **2026-08-28完了**。
  実施記録（すべてDashboard・CLI不使用）: Secrets6件（`CUE_SMTP_PORT`は**465**。587の
  STARTTLSはEdgeで`invalid cmd`になり465の暗黙TLSへ変更・E7）→ エディタで
  `index.ts`+`emailTemplate.ts`の2ファイルをデプロイ → Integrations→Cronで
  `*/5 * * * *`（pg_net拡張をインストール）→ 401×3（legacyキー無効化済みのため
  「Verify JWT with legacy secret」が恒常拒否）→ 同設定をOFF → 503×1（STARTTLS）→
  ポート465へ変更 → **200×2・`email_outbox_health()`全0を確認**。
  実メール送達（§6.1手順4）はsmoke test A/Bで実施
  - なぜ: デプロイしないとメール通知が**1通も飛ばない**（§7.1 E3・**P1**）
  - 画面: 端末 + Supabase Dashboard
  - 入力場所: `npx supabase functions deploy send-notifications` →
    Dashboard → Edge Functions → Schedules で定期実行を設定
    （SMTP関連の secret は `npx supabase secrets set` で。`docs/runbook_supabase_hosted.md` §6.1）
  - 成功判定: 1回実行して `select * from public.email_outbox_health();` の
    `failed_count` が増えない。実際にメールが届く

- [ ] **H10 退会後の `auth.users` 削除挙動を確認する**
  - なぜ: 退会しても大学メールが残る（§7.1 B1・**P1**）。その解消可否がここで決まる
  - 画面: Supabase Dashboard → SQL Editor / Authentication → Users
  - 入力場所: 合成アカウントで `admin_delete_auth_identity` を実行
  - 成功判定: `auth.users` から消え、`auth.identities` / `sessions` / `refresh_tokens` が連鎖して消え、
    `auth.audit_log_entries` の JSON payload にメールが残らない
  - 残る場合: Admin API（`auth.admin.deleteUser`）へ寄せることを検討（`docs/operations.md` §9）

### 段階3: 公開する

- [x] **deploy を1回空撃ちする（`dry_run`）** — **2026-08-28完了**（2回目のrun 33135812020で
  build・「Verify build has Supabase config」成功・deploy skip。1回目はURL形式検査が設計どおり停止）
  - なぜ: 検証ステップは `push: main` と `workflow_dispatch` でしか走らず、
    PRのCIでは一度も実行されない。初回実行が本番deployになるのを避ける
  - 画面: Actions タブ → 「Deploy to GitHub Pages」→ Run workflow
  - 入力場所: **`develop` を選び**、`dry_run` にチェック
  - 成功判定: build と「Verify build has Supabase config」が成功し、deploy は skip される
  - **`main` を選ばないこと**（まだこの定義を持たないため旧定義が走る）

- [ ] **release PR を作って merge する**
  - なぜ: 公開範囲の変更（H5）。判断は人間が行う
  - 画面: GitHub → Pull requests → New pull request（base `main` ← compare `develop`）
  - 入力場所: —
  - 成功判定: CI green・独立レビュー/セキュリティレビュー済み・§7.1 の **P1 を読んで受容した**うえで merge

- [ ] **公開後 smoke test（A）を実行する**
  - なぜ: 公開URLで実際に動くかは、そこでしか確認できない
  - 画面: 公開URL + Supabase SQL Editor
  - 入力場所: `tasks/018-release-v1.md` §公開後smoke test の **A**（所要15〜20分）
  - 成功判定: A0〜A6 のチェックが埋まる。**A5で団体を作る前に、そこの注意書きを読むこと**

- [ ] **`v1.0.0` の tag / release を作る**
  - なぜ: 公開したものを特定できるようにする
  - 画面: GitHub → Releases → Draft a new release
  - 入力場所: tag `v1.0.0`（target `main`）。本文は `docs/release_notes_v1.0.md`
  - 成功判定: Releases に `v1.0.0` が出る

### 判断だけが必要なもの（実装の待ちではない）

- [ ] **H4 利用規約・プライバシーポリシーの最終確認**（§7.1 A1・**P1**）
  - `docs/legal/` はドラフト。**法令適合は断定していません。**
    `【要確認】` が運営者の決定または法的判断が必要な箇所です

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

| 2026-08-27 | Task 016完了（PR #17 `623f85a`）。独立レビューでBlocker 2件
  （コントラストの測定方法の誤り／自分が作ったフォーカスの穴）を検出し、再現して修正。
  CIの時限式pgTAPを別PR #18で修正。E2Eの失敗アーティファクトへ入力値が残る件を
  実機確認して別PR #19で修正。Task 017着手 |

| 2026-08-27 | Task 017完了（PR #20 `cebabdd`）。独立レビュー3周・security-reviewer 2周で
  Blocker 8件を検出し、すべて自分で再現して修正（quota超過の誤発報／health列の無検査＝
  リテラル0の変異体が全件pass／権限テストのPUBLIC除外／backup手順がリポジトリへPIIを
  書き出す／監査行数の恒真検査）。pgTAP 607→622件 |

| 2026-08-27 | Task 019完了（PR #21）。既知リスクE5（`email_outbox`の剪定経路が無い）を閉じ、
  ワーカーの並行取り出しを実プロセス並行で検証、生成型の差分を解消。
  pgTAP 622→**641**件、並行10→15件。独立レビュー2本はBlocker 0件で、
  検証の穴（retain_daysが未検査・並行テストの同期が空振りしうる・
  search_pathの固定が無い）を塞いだ（`05e2701`） |

| 2026-08-27 | Task 018（release準備・PR #22）。`deploy-pages.yml` へ接続設定の受け渡しと
  検証ステップを追加。release notes・公開後smoke test・READMEの公開手順を用意。
  **独立レビュー3周（Blocker 4→3→3件）・security-reviewer 2周（4→1件）**で修正（うち
  **貼り間違えたsecret keyが公開Actionsログへ平文で出る**経路をD054で塞いだ）。
  **`develop → main` の release PR は未作成**（H6〜H8・H11 が未了） |

| 2026-08-28 | Task 020完了（PR #25 `607891f`）。入口分離（新入生／団体担当者・D056）。
  E2E flake（同一アドレス連続ログインが `max_frequency = "1s"` 境界でrateLimited）を
  CIログの時刻から実測特定し、E2E側の有限回リトライで吸収。UX・securityの独立レビューを
  最終SHAまで承認拡張してsquash merge。**ソフトウェア側release blocker解消** |

| 2026-08-28 | 人間の操作を実施: **H6**（stagingを昇格と決定）→ **H7**（secrets設定。
  dry_run 1回目はURL形式検査が貼り間違いを設計どおり停止、貼り直し後の2回目で全green）→
  **H8**（Site URLのみ変更）→ **H1**（SQL Editor＝runbook §4方式で16本適用→全20本。
  適用時に**本書の「0008・0009適用済み」が誤記**で実態は0008のみと判明し、本書を訂正。
  `platform_health()` 1行・Exposed schemasに`private`なしを確認）。
  残る人間の操作は H2・H4・H9〜H11 と release PR（H5） |

| 2026-08-28 | Task 021完了（PR #27 `6bf1829`）。OTP送信へCAPTCHA（Turnstile・D057）。
  独立レビュー2本（reviewer: B1=auth正本§9の許可リスト矛盾→解消確認のうえ承認 /
  security: 承認・NB6件すべて対応）を最終SHA `a590ddf` へ承認拡張してsquash merge。
  merge後のdry_run空撃ちでsitekey検証の通過を実地確認（deploy skip）。
  **H11完了**: H11aレート制限（メール20/時）+ H11b DashboardでTurnstile有効化。
  実機のウィジェット付きログイン確認は公開後smoke test Aで行う。
  残る人間の操作は H2・H4・H9・H10 と release PR（H5） |

| 2026-08-28 | **H9完了**（送信ワーカー）。Dashboardのみで設置: Secrets6件→エディタデプロイ→
  Cron 5分間隔（pg_net導入）。詰まりどころ2つを解消: (1) 401×3＝legacyキー無効化済み
  プロジェクトで「Verify JWT with legacy secret」が恒常拒否→OFF（権限はDB側RPCが握るため
  影響限定・Dashboard自身の推奨もOFF）。(2) 503×1＝587のSTARTTLSがEdgeで`invalid cmd`
  （E7が実体化）→465の暗黙TLSへ。以後 200×2・`email_outbox_health()`全0。
  実送達の確認はsmoke test A/Bへ。残る人間の操作は H2・H4・H10 と release PR（H5） |

## 9. 次回再開時の開始点

**実装側の作業は Task 020 まで完了し、ソフトウェア側のrelease blockerは解消済み。
H1・H3・H6〜H8・H11と空撃ち（dry_run・Task 021検証込み）も2026-08-28に完了。
**ただしsmoke test Bでメール通知の実送信が全失敗し、Task 022（D058）で修正済み・再デプロイ待ち（H9-2）。**
残りは §7 の人間の操作（H2・H4・H10・**H9-2**）とsmoke test、段階3のrelease PR（H5）以降。**

### いま止まっているもの

| 番号 | 内容 | これが無いと |
|---|---|---|
| H6 | ✅ **2026-08-28完了**（stagingを昇格） | 接続先が決まらない |
| H7 | ✅ **2026-08-28完了**（secrets設定・dry_runで検証済み・D054） | 公開ビルドが接続設定を持てない（deployが検証ステップで止まる） |
| H8 | ✅ **2026-08-28完了**（Site URLのみ変更・Redirect URLs追加なし） | 本番でSite URLがlocalhostを指したまま残る |
| H1 | ✅ **2026-08-28完了**（SQL Editor方式で全20本） | §6 の「migration・rollback確認済み」が埋まらない |
| H2 | 大学メールでのOTP実機確認 | ログインの生存確認ができない |
| **H9-2** | ⚠️ **要再実施**: 初回デプロイ（denomailer）は実送信が全失敗。Task 022で修正済みの**再デプロイが未実施** | 実メールが1通も飛ばない |
| H11 | ✅ **2026-08-28完了**（レート制限 + Turnstile有効化） | 公開後にOTP送信を濫用されうる（§7.1 B7・**P1**） |
| H10 | 退会後の `auth.users` 削除の挙動確認 | 退会したのに大学メールが残る |

**ソフトウェア側のrelease blocker**: Task 020（入口分離・D056）が `develop` へ
mergeされるまで公開しない（H項目ではなく実装側の条件。人間の操作は不要）。
→ **解消済み（2026-08-28、PR #25のmerge `607891f`）**。

H6〜H8（新規プロジェクトの場合はH3も）が揃うまで **`main` へmergeしない**
→ **2026-08-28に充足**。H11も同日完了（B7）。**H9は初回デプロイが実送信に失敗したため「要再実施」（H9-2・§7.1 E3はP1のまま未解決）**。実機確認はsmoke test A/Bへ。

### 揃ったあとの手順

0. **`main` へmergeする前に、deployを1回空撃ちする（`dry_run`）。**
   検証ステップは `push: main` と `workflow_dispatch` でしか走らないため、
   **PRのCIでは一度も実行されない**。初回実行が本番deployになるのを避ける。

   Actionsタブ → 「Deploy to GitHub Pages」→ Run workflow で、
   **この定義を持つブランチ**（`develop` など）を選び、`dry_run` を有効にする。
   build・検証・artifactの生成までが走り、**deploy jobだけがskipされる**。

   **`main` を選んではいけない。** `workflow_dispatch` は選んだrefの
   ワークフロー定義を実行するため、まだこの定義を持たない `main` を選ぶと
   検証ステップの無い旧定義が走り、**「通った」という誤った確信だけが残る**
   （独立レビューで実証された）
1. `develop → main` の release PR を**新規に作る**
   （`feat/018-release-v1` は base=`develop` の通常タスクPRで、release PRではない）
2. 独立レビュー + security-reviewer → CI green を確認して `main` へmerge
3. Actionsタブで「Deploy to GitHub Pages」の成功を確認
4. `tasks/018-release-v1.md` §公開後smoke test を上から実行する
5. 安定を確認してから `v1.0.0` の tag / release を作る
6. 本書 §6 を完了へ更新する

### 再開時に必ず再確認する

1. `git fetch origin && git log --oneline -5 origin/develop`
2. open PRとCIの状態
3. 本書§3の状態表と§7の人間待ち項目
