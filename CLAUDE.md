@AGENTS.md

# CLAUDE.md

あなたは、スマートフォン向け新歓マッチングWebアプリ「CUE（仮）」の実装担当です。

## プロジェクトの目的

新入生が自分からサークルを探して応募する従来型新歓の心理的・情報的負担を下げます。新入生が受信を許可した興味分野と参加条件に基づき、部活・サークル側が新歓イベントの案内を届けられる体験を作ります。

## 最重要ルール

1. GitHub上の仕様書を唯一の正本として扱う。
2. 個別タスクに書かれた範囲だけを実装する。
3. 仕様にない要件を推測して追加しない。
4. 作業前に変更予定ファイルと実装方針を提示する。
5. 文書間の矛盾または受入条件の不足を見つけたら、編集前に質問する。
6. 実在する学生のデータを使わない。
7. 無関係なファイル、依存関係、設定を変更しない。
8. 実装後に利用可能なlint、型チェック、テスト、buildを実行する。
9. 完了時に変更内容、検証結果、残るリスクを日本語で報告する。

## 作業開始時に読むもの

1. `README.md`
2. `docs/decisions.md`
3. `docs/product_spec.md`
4. `docs/matching_and_safety.md`
5. `docs/auth_and_authorization.md`（Phase 2の認証・権限の正本）
6. 指定された `tasks/NNN-*.md`

タスクに明記されていない資料を無制限に読み込まず、必要な仕様だけを参照してください。

## Git運用

- ブランチ名: `feat/NNN-short-description`、`fix/NNN-short-description`
- 1タスク・1ブランチ・1PR
- `main`へ直接pushしない
- コミットは意味のまとまりごとに分ける
- force push、履歴書き換え、破壊的操作を行わない
- デプロイ、外部サービス作成、課金、公開設定変更は明示的な指示なしに行わない

## 技術構成

### Phase 1（2026-08-22デモ）で固定した技術

- Vite
- React
- TypeScript
- 独自CSS（大規模UIライブラリは追加しない）
- localStorage（デモ実装の保存先。Task 009でサーバーデータへ移行する）
- Vitest
- GitHub Actions / GitHub Pages

### Phase 2（Task 008〜011）で追加する技術

- Supabase Auth（メールOTP。パスワードとMagic Linkは使わない）
- Supabase PostgreSQL + RLS（認可はSECURITY DEFINER RPCとRLSで完結させる）
- `@supabase/supabase-js`
- Supabase CLI（ローカルスタック・migration・pgTAPテスト）
- 通知はSupabase Edge Functions + Resendを候補とする（Task 010で導入判断）

アプリ本体とSupabase構成（`app/supabase/`）は `app/` 配下に置きます。ルーティングライブラリ、状態管理ライブラリ、上記以外のバックエンド・認証サービスは追加しません。Phase 2の詳細は `docs/auth_and_authorization.md` を正本とします。

### Phase 2のブランチ運用

- `main`と公開デモ（GitHub Pages）は凍結する。Task 008〜011を`main`へマージしない
- 長期統合ブランチは`develop`。PRのbaseは`develop`とする
- Supabase secret key・service-role key・DBパスワード・アクセストークンをリポジトリ・CI・`VITE_*`へ置かない

## UI要件

- mobile first
- 基準表示幅は概ね390px
- 主要タップ領域は十分な大きさを確保する
- ローディング、空状態、エラー状態を用意する
- オファーには「届いた理由」を表示する
- 回答は「行ってみたい」「あとで考える」「今回は見送る」を基本とする
- 学生がいつでも受信条件を変更・停止できるようにする

## 禁止事項

- 氏名、顔写真、性別、国籍、学籍番号による団体側の学生検索
- 団体による無制限の一斉送信
- 学生の同意前の連絡先開示
- 生成AIによる人格評価や参加可否の自動判定
- APIキーや認証情報のハードコード
- 指示されていないライブラリへの置換

## 完了報告テンプレート

```text
実装概要:

変更ファイル:

受入条件への対応:

実行した検証:

残る課題・リスク:
```
