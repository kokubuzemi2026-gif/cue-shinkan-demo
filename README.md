# CUE（仮）

> 新歓は、探すから届くへ。

CUE は、大学の新入生が興味や参加条件を登録すると、相性の合う部活・サークルから新歓イベントの案内が届く、スマートフォン向けWebアプリです。

## 解決する問題

既存の新歓では、新入生がサークルを探し、比較し、自分から連絡・応募する必要があります。興味はあっても、知らない集団に最初の連絡を送る心理的負担や、情報収集の手間によって動けない人がいます。一方、団体側も、ブース・SNS・知人経由で接点を持てる新入生にしか情報を届けにくいという問題を抱えます。

CUE は、新入生が事前に登録した「興味パスポート」をもとに団体側が対象条件を指定し、プラットフォームが適合する新入生へ案内を届けます。団体に学生個人の一覧を公開せず、許可制・匿名・回数制限付きで運用することで、「誘われる気軽さ」と「勧誘されすぎない安心」を両立させます。

## プロダクトの核

1. 新入生が興味、活動スタイル、曜日、予算などを登録する
2. 団体が新歓イベントと「どんな人に来てほしいか」を登録する
3. システムが適合度を計算し、条件を満たす新入生に案内を届ける
4. 新入生は「行ってみたい」「あとで考える」「今回は見送る」をワンタップで選ぶ
5. 「行ってみたい」を選んだ後にだけ、次の連絡・参加導線へ進む

## MVPで見せる体験

### 新入生側

- 興味パスポートの登録
- オファー受信箱
- 「なぜ届いたか」が分かるマッチ理由
- 「行ってみたい／あとで考える／見送る」の低圧な返答
- オファー上限、カテゴリ別受信、停止、通報

### 団体側

- 団体プロフィール
- 新歓イベント・オファー作成
- 対象条件の設定
- マッチ対象人数の事前確認
- オファー送信
- 閲覧・関心・参加予定の簡易ファネル

## 開発原則

- GitHub上の仕様書を唯一の正本とする
- 1タスク・1ブランチ・1PRを原則とする
- 実在する学生の個人情報をテストデータに使わない
- 仕様と実装を分離し、未決事項をAIに推測させない
- 機能数より、学生側と団体側がつながる一連のデモを優先する
- 初期デモでは安定性と説明可能性を優先し、ブラックボックスAIを必須にしない

## ドキュメント

- `docs/product_spec.md`: プロダクト要件
- `docs/matching_and_safety.md`: マッチング・安全設計
- `docs/competition_strategy.md`: 競争で勝つための見せ方
- `docs/implementation_plan.md`: 8月22日までの技術構成と実装順序
- `docs/decisions.md`: 決定事項と保留事項
- `docs/agent_harness.md`: 自律開発ハーネス（実行モード・実行ループ・完了の定義・エスカレーション）
- `CLAUDE.md`: Claude Code の作業規則
- `AGENTS.md`: Codexなど開発エージェントの作業規則
- `tasks/_template.md`: 新規タスクの型
- `tasks/001-bootstrap.md`〜`007-ci-pages-qa.md`: 順番に実行する小タスク
- `prompts/autonomous_task.md`: 自律実行の指示例
- `prompts/task_prompt_template.md`: Claudeへ渡す個別タスクの型
- `prompts/002-execution-sequence.md`: Claude Codeへ貼る実行プロンプト集（Phase 1の記録）

## AIエージェントによる開発

このリポジトリは、AIエージェント（主にClaude Code）が短い指示から自走できるよう構成しています。詳細は `docs/agent_harness.md` を参照してください。

- 実行の型: Plan → Implement → Verify → Review → Repair
- 独立レビュー: `.claude/agents/`（architect / test-engineer / reviewer / security-reviewer）
- 自動ガード: `.claude/hooks/`
  - `guard_git.py`: `main` / `develop` への直接push、force push、`git reset --hard`、
    `git clean -f`、`git branch -D` を拒否する
  - `quality_gate.py`: `app/` に変更があるときの終了時に lint / unit test / build を実行する
- 権限設定: `.claude/settings.json` の `permissions.deny` が `.env`系ファイルと `.git/config` の
  Readツールでの読み取りを拒否します（`app/.env.example` は読めます）。
  Bash経由（`cat` など）は防げません。限界は `docs/agent_harness.md` §6・§9 を参照してください
- hookの実行にはpython3が必要です。変更したら `python3 .claude/hooks/test_hooks.py` を実行してください
- `.claude/settings.json` は共有設定です。個人設定は `.claude/settings.local.json`（git管理外）に書きます

## 現在地

Phase 1（2026年8月22日のメンバー持ち寄りデモ）は完了しました。Phase 2（アカウント・権限・サーバーデータ化・通知・運用）は`develop`で**実装が完了**しています（Task 008〜019）。閉鎖β v1.0の公開は、**人間にしかできない準備が終わってから**行います。

- 公開デモ（現在公開中・mainのlocalStorage版）: https://kokubuzemi2026-gif.github.io/cue-shinkan-demo/
- **`main`へのmergeを止めている理由**: 公開用Supabaseプロジェクト（H6）・Actions variables（H7）・Auth Site URL（H8）が未設定です。この状態でmergeすると、`.github/workflows/deploy-pages.yml` の検証ステップがdeployを止めます（いま動いている公開デモは残ります）。詳細は `docs/launch_plan.md` §7
- Phase 2の技術: Supabase Auth（メールOTP）+ PostgreSQL + RLS + Edge Functions
- ブランチ運用: `develop`をbaseにした1タスク1PR。`main`へのmergeは公開判断のときだけ
- 認証・権限の正本: `docs/auth_and_authorization.md`、決定は`docs/decisions.md`（D026〜D034）
- サーバーデータ（パスポート・オファー配信・受信箱・ファネル）の正本: `docs/server_data_model.md`（Task 009）
- hosted環境（staging）の構築・確認手順: `docs/runbook_supabase_hosted.md`

Phase 1の実装順序は `docs/implementation_plan.md`（凍結済みの歴史文書）と `tasks/000〜007` を参照してください。

## ローカル開発

前提: Node.js 22（Vite 8の要件 `^20.19.0 || >=22.12.0` を満たすLTS）

```bash
cd app
npm ci
npm run dev   # http://localhost:5173/cue-shinkan-demo/
```

品質チェックとビルド:

```bash
npm run lint
npm run test -- --run
npm run build
```

production preview（公開時と同じbase pathで確認）:

```bash
npm run preview   # http://localhost:4173/cue-shinkan-demo/
```

### Phase 2開発（Supabaseローカルスタック）

前提: 上記に加えてDocker（Docker Desktop等）

```bash
cd app
npm ci
npm run db:start        # 初回はイメージ取得で数分。API URLとpublishable keyが表示される
cp .env.example .env.local   # 表示されたURLとキーを転記する（この2値以外は置かない）
npm run dev             # http://localhost:5173/cue-shinkan-demo/
```

- OTPメールは実送信されず、Mailpit（ http://127.0.0.1:54324 ）で6桁コードを確認する
- テスト用メールは架空の `demo-*@stu.kobe-u.ac.jp` だけを使い、実在の学生メールを使わない
- DB・RLSテスト: `npm run db:test`（pgTAP）
- 生成型の更新: `npm run db:types`
- 停止: `npm run db:stop`
- `.env.local`が無い場合、アプリはクラッシュせず接続設定の案内画面を表示する（公開デモには影響しない）

## 公開（GitHub Pages）

- 公開URL: https://kokubuzemi2026-gif.github.io/cue-shinkan-demo/
- 公開元はGitHub Actions（Settings → Pages → Build and deployment → Source: GitHub Actions）
- `main`へのpushで自動公開。Actionsタブの「Deploy to GitHub Pages」からworkflow_dispatchで手動再公開できる

### 公開に必要なActions variables

Phase 2のアプリは、ビルド時に接続先が埋め込まれていないと「接続設定が必要です」の案内画面になります。**Settings → Secrets and variables → Actions → Variables** に次の2つを設定してください（`docs/launch_plan.md` §7 H7）。

| 変数 | 中身 |
|---|---|
| `VITE_SUPABASE_URL` | 公開用SupabaseプロジェクトのProject URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 同プロジェクトのpublishable key（`sb_publishable_...`） |

**どちらもブラウザへ出る値**なのでsecretではなくvariableで構いません。secret key・service-role key・DBパスワード・アクセストークンは**絶対に置かないでください**（D027）。

未設定のままmergeした場合、build後の「Verify build has Supabase config」がdeployを止めます。**すでに公開されているページはそのまま残ります**（壊れたものが公開されるより、古いものが残るほうがよいという判断です）。

### 公開URLで問題がある場合

1. Actionsタブで「Deploy to GitHub Pages」の最新runが成功しているか確認する
2. 「Verify build has Supabase config」で落ちている場合は、上記のvariablesを設定する
3. Settings → Pages のSourceが「GitHub Actions」になっているか確認する
4. ブラウザを再読み込みする（必要ならキャッシュを削除する）
5. 公開そのものを止めるときは `docs/runbook_operations.md` §7（公開停止の5段階）
