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
**最終更新: 2026-08-27（Task 019まで完了時点）**

### 2.1 新入生

| 完成像 | 状態 | 担当Task |
|---|---|---|
| 大学メールOTPで登録・ログイン | ✅ | 008 |
| 複数ロールの安全な切替 | ✅ | 008 |
| パスポートの登録・更新 | ✅ | 009 |
| パスポートの**削除** | ✅ `delete_student_passport`（D046） | 014 |
| 個人情報を団体へ非公開のままオファー受信 | ✅ | 009 |
| オファー到着のメール通知 | ✅（**実送信はhosted待ち**・H9） | 010 |
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
| backup・復旧・rollback・incident runbook | ✅ `docs/runbook_operations.md`（環境変数・migration・rollback・backup/restore・secret rotation・公開停止5段階・定期作業・ログの方針）+ `docs/runbook_incident.md`（状況別の初手）。**ただしstagingでの実行確認は未実施**（H1） | 017 |
| 古いデータの掃除 | ✅ 監査365日 / preview 48時間 / outbox 90日。いずれも**DB管理者のみ・手作業**（D052・D053） | 017/019 |
| service role key・SMTP認証情報をクライアントへ出さない | ✅ 維持（010で再確認・018でビルド成果物を実測） | 010/017/018 |

### 2.4 品質

| 完成像 | 状態 | 担当Task |
|---|---|---|
| スマホ主要導線 | ✅ | 006/008/009 |
| アクセシビリティ（キーボード・focus・label・contrast） | ⚠️ 体系的に検証し、コントラスト2件とフォーカス移動を修正。**入力欄の枠が1.4.11未達・スクリーンリーダー実機未確認**（§7.1 C1・C2） | 016 |
| loading / empty / error / retry | ✅ 主要画面を確認 | 016 |
| 認証・RLS・RPC・匿名性・E2Eの自動テスト | ✅ pgTAP 636件（35ファイル）/ 並行15件 / unit 365件 / E2E | 008〜019 |
| staging実環境検証 | ⚠️ **008のみ完了。009以降は未実施**（H1・H9） | Phase B |
| release PRと公開後smoke test | ⚠️ 手順は用意済み（production用A・staging用Bに分割）。**実行は公開後**（H6〜H8待ち） | 018 |
| P0/P1既知不具合ゼロ | ⚠️ §7.1 へ重大度を付与。**P0は0件・P1は5件**（公開判断で受容が要る） | 018 |

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
| 016 | UX・アクセシビリティ・完全E2E | **完了（developへmerge済み `623f85a`）** | [#17](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/17) | 010〜015 |
| 017 | 運用（structured logging・health・runbook・secret rotation） | **実装完了・レビュー待ち** | — | 010 |
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

状態は2026-08-27時点。**未達の3件はすべて `docs/launch_plan.md` §7 の
人間待ち項目（H1・H6〜H10）が原因**で、実装側からは進められない。

| 条件 | 状態 | 根拠・残る作業 |
|---|---|---|
| Task 010・011・013〜018がすべて`develop`へmerge済み | **達成**（+019） | 008〜017・019がmerge済み。018は本タスク |
| P0/P1の既知不具合ゼロ | **一部** | §7.1 に重大度を付与した結果、**P0は0件、P1は5件**（A1法令未確認 / B1 auth identity残存 / B7 Attack Protection未設定 / C1 WCAG 1.4.11未達 / E6 SMTP上限）。**P1は公開判断で明示的に受容が要る** |
| 未解決の認証・RLS・privacy blockerゼロ | **達成** | 各タスクの独立レビュー・security-reviewerでBlocker 0 |
| 全CI green | **達成** | quality / db-tests / e2e / audit |
| staging E2E green | **未達** | H1・H9。Supabaseアカウントが要る |
| migration・rollback確認済み | **一部** | ローカル18 migrationの適用は毎回検証。hostedでの適用・切り戻しは未実施（H1） |
| secret漏洩なし | **達成** | `VITE_*` 以外をビルドへ入れないことを実測。E2Eアーティファクトの入力値漏れも塞いだ（D051） |
| 合成データ以外がcommitされていない | **達成** | テストデータは `demo-*@stu.kobe-u.ac.jp` の合成のみ |
| privacy / termsのdraftがあり、要確認箇所が明示されている | **達成** | `docs/legal/`・【要確認】（D050）。**法令適合は運営者の最終確認事項** |
| 公開後smoke testとrollback手順がある | **達成** | `tasks/018-release-v1.md` §公開後smoke test / `docs/runbook_operations.md` §4・§7 |
| release notesと既知制限がある | **達成** | `docs/release_notes_v1.0.md` / §7.1 |
| release PRに独立レビューとセキュリティレビューを実施 | **未達** | `develop → main` のrelease PRはまだ作っていない。Task 018のPR（base=develop）では独立レビュー・security-reviewerを各1本実施し、Blocker 8件を修正した |
| main反映後のdeploy監視とsmoke test完了 | **未達** | H6〜H8が未了のためmergeしていない |
| `v1.0.0` のrelease / tag作成 | **未達** | main反映後に作る |

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
| H6 | **公開用Supabaseプロジェクトの決定**（stagingを流用するか、productionを新規に作るか） | Supabaseアカウントの操作。Freeプランの範囲なら課金は発生しない | 未実施 |
| H7 | **GitHub Actions variables へ `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` を設定** | どちらもブラウザへ出る値なのでsecretではなくvariableでよい。**チャットへ貼らない** | 未実施 |
| H8 | **公開ドメインを Supabase Auth の Site URL / Redirect URLs へ追加** | Dashboardの操作 | 未実施 |
| H9 | 送信ワーカー（Edge Function）のデプロイとスケジュール設定 | Supabaseアクセストークンが必要（`docs/runbook_supabase_hosted.md` §6.1） | 未実施 |
| H10 | 本番Supabaseでの `auth.users` 削除挙動の確認 | Dashboardでの実操作が必要（`docs/operations.md` §9） | 未実施 |
| **H11** | **公開前に Supabase Auth の Attack Protection（CAPTCHA・レート制限）を設定** | Dashboardの操作。**D030はこれをTask 011へ委ねたが、011のscopeに入っておらず実施されていない**（独立レビューで発覚）。publishable keyは公開バンドルに必ず入るため、公開後は誰でもAuth APIを直接呼べる | 未実施 |

### H6〜H8 が揃うまで `main` へmergeしない（重要）

**Task 018で実装側の手当ては済んでいる。** `deploy-pages.yml` の build は
Actions variables から `VITE_SUPABASE_*` を受け取り、直後の検証ステップが
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

- `deploy-pages.yml` の build step へ `env:` を足した（値は `${{ vars.* }}` の参照だけ）
- ビルド成果物に設定が入っているかを、**値を出さずに**確認するステップを足した
- 鍵の種類を許可リスト（`sb_publishable_*`）で検査し、secret keyの混入を止めた

残るのは **H6・H7・H8 の人間の操作だけ**。設定しないまま `main` へmergeすると、
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
| B2 | **P1** | `admin_delete_auth_identity` の監査記録は**対象を持たない** | service_role keyが漏れた場合の事後追跡ができない | 「誰を消したか」を残さない設計の代償。Supabase側のログ（保持期間短）に依存 |
| B3 | **P1** | 本番Supabaseでの `auth.users` 削除の挙動が未検証 | 子テーブル・`auth.audit_log_entries` にメールが残る可能性 | H10 で確認する |
| B4 | **P1** | 運営操作は**SQL Editorから**行う（運営画面UIが無い） | 人間の操作ミスを機械的に防げない。`actor_label` の正しさは運用依存 | 手順を `docs/operations.md` に固定 |
| B5 | **P1** | 対象人数の `0` と `1–4` を区別する（D036の残余リスク） | 小集団の在・不在が観測できる | 受容済み。preview条件数の上限と24時間固定で回数を制限 |
| B6 | **P1** | E2Eの失敗アーティファクトに入力値が残り得た | OTP・招待URLの露出 | `PLAYWRIGHT_NO_COPY_PROMPT` で停止（D051・PR #19でdevelopへmerge済み）。`test-results/` はgitignore、CIに `upload-artifact` は無い。**`toMatchAriaSnapshot` の失敗は環境変数で止まらない**ため、OTP・招待URLが出ている画面では使わない |
| B7 | **P1** | **Auth の Attack Protection（CAPTCHA・レート制限）が既定のまま**。D030は緩和策をTask 011へ委ねたが、011のscopeに入っておらず未実施 | publishable keyは公開バンドルに必ず入るため、公開後は誰でもAuth APIを直接呼べる。任意アドレスへOTPを送らせられ、(a) 新歓期間中に実在の新入生がログインできない (b) 送信元Gmailが停止する（E6と複合） | **公開前にDashboardで設定する（H11）**。設定するまで公開しない |

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
| E3 | **P2** | 実メール送信がhosted未検証 | 本番で届かない可能性 | H9 で確認する |
| E4 | **P2** | 外部の監視サービスを使っていない | 障害に気づくのが遅れる | `platform_health()` を毎日見る運用（`docs/runbook_operations.md` §8）。**有料サービスは承認なしに追加しない** |
| E5 | **—** | **`email_outbox` の古い行を消す経路が無い** | `user_id` を持つ行が無期限に増える | Task 010が017へ引き継いだ項目だが、017では**実装していない**（監査とpreviewだけ剪定した）。次のタスクで対応する |
| E6 | **P1** | **staging のSMTPは個人のGmail（1日500宛先）** | 本番の規模で頭打ちになる。送信元ドメインも借り物 | 本番は独自ドメイン＋専用プロバイダが必要（`docs/runbook_supabase_hosted.md` §7）。**H6と同時に判断する** |
| E7 | **P2** | denomailer 1.6.0 のSTARTTLS挙動が未確認 | 465以外のポートで平文送信になる可能性 | hosted stagingで実配信を確認するときに、ポートと暗号化を目視する（H9） |

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
  pgTAP 622→636件、並行10→15件 |

| 2026-08-27 | Task 018（release準備）。`deploy-pages.yml` へ接続設定の受け渡しと
  検証ステップを追加。release notes・公開後smoke test・READMEの公開手順を用意。
  **release PRはdraftのまま**（H6〜H8が未了） |

## 9. 次回再開時の開始点

**実装側の作業は Task 019 まで完了している。次に必要なのは §7 の人間の操作。**

### いま止まっているもの

| 番号 | 内容 | これが無いと |
|---|---|---|
| **H6** | 公開用Supabaseプロジェクトの作成（または staging を昇格する判断） | 接続先が決まらない |
| **H7** | GitHub Actions **variables** へ `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | 公開ビルドが接続設定を持てない（deployが検証ステップで止まる） |
| **H8** | Supabase Auth の Site URL / Redirect URL を公開URLへ | OTPのリンク先が壊れる |
| H1 | hosted staging への migration 適用 | §6 の「migration・rollback確認済み」が埋まらない |
| H2 | 大学メールでのOTP実機確認 | ログインの生存確認ができない |
| H9 | 送信ワーカー（Edge Function）のデプロイとスケジュール設定 | 実メールが1通も飛ばない |
| **H11** | **Auth の Attack Protection 設定** | 公開後にOTP送信を濫用されうる（§7.1 B7・**P1**） |
| H10 | 退会後の `auth.users` 削除の挙動確認 | 退会したのに大学メールが残る |

H6〜H8 が揃うまで **`main` へmergeしない**。**H11 は公開前に必ず設定する**（§7.1 B7）。

### 揃ったあとの手順

0. **`main` へmergeする前に、deployを1回空撃ちする。**
   `deploy-pages.yml` の検証ステップは `push: main` と `workflow_dispatch` でしか
   走らないため、**PRのCIでは一度も実行されない**。初回実行が本番deployになるのを
   避ける。Actionsタブ → 「Deploy to GitHub Pages」→ Run workflow（`main`を選ぶ）で、
   H7設定後の値が検証を通ることを先に確かめる
   （この時点の `main` はPhase 1のままなので、成功しても公開内容は変わらない）
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
