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
- `CLAUDE.md`: Claude Code の作業規則
- `AGENTS.md`: Codexなど開発エージェントの作業規則
- `tasks/001-bootstrap.md`〜`007-ci-pages-qa.md`: 順番に実行する小タスク
- `prompts/task_prompt_template.md`: Claudeへ渡す個別タスクの型
- `prompts/002-execution-sequence.md`: Claude Codeへ貼る実行プロンプト集

## 現在地

2026年8月22日（土）のメンバー持ち寄りデモへ向けた実装フェーズです。

- 技術: Vite + React + TypeScript
- データ: 架空データ + localStorage
- 公開: GitHub Pages
- テスト: マッチングロジックのunit test、lint、build
- 方針: 認証・DB・本番通知は作らず、学生側と団体側が連動する一連のデモを完成させる

実装順序は `docs/implementation_plan.md` と `tasks/` を参照してください。

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

## 公開（GitHub Pages）

- 公開URL: https://kokubuzemi2026-gif.github.io/cue-shinkan-demo/
- 公開元はGitHub Actions（Settings → Pages → Build and deployment → Source: GitHub Actions）
- `main`へのpushで自動公開。Actionsタブの「Deploy to GitHub Pages」からworkflow_dispatchで手動再公開できる
- デモ状態はブラウザのlocalStorageへ保存される。ヘッダーの「デモ用架空データ」バッジから、いつでも初期状態へ戻せる
- 表示されるのはすべて架空データで、実在する学生の情報を含まない

公開URLで問題がある場合の確認手順:

1. Actionsタブで「Deploy to GitHub Pages」の最新runが成功しているか確認する
2. Settings → Pages のSourceが「GitHub Actions」になっているか確認する
3. ブラウザを再読み込みする（必要ならキャッシュを削除する）
4. 表示が崩れた状態が残る場合は「デモ用架空データ」バッジからデモをリセットする
