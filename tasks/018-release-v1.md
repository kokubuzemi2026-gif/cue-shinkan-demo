# Task 018: v1.0リリース

## Goal（目的）

`develop` を `main` へ反映し、閉鎖β版 v1.0 を公開できる状態にする。
公開後のsmoke testとrollback手順を用意し、`v1.0.0` のtagを作る。

## Source of truth（正本）

- `docs/launch_plan.md`: §6（完了条件）
- 全タスクの Verification record

## In scope

- `docs/release_notes_v1.0.md`（新規）
- `docs/launch_plan.md`（完了記録）
- `.github/workflows/deploy-pages.yml`（公開ビルドへ接続設定を渡す）
- `README.md`（公開手順）
- `tasks/018-release-v1.md`

## Out of scope

- 新機能の追加
- 実データの投入

## 前提条件（すべて満たすまでrelease PRを作らない）

- [x] Task 010・011・013〜017が`develop`へmerge済み（008〜017 + 019）
- [x] P0/P1の既知不具合ゼロ
- [x] 未解決の認証・RLS・privacy blockerゼロ
- [x] 全CI green（quality / db-tests / e2e / audit）
- [ ] staging E2E green ← **未実施**（H1・H9。人間の操作が要る）
- [ ] migration・rollback確認済み ← **ローカルのみ**。hostedは未実施（H1）
- [x] secret漏洩なし
- [x] 合成データ以外がcommitされていない
- [x] privacy / termsのdraftがあり、要確認箇所が明示されている

## Acceptance criteria

- [x] release notesがある（`docs/release_notes_v1.0.md`）
- [x] 公開後smoke testの手順がある（本ファイル §公開後smoke test）
- [x] rollback手順がある（`docs/runbook_operations.md` §4・§7）
- [ ] `develop` → `main` のrelease PRに独立レビューとセキュリティレビューを実施した ← **release PR作成後に実施**
- [ ] main反映後のdeployが完了している ← **未実施**（H6〜H8が未了）
- [ ] smoke test: トップページ / OTP開始 / ロール別ログイン / 新入生パスポート /
      団体画面 / 受信箱 / offer作成 / privacy-safe preview / メール通知 / エラー監視
      ← **手順は用意済み・実行は公開後**
- [ ] `v1.0.0` のrelease / tagがある ← **未作成**（main反映後に作る）
- [ ] `docs/launch_plan.md` が完了になっている ← **H1・H6〜H10が未了**

## 公開後smoke test

`main` へmergeし、Pagesのdeployが成功したあとに実行する。
**実在する学生を巻き込まない。** 使うのは運営者本人が管理する大学メールだけ。
確認が終わったら、作った検証用データとauth identityを消す。

所要時間の目安: 20〜30分。

#### 事前

- [ ] Actionsタブで「Deploy to GitHub Pages」の最新runが成功している
- [ ] `platform_health()` を service_role で実行し、`delivery_paused` が `false`

#### 1. トップページ

- [ ] 公開URLが開く。**「接続設定が必要です」ではない**（H7が効いている）
- [ ] 「大学メールでログイン」の見出しが出る
- [ ] 幅390pxで横スクロールが出ない（開発者ツールのデバイスモード）
- [ ] コンソールにエラーが出ていない

#### 2. OTP開始

- [ ] ドメイン外のメールを入れると送信ボタンが押せない
- [ ] `+` 付きのメールを入れると送信ボタンが押せない
- [ ] 運営者本人の大学メールで「6桁コードを送る」が成功する
- [ ] **実際にメールが届く**（件名・本文にコード以外の情報が無いこと）
- [ ] コードを入れてログインできる
- [ ] リロードしてもログイン状態が復元される

#### 3. 同意（D050）

- [ ] 初回ログインで「はじめる前に」が**権限選択より先に**出る
- [ ] 同意しないと先へ進めない
- [ ] 同意すると「利用方法を選ぶ」へ進む

#### 4. 新入生パスポート

- [ ] 「新入生として登録する」→「新入生ホーム」
- [ ] 興味パスポートを最後まで登録できる
- [ ] リロード後も保存内容が残る
- [ ] 受信停止に切り替えられる／戻せる

#### 5. 団体画面

- [ ] 「新しい団体を作る」で団体を作れる
- [ ] 作成直後は「審査待ち」で、オファー作成の導線が**出ない**
- [ ] SQL Editorで `admin_set_organization_status(..., 'verified', ...)` を実行すると
      ダッシュボードが有効になる
- [ ] 公式窓口を登録できる

#### 6. offer作成と privacy-safe preview

- [ ] オファーを作り「対象を確認する」で**区分**（例: 5〜9人）が出る。**生の人数が出ない**
- [ ] 対象が5人未満のとき送信できない
- [ ] 送信すると「<区分>の新入生へ配信しました」が出る

#### 7. 受信箱

- [ ] 新入生側の受信箱に届く
- [ ] 「届いた理由」が表示される
- [ ] 詳細を開くと既読になる
- [ ] 「行ってみたい」を選ぶと**公式窓口が開示される**
- [ ] 「今回は見送る」を選んでも、団体側に個人単位で伝わらない

#### 8. ファネル（10–5ルール）

- [ ] 配信10人未満のオファーはファネルが一切開示されない
- [ ] 10人以上でも、10未満のセルは「—」で抑制される
- [ ] 開示される値が5の倍数に丸められている。**パーセント表示が無い**

#### 9. メール通知

- [ ] 通知設定を「オファーごと」にして配信すると、**実際にメールが届く**
- [ ] 件名・本文に**団体名・イベント名・希望条件・返答**が含まれない
- [ ] 本文のリンクから受信箱（通知設定）へ着地する
- [ ] 「通知しない」にして再配信すると届かない
- [ ] `email_outbox_health()` の `failed_count` が0

#### 10. エラー監視

- [ ] `platform_health()` の全列を確認し、異常が無い
      （`outbox_failed` = 0、`outbox_stuck_sending` = 0、`quota_over_limit` = 0）
- [ ] `admin_list_audit(50)` に、上記の運営操作が記録されている
- [ ] ブラウザのコンソールに、想定外のエラーが出ていない

#### 11. 後片付け

- [ ] 検証用の団体を `suspended` にするか削除する
- [ ] 検証用の新入生アカウントを画面から削除する
- [ ] `admin_delete_auth_identity` で auth identity を消す（`docs/operations.md` §9）
- [ ] `platform_health()` を最後にもう一度見る

#### 問題があったとき

**即座に封じ込める。**

1. 配信に関わる問題 → 緊急停止（`docs/operations.md` §5）
2. コードの問題 → revert PR を `main` へ
3. 公開そのものを止める → Settings → Pages → Source を「None」へ

**履歴を破壊するrollbackは行わない。**

## Rollback

- **履歴を破壊するrollbackは禁止**。revert PRまたは機能停止（kill switch）で対応する。
- GitHub Pagesは前のdeployへ戻せることを確認しておく。

## Verification record

### やったこと

| 対象 | 内容 |
|---|---|
| `.github/workflows/deploy-pages.yml` | build へ `VITE_SUPABASE_*`（Actions **variables**）を渡し、直後に「バンドルへ入っているか」を検証するステップを足した。**値そのものはログへ出さない** |
| `docs/release_notes_v1.0.md`（新規） | できること / 守っていること（実装との対応表）/ 既知の制限 / 運用の入口 / rollback |
| 本ファイル §公開後smoke test | 11節・約60項目。**実在する学生を巻き込まない**手順にした |
| `README.md` | 「現在地」と「公開（GitHub Pages）」をPhase 2の実態へ。**必要なActions variablesを明記** |
| `docs/launch_plan.md` §6 | 完了条件の現状を記録 |

### 公開ビルドの検証（実測・2026-08-27・ローカル）

`src/lib/supabaseClient.ts` は `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` の
どちらかが空だと `null` を返し、`AppRoot` が「接続設定が必要です」を表示する。
**設定なしで `main` へmergeすると、いま動いている公開デモが案内画面に置き換わる。**

| 条件 | `dist/assets` の中身 | 検証ステップ |
|---|---|---|
| env 無しで build | 接続先が0件 | **落ちる**（期待どおり） |
| env ありで build | URL・key が各1件 | **通る**（期待どおり） |

検証ステップが落ちると `deploy` job は実行されないため、**すでに公開されている
ページはそのまま残る**。壊れたものを公開するより古いものを残すほうがよい。

### 前提条件の現状

| 条件 | 状態 |
|---|---|
| Task 010・011・013〜017 が `develop` へmerge済み | **満たす**（008〜017 + 019） |
| P0/P1 の既知不具合ゼロ | **満たす**（`docs/launch_plan.md` §7.1 に P0/P1 無し） |
| 未解決の認証・RLS・privacy blocker ゼロ | **満たす**（各タスクの独立レビューでBlocker 0） |
| 全CI green | **満たす**（quality / db-tests / e2e / audit） |
| staging E2E green | **未実施**（H1・H9。人間の操作が要る） |
| migration・rollback 確認済み | **ローカルのみ**。hostedでの適用・切り戻しは未実施（H1） |
| secret 漏洩なし | **満たす**（`VITE_*` 以外をビルドへ入れていないことを実測） |
| 合成データ以外がcommitされていない | **満たす**（テストデータは `demo-*@stu.kobe-u.ac.jp` の合成のみ） |
| privacy / terms の draft があり要確認箇所が明示されている | **満たす**（`docs/legal/`・【要確認】） |

### release PR を **draft のまま** にしている理由

`docs/launch_plan.md` §7 の **H6（公開用Supabaseプロジェクト）・H7（Actions variables）・
H8（Auth Site URL）が未了**です。この3つはSupabaseアカウントとGitHubリポジトリ設定への
アクセスが要るため、**実装側からは実行できません**。

H6〜H8 が揃う前に `main` へmergeすると:

1. deploy-pages の検証ステップが落ちてdeployされない（公開デモは残る）
2. 仮に検証を外して公開すると、接続先が無いため案内画面になる
3. 接続先だけ設定してAuth Site URL（H8）が未設定だと、OTPのリンク先が壊れる

### 残る課題

- **hosted staging の通し確認が未実施**（H1・H9）。smoke testの手順は書いたが、
  実行しての確認はできていない
- `v1.0.0` の tag / release は、`main` へのmerge後に作る（未作成）
- 公開後のエラー監視は「運営が `platform_health()` を毎日見る」運用に依存する
