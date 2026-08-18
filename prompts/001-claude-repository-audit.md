# Prompt 001: リポジトリ理解と実装前監査

このプロンプトは、初期ファイルをGitHubへ置き、Claude Codeでリポジトリを開いた後に使用する。

```text
このプロジェクトの実装を始める前に、リポジトリの仕様整合性を監査してください。

まず次のファイルを読んでください。

- README.md
- CLAUDE.md
- docs/decisions.md
- docs/product_spec.md
- docs/matching_and_safety.md
- docs/competition_strategy.md
- tasks/000-preflight.md

このタスクでは、ファイル編集、コード生成、依存関係追加、Git操作、デプロイを行わないでください。

次の順序で日本語で報告してください。

1. プロダクトを一文で要約
2. 学生側と団体側のコアフロー
3. 確定事項
4. ProposedまたはOpenの事項
5. 文書間の矛盾
6. 実装開始前に回答が必要な質問
7. 現時点で過剰に見える機能
8. 90秒デモを成立させる最小機能

仕様に書かれていない事実を補完しないでください。技術スタックもまだ決定しないでください。
```

