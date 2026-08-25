# Task 009: サーバーデータ移行

## 目的

Phase 1がlocalStorageへ保存していたデモ状態（興味パスポート・配信・既読・返答）を、認証済みユーザーのサーバーデータ（Supabase + RLS + SECURITY DEFINER RPC）へ移行し、Task 008の認証済みシェルの「準備中」を実機能（新入生ホーム・受信箱・団体オファー配信・匿名ファネル）へ置き換える（D026⑤）。

正本: `docs/server_data_model.md`（設計）、`docs/decisions.md` D032〜D034（決定）、`docs/auth_and_authorization.md` §11（008からの引き継ぎ契約）、`docs/runbook_supabase_hosted.md`（hosted手順）。

> 本文書はTask 009実装時に作成した。着手時点でtasks/009の正式文書が存在しなかったため、既存のプロダクト要件（product_spec / matching_and_safety §1-§6 / decisions D019〜D031）とPhase 1実装を根拠に受入条件を定義している。仕様の新設はD032〜D034の3点のみで、既存仕様の変更は行っていない。

## 変更してよい範囲

- `docs/**`（server_data_model.md新設・decisions.md追記・README現在地・runbook追記・auth_and_authorization.md §5の相互参照）
- `tasks/009-*.md`
- `app/supabase/migrations/`（追記のみ。既存migrationは編集しない）・`app/supabase/tests/`（追加のみ）
- `app/src/lib/database.types.ts`、新設の`app/src/serverdata/ student/`、`app/src/org/`への追加
- `app/src/shell/`（AuthenticatedShell・OrgHome・StudentPreparing削除）
- `app/src/features/club/ClubDashboard.tsx`（後方互換の`canCreate`プロパティ追加のみ）
- `app/e2e/`（task009スペック追加）

## 変更してはいけない範囲

- `.github/workflows/**`・`app/vite.config.ts`・`app/index.html`
- 既存migration（`20260824*`）・既存pgTAPテスト（`01〜10`）・既存Vitestテスト
- `app/src/demo/**`・`app/src/data/**`・`app/src/storage/**`・`app/src/domain/**`（読み取り専用で再利用）
- `main`ブランチ・公開デモ（GitHub Pages）・`deploy-pages.yml`

## localStorage → サーバーの対応表

| 現在のlocalStorageデータ | 使用機能 | 所有者 | 移行先 | 読み書き手段 | RLS/RPC | 移行後の削除方針 | テスト |
|---|---|---|---|---|---|---|---|
| `cue-demo:student-preference`（StudentPreference v1） | 興味パスポート・受信設定 | 学生本人 | `public.student_passports` | 読取=RLS付きSELECT / 書込=`save_student_passport` | 自分の行のみSELECT可・書込grantなし | 検証付き一回限り取り込み成功後に削除 | pgTAP 13・Vitest demoMigration・E2E step 13 |
| `cue-demo:offer-deliveries`（OfferDelivery[] v1） | 送信済みキャンペーン・受信箱の正本 | 団体（デモ） | `private.offer_deliveries` + `private.offer_recipients`（新規データのみ） | `send_offer` / `list_my_inbox` / `list_org_campaigns` | privateスキーマ・RPC限定 | 取り込まず削除（架空デモ団体のデータ） | pgTAP 14〜16・E2E step 7〜10 |
| `cue-demo:offer-reads`（OfferReadMark[] v1） | 既読・未読状態 | 学生本人 | `private.offer_reads` | `mark_offer_read` / `list_my_inbox` | privateスキーマ・RPC限定 | 取り込まず削除 | pgTAP 15・E2E step 9 |
| `cue-demo:offer-responses`（OfferResponse[] v1） | 3段階返答・団体ファネル | 学生本人 | `private.offer_responses` | `respond_to_offer` / `list_my_inbox` / `list_org_campaigns` | privateスキーマ・RPC限定 | 取り込まず削除 | pgTAP 15〜16・E2E step 9〜10 |
| `sb-*`（auth-jsセッション） | 認証セッション | auth-js | 移行しない（Task 008の方針を維持） | auth-js | — | 保持（唯一の許可キー） | E2E step 3・13 |

認証済みシェルが`cue-demo:*`を新規生成することはなく、E2Eで「localStorageは`sb-*`のみ」を厳密検査する。

## 実装要件（要約）

1. migration追記4本: enum+テーブル+trigger / マッチングSQL関数（TS同一判定表） / RPC 8本 / RLS・grant
2. マッチング・同一イベント判定・週枠（D021）・ファネル（D022）・snapshot固定（D023）のサーバー移植。TS/SQLの判定同一性を同一ケース表（C01〜C16）で両側テスト
3. 送信はowner/admin + verified団体のみ。プレビュー・送信・ファネルは匿名件数のみ（D007/D029）
4. 学生の受信箱・返答・既読は受信者本人のみ。受信表示は配信時snapshotで固定
5. 公式窓口（D033）: organizationsへ2列追加+更新RPC。「行ってみたい」後にのみ学生へ開示
6. 旧デモデータの一回限り移行（D034・冪等・検証付き・失敗時はデータを失わない）
7. 認証済みシェルの置換（StudentArea / OrgOffersPanel / OrgContactForm・集中モード）
8. エラー時は定型文+再試行（生エラー・メール・IDを画面へ出さない）。再取得中は表示中のコンテキストを保持

## 受入条件

### Phase A（ローカル実装）

- [x] `npm run lint`（警告0）/ `npm run test -- --run`（既存281件+新規36件=317件全green）/ `npm run build` 成功
- [x] pgTAP: 既存`01〜10`を変更せず全green維持。新規`11〜16`が以下を検証:
  T1 新規オブジェクトの権限サーフェス（anonゼロ・authenticatedはpassports SELECT+公開RPC8本のみ・private4テーブル到達不可・PUBLIC/anon EXECUTE残存なし・全新規テーブルRLS有効） /
  T2 TS/SQLマッチング同値（C01〜C16: 配点・65点閾値・理由/注意の文言と優先順・上限・金額表記・停止/カテゴリ不許可） /
  T3 パスポートの保存と分離（本人のみRPC保存・重複入力の正規化・他人の行不可視・direct DML拒否・入力検証・非学生拒否） /
  T4 送信の権限・枠・再送禁止（非メンバー/member/pending/suspended拒否・表記ゆれ再送拒否・週3枠・学生週上限・配信0人は保存しない原子性・snapshot保存） /
  T5 受信箱の分離（受信者本人のみ・非受信者の既読/返答拒否・既読の初回時刻保持・返答上書き・団体改名後もsnapshot不変・ドメイン外/非学生拒否） /
  T6 匿名ファネルとPIIサーフェス（D022の件数・既読なし返答も閲覧に数える・返答変更の反映・他団体不可視・団体向けRPCに学生ID/PII列なし）
- [x] Playwright E2E `task009-server-data.spec.ts`（390×844）: 登録→パスポート作成→空状態→団体作成→（運営SQLでverified化）→公式窓口→作成→匿名プレビュー→送信→受信箱表示（理由・未読）→既読→「行ってみたい」→公式窓口開示→匿名ファネル更新→ログアウト/再ログイン復元→同一ユーザー別context→旧デモデータ移行（引き継ぎ+4キー削除+壊れたデータ破棄）→REST/RPC越権プローブ（他人行・direct DML・private・他団体・anon・非学生）→console error/予期しない失敗リクエスト/横スクロール/localStorageキー（`sb-*`のみ）の検査
  （実装環境にDockerがないため、pgTAPはPostgreSQL 16 + Supabase相当スキャフォールドでローカル全green確認済み。CI `db-tests` / `e2e` ジョブが正式判定）
- [x] 認証済みシェルが`cue-demo:*`を新規生成しない・移行後にキーが残らない・`sb-*`以外の認証/個人データをlocalStorageへ置かない
- [x] リポジトリ・テストにsecret・実在メールなし（架空の`demo-*@stu.kobe-u.ac.jp`のみ）

### Phase B（hosted staging確認）

- [ ] staging（`cyjmduaijtdihfesawvd`）がproductionでないことを読み戻しで再確認し、Task 009 migrationを番号順に適用・schema/RLS/policy/grant/関数権限を読み戻し確認
- [ ] 架空`@stu.kobe-u.ac.jp`ユーザーでサーバー永続化・ユーザー分離・再ログイン・別contextを390×844で実機確認
- [ ] 検証用データ（団体・membership・passport・配信・既読・返答・auth user）を依存順に完全削除し、count読み戻しで検証前状態へ戻ったことを確認
- [ ] 結果を本文書「Phase B 検証記録」へ記録（完了までは「実装完了・hosted検証待ち」）

### Phase B 検証記録

**未実施（2026-08-25時点）。実装セッションの実行環境からhosted stagingへ到達できないため。**

- 事象: `supabase login`（`--no-browser`）のトークン交換が常に `failed to execute http request: Transport error (GET https://api.supabase.com/platform/cli/login/<session>?device_code=<code>)` で失敗する。ブラウザ承認は完了しており、コードもCLIへ正しく渡っている（エラーURLに device_code が載っている）
- 切り分け:
  - `curl` / Node の `fetch` から同一エンドポイントへは到達できる（HTTP 400/404 が返る＝ネットワーク経路は生きている）
  - egressプロキシの記録に `api.supabase.com` の失敗はなく、CONNECT自体は成功している
  - Supabase CLIはDNS-over-HTTPS（1.1.1.1）を使い、これは組織のegressポリシーで拒否される（403）。`--dns-resolver native` でDoHは回避できるが、交換は同じエラーで失敗する
  - CLI本体はGo（BoringCrypto）製バイナリで、TLSを再終端するプロキシ環境と相性が悪い。`/root/.ccr/README.md` の「Not supported through the proxy（報告し、迂回しない）」に該当する
- 結論: この実行環境からCLIのアクセストークンを取得できず、Management API経由のmigration適用・実機検証を行えない。**回避策は取らない**（TLS検証の無効化・プロキシの迂回は禁止事項）
- 次の実施方法: 下記いずれか
  1. 開発者のローカル端末（プロキシ制約のない環境）で `supabase login` 済みの状態から実行する
  2. 組織のegressポリシーでSupabase CLIの要件を許可してもらう
- 実行手順は `docs/runbook_supabase_hosted.md` §4・§6のとおり。適用対象は本Taskの4migration（`20260825054000`〜`20260825054008`）で、確認項目は上記「Phase B（hosted staging確認）」チェックリストに従う

## 対象外

- メール通知（→010）
- 通報の受付処理・レート制限・運営管理画面・ドメイン外identity対策の恒久化（→011）
- メンバー削除・role変更、オファーの編集・取消・下書き保存
- 本番Supabase・Pages公開内容の変更・`main`へのマージ
