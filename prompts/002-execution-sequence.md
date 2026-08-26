# Claude Code 実行プロンプト集

> **これはPhase 1（Task 001〜007）の記録です。** 逐次承認を前提とした当時の運用を残しています。
> 現在の運用は自律実行型です（D032）。新しいタスクでは `prompts/autonomous_task.md` と
> `docs/agent_harness.md` を使ってください。下記の「計画を私が承認した後にだけ実装してください」は
> 現在の方針（`AGENTS.md` 3節）とは異なります。

各タスクは別セッションまたはコンテキストを整理した状態で実行する。タスク完了ごとにcommitし、次へ進む。

## 共通の開始方法

最初はPlan Modeで次を入力する。

```text
CLAUDE.mdと、指定するタスクファイルを読んでください。まずPlan Modeで、変更予定ファイル、実装方針、受入条件との対応、リスクを提示してください。まだ編集しないでください。計画を私が承認した後にだけ実装してください。
```

## Task 001

```text
tasks/001-bootstrap.mdを実装対象にします。README.md、CLAUDE.md、docs/decisions.md、docs/implementation_plan.md、tasks/001-bootstrap.mdを読み、タスクの範囲だけを実装してください。完了後、lint、test、buildを実行し、結果を日本語で報告してください。
```

## Task 002

```text
tasks/002-domain-and-matching.mdを実装対象にします。マッチングはUIやlocalStorageから独立したpure functionにしてください。仕様にない配点変更や属性追加はしないでください。主要ケースと境界値のテストまで完了してください。
```

## Task 003

```text
tasks/003-interest-passport.mdを実装対象にします。スマートフォン390pxを基準に、短時間で完了できるタップ中心の興味パスポートを作ってください。既存のドメイン型を再利用し、別の型を重複定義しないでください。
```

## Task 004

```text
tasks/004-student-offers.mdを実装対象にします。「なぜ届いたか」と3段階返答を最優先にしてください。マッチ結果をUI側で再計算・複製せず、既存のcalculateMatchを使ってください。返答はlocalStorage経由で永続化してください。
```

## Task 005

```text
tasks/005-club-offer-loop.mdを実装対象にします。団体がオファーを作る→学生に届く→学生が返答する→団体側のファネルが更新される、という一連の状態連動を完成させてください。団体側に学生個人の一覧を表示しないでください。
```

## Task 006

```text
tasks/006-demo-polish.mdを実装対象にします。新機能を追加せず、90秒デモの安定性、スマートフォン表示、空状態、アニメーション、リセットを仕上げてください。console errorと横スクロールを残さないでください。
```

## Task 007

```text
tasks/007-ci-pages-qa.mdを実装対象にします。GitHub Pagesの公式的なActions構成でapp/distを公開してください。リポジトリ名を確認してasset baseを設定し、lint、test、build、公開URLの確認手順まで報告してください。
```

## 各タスク後にCodexへ戻す情報

Claudeの次の出力をそのままCodexへ共有する。

- 変更ファイル一覧
- `git diff --stat`
- lint、test、build結果
- 残るリスク
- PRまたはcommit URL

