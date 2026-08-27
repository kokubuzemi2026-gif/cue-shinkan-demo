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
- `docs/legal/` は触らない（Task 015の正本）

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
- [ ] main反映後のdeployが完了している ← **未実施**（H6〜H8・H11が未了）
- [ ] smoke test: トップページ / OTP開始 / ロール別ログイン / 新入生パスポート /
      団体画面 / 受信箱 / offer作成 / privacy-safe preview / メール通知 / エラー監視
      ← **手順は用意済み・実行は公開後**
- [ ] `v1.0.0` のrelease / tagがある ← **未作成**（main反映後に作る）
- [ ] `docs/launch_plan.md` が完了になっている ← **H1・H6〜H11が未了**

## 公開後smoke test

`main` へmergeし、Pagesのdeployが成功したあとに実行する。

> **この手順は2つに分かれます。** 独立レビューで、当初の手順が
> **「実在する学生を巻き込まない」と宣言しながら、守ると実行できない**
> ことが判明したため分割しました。
>
> - **A（production）**: 運営者1人で完結する。公開URLで必ず行う
> - **B（staging）**: 合成アカウントが5〜10人要る。**productionでは行わない**
>
> 配信は対象5人未満だと `insufficient_audience` で拒否され（D036）、
> ファネルは配信10人未満だと一切開示されません（D037）。
> `+` 付きエイリアスはドメイン検査で弾かれる（`^[^@+\s]+@stu\.kobe-u\.ac\.jp$`）ため、
> 1メールボックス＝1アカウントです。**productionで配信まで見ようとすると、
> 実在の新入生を集めるしかなくなります。**

---

## A. production で行う（所要 15〜20分）

**使うのは運営者本人が管理する大学メールだけ。**

### A0. 事前

- [ ] Actionsタブで「Deploy to GitHub Pages」の最新runが成功している
- [ ] 「Verify build has Supabase config」が成功している（接続設定が入っている）
- [ ] `platform_health()` を service_role で実行し、`delivery_paused` が `false`

### A1. トップページ

- [ ] 公開URLが開く。**「接続設定が必要です」ではない**
- [ ] 「大学メールでログイン」の見出しが出る
- [ ] 幅390pxで横スクロールが出ない（開発者ツールのデバイスモード）
- [ ] コンソールにエラーが出ていない

### A2. OTP開始

- [ ] ドメイン外のメールを入れると送信ボタンが押せない
- [ ] `+` 付きのメールを入れると送信ボタンが押せない
- [ ] 運営者本人の大学メールで「6桁コードを送る」が成功する
- [ ] **実際にメールが届く**（件名・本文にコード以外の情報が無いこと）
- [ ] コードを入れてログインできる
- [ ] リロードしてもログイン状態が復元される

### A3. 同意（D050）

- [ ] 初回ログインで「はじめる前に」が**権限選択より先に**出る
- [ ] 同意しないと先へ進めない
- [ ] 同意すると「利用方法を選ぶ」へ進む

### A4. 新入生パスポート

- [ ] 「新入生として登録する」→「新入生ホーム」
- [ ] 興味パスポートを最後まで登録できる
- [ ] リロード後も保存内容が残る
- [ ] 受信停止に切り替えられる／戻せる
- [ ] 通知設定の3択（オファーごと／1日1回／通知しない）が保存される

### A5. 団体画面（**団体を作ると後片付けができなくなる。A6を読んでから判断する**）

- [ ] 「新しい団体を作る」で団体を作れる
- [ ] 作成直後は「審査待ち」で、オファー作成の導線が**出ない**
- [ ] SQL Editorで `admin_set_organization_status(..., 'verified', ...)` を実行すると
      ダッシュボードが有効になる
- [ ] 公式窓口を登録できる
- [ ] オファーを作り「対象を確認する」で**区分**が出る。**生の人数が出ない**
      （対象0人なら「0」。ここまでで privacy-safe preview は確認できる）
- [ ] 対象が5人未満のとき送信できない（`insufficient_audience`）

### A6. エラー監視と後片付け

- [ ] `platform_health()` の全列を確認（`outbox_failed` = 0、
      `outbox_stuck_sending` = 0、`quota_over_limit` = 0）
- [ ] `admin_list_audit(50)` に、上記の運営操作が記録されている
- [ ] ブラウザのコンソールに想定外のエラーが出ていない
- [ ] 新入生としてのデータを画面から削除する（パスポート → アカウント）
- [ ] 団体を作った場合は `admin_set_organization_status(..., 'suspended', ...)` にする

> **団体を作ると、その大学メールの auth identity は削除できません。**
> `admin_delete_auth_identity` は `organization_memberships` が残っていると
> `account_data_remains` で拒否し（0014）、単独ownerの所属は
> `leave_organization`（`last_owner` で拒否）でも `delete_my_account`
> （代表者不在を防ぐため残す・D049）でも外せません。
> **団体の削除・担当者のrole変更は未実装**（`docs/launch_plan.md` §7.1 D1・D2）。
>
> A5を行うなら、**運営者が自分のアドレスで行い、identityが残ることを受け入れる**か、
> **A5をstagingへ回す**かのどちらかを先に決めてください。
> 「あとで消す」経路はありません。

- [ ] 団体を作っていない場合のみ: `admin_delete_auth_identity` で
      auth identity を消す（`docs/operations.md` §9）
- [ ] `platform_health()` を最後にもう一度見る

---

## B. staging で行う（H1・H9。合成アカウントが要る）

**実在する学生を使わない。** 合成の大学メールアドレスを5〜10人分用意する。
productionでは行わない。

### B1. 準備

- [ ] 合成アカウントを**10人以上**作り、同じカテゴリで興味パスポートを登録する
      （ファネルの開示に配信10人以上が要るため）
- [ ] 団体を1つ作り `verified` にする

### B2. 配信と privacy-safe preview

- [ ] 「対象を確認する」で**区分**（例: 10〜24人）が出る。**生の人数が出ない**
- [ ] 送信すると「〈区分〉の新入生へ配信しました」が出る
- [ ] 同じ条件で24時間以内に再度previewしても条件数を消費しない

### B3. 受信箱

- [ ] 新入生側の受信箱に届く
- [ ] 「届いた理由」が表示される
- [ ] 詳細を開くと既読になる
- [ ] 「行ってみたい」を選ぶと**公式窓口が開示される**
- [ ] 「今回は見送る」を選んでも、団体側に個人単位で伝わらない

### B4. ファネル（10–5ルール）

- [ ] 配信10人未満のオファーはファネルが一切開示されない
- [ ] 10人以上でも、10未満のセルは「—」で抑制される
- [ ] 開示される値が5の倍数に丸められている。**パーセント表示が無い**

### B5. メール通知

- [ ] 通知設定を「オファーごと」にして配信すると、**実際にメールが届く**
- [ ] 件名・本文に**団体名・イベント名・希望条件・返答**が含まれない
- [ ] 本文のリンクから受信箱（通知設定）へ着地する
- [ ] 「1日1回のまとめ」で、翌朝に1通だけ届く
- [ ] 「通知しない」にして再配信すると届かない
- [ ] `email_outbox_health()` の `failed_count` が0
- [ ] 送信ログに宛先・本文・希望条件が出ていない（`docs/runbook_operations.md` §9）

### B6. 後片付け

- [ ] 合成アカウントを削除する
- [ ] 団体は `suspended` にする（**削除は未実装**）
- [ ] `admin_delete_auth_identity` で、団体に所属していない identity を消す
- [ ] `platform_health()` を最後にもう一度見る

---

## 問題があったとき

**即座に封じ込める。**

1. 配信に関わる問題 → 緊急停止（`docs/operations.md` §5）
2. コードの問題 → revert PR を `main` へ
3. 公開そのものを止める → `docs/runbook_operations.md` §7（公開停止の5段階）

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

### `develop → main` の release PR をまだ作っていない理由

**このPR（Task 018）は base=`develop` の通常タスクPRで、release PRではありません。**
release PR（`develop → main`）は、次が揃ってから新規に作ります。

`docs/launch_plan.md` §7 の **H6（公開用Supabaseプロジェクト）・H7（Actions variables）・
H8（Auth Site URL）・H11（Auth Attack Protection）が未了**です。
いずれもSupabaseアカウントとGitHubリポジトリ設定へのアクセスが要るため、
**実装側からは実行できません**（Actions variables APIはこの環境のproxyが403で拒否し、
Supabaseの資格情報もこの環境にはありません）。

H6〜H8 が無いまま `main` へmergeすると:

1. deploy-pages の検証ステップが落ちてdeployされない
   （**いま公開されているPhase 1デモはそのまま残る**）
2. 仮に検証を外して公開すると、接続先が無いため案内画面になる
3. 接続先だけ設定してH8が未設定だと、OTPのリンク先が壊れる

H11 が無いまま公開すると、publishable keyは公開バンドルに必ず入るため、
誰でもAuth APIを直接呼べます（§7.1 B7・**P1**）。

### 独立レビュー2本の結論と対応

**どちらも承認不可（Blocker 各4件）。** 指摘はすべて再現して直した。
中核（buildへvariableを渡す／deploy前に成果物を検証する）の設計自体は、
両レビューとも「正しく、fail-closedも実測で確認できた」としている。

| 指摘 | 内容 | 対応 |
|---|---|---|
| **B4（security）** | **検証ステップが鍵の種類を見ておらず、`sb_secret_*` を貼るとそのまま世界公開される**。secret keyはRLSを迂回するため、公開時点で全学生のデータが誰からでも読み書き可能になり、revertでは戻せない。**自分でも再現した**（バンドルへ1件埋め込まれ、検証ステップは通過） | 鍵の種類を**許可リスト**（`sb_publishable_*`）で検査。旧形式のJWT鍵も拒否する（anonとservice_roleがどちらも `eyJ` 始まりで区別できない）。URLも Project URL の形式で検査。7ケースを実測 |
| **B2（security）** | **smoke test §11 の後片付けが完結しない**。団体を作ると `leave_organization` は `last_owner`、`delete_my_account` は所属を残す、`admin_delete_auth_identity` は `account_data_remains` で拒否。**運営者の大学メールが production に残り続ける**。レビュー側が実際に再現した | smoke testをA（production・運営者1人で完結）とB（staging・合成アカウントが要る）へ分割。A5に「団体を作ると identity を消せない」ことと、その先の選択肢を明記。「団体を削除する」（未実装）という指示を削除 |
| **B3（security）** | **§6後半〜§9 が、記載の制約下では実行不能**。配信は対象5人以上（D036）、ファネルは配信10人以上（D037）、`+` エイリアスは不可。守ると実在の新入生を集めるしかない | 上記の分割で、配信・受信箱・ファネル・メール通知をBへ移した |
| **B1（両方）** | **未mergeのPR #21（Task 019）の内容を既存の状態として書いていた**。pgTAP件数・migration本数・D053・outbox剪定・「019がmerge済み」がすべて事実でない | PR #21 を先に develop へmergeし、本ブランチへ取り込んでから数字を実測し直した。`35 migration` → `18 migration` も訂正 |
| **B3（独立）/ N2（security）** | 「release PRはdraftのまま」が事実でない。PR #22 は draft ではなく base=`develop` で、そもそも release PR ではない。§6 は独立レビュー行を自己言及で「達成」にしていた | 「`develop → main` の release PR をまだ作っていない理由」へ書き換え。§6 の該当行を **未達** へ。§9 の手順を「release PR を新規に作る」へ |
| **B4（独立）** | §7.1 に severity 列が無く、「P0/P1ゼロ」の根拠が空。さらに **D030がTask 011へ委ねたCAPTCHA・レート制限が、011のscopeに入っておらず未実施**で、§7・§7.1 のどこにも無い | 27件へ重大度を付与（**P0:0 / P1:5**）。**H11**（Auth Attack Protection）と **§7.1 B7**（P1）を追加。§6 の根拠を分類へ置き換え |
| N-3（独立） | 検証ステップは `push: main` と `workflow_dispatch` でしか走らないため、**PRのCIでは一度も実行されない**。初回実行が本番deployになる | §9 に手順0「mergeの前に workflow_dispatch で1回空撃ちする」を追加 |
| N1（security） | PR本文の「ログにはコマンド本体しか出ない」は不正確。runnerは各stepの冒頭に `env:` マップを**値ごと**出力し、`vars.*` はマスクされない | workflowのコメントを訂正し、「このstepへsecretを足さないこと」を明記 |
| N-1（独立） | §7 本文が「build は `VITE_SUPABASE_*` を渡していない」と現在形のまま | 実装済みへ更新。mergeを止める理由（H6〜H8）は変わらない |
| N-5（独立） | README のドキュメント一覧が Phase 1 のまま | 設計・仕様／公開・運用／開発の進め方の3群へ再構成 |
| N7・Nit（security） | 既知リスク「25件」→ 実際27件。§2.2 の `C系`／§2.4 の `D系` が入れ替わっていた | 実測へ訂正（D1・D2 / C1・C2） |
| N-4（独立） | §9 の H9 説明が §7 の定義（Edge Functionのデプロイ）とずれ、OTP往復（H2）を混ぜていた | H1・H2・H9・H11 を分けて記載 |
| Nit（独立） | `grep` の値が `-` で始まるとオプション扱い／`dist/assets` 不在のメッセージが区別できない | `-e` を付与、不在専用のメッセージを追加 |

**持ち越し**: `app/index.html` の `<title>` が「デモ」のまま（公開前の判断項目）。
In scope 外のため触っていない。

### 残る課題

- **hosted staging の通し確認が未実施**（H1・H9）。smoke testの手順は書いたが、
  実行しての確認はできていない
- `v1.0.0` の tag / release は、`main` へのmerge後に作る（未作成）
- 公開後のエラー監視は「運営が `platform_health()` を毎日見る」運用に依存する
