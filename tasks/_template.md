# Task NNN: [タスク名]

新しいタスクファイルは、このテンプレートをコピーして作成する。`NNN` は未使用の連番。
エージェントはこのファイルだけを見て着手できる状態にする（会話の記憶を前提にしない）。

## Goal（目的）

誰の何が、この変更で改善されるかを2〜3文で書く。実装手段ではなく結果を書く。

## Source of truth（正本）

このタスクで参照する文書と該当箇所を列挙する。ここに書かれていない文書は原則読まない。

- `docs/decisions.md`: D0NN, D0NN
- `docs/product_spec.md`: §N
- `docs/matching_and_safety.md`: §N
- `docs/auth_and_authorization.md`: §N（Phase 2の認証・権限に触れる場合）

## In scope（変更してよい範囲）

変更・追加してよいファイルまたはディレクトリを列挙する。

- `app/src/...`
- `docs/...`

## Out of scope（変更してはいけない範囲）

- 触れてはいけないファイル
- このタスクでは実装しない機能（次のどのタスクで扱うかも書く）

## Acceptance criteria（受入条件）

画面または動作として確認できる形で書く。「きれいにする」「使いやすくする」は書かない。
1条件＝1行。実装後にチェックを埋める。

- [ ] 条件1（何を操作すると、何が表示・保存・拒否されるか）
- [ ] 空状態・ローディング状態・エラー状態の挙動
- [ ] スマートフォン幅390pxでの表示（横スクロールなし、タップ領域）
- [ ] 安全・プライバシー条件（PIIを出さない、利用者のコントロールを壊さない）
- [ ] `npm run lint` / `npm run test -- --run` / `npm run build` がgreen

## Test plan（テスト計画）

どの受入条件を、どの手段で検証するかを対応させる。

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| 条件1 | unit test | `app/src/.../*.test.ts` |
| 条件2 | pgTAP | `app/supabase/tests/NN_*.sql` |
| 条件3 | E2E | `app/e2e/*.spec.ts` |
| 条件4 | 手動QA（390px） | 手順を書く |

自動化しない条件がある場合は、理由と手動手順を書く。

## Rollback（切り戻し）

- 元に戻す方法（revert commitで足りるか、データ移行の巻き戻しが要るか）
- 保存データ（localStorage / DB）の互換性。前のバージョンで壊れないか
- 部分的に公開済みの場合の影響範囲

## Verification record（検証記録）

実装後にエージェントが埋める。実行していない検証は「未実施」と書く。合格扱いにしない。

- 実行モード: Fast / Standard / Deep
- ブランチ / commit:
- lint:
- unit test:
- build:
- pgTAP:
- E2E:
- 手動QA（390px）:
- 独立レビュー（reviewer / security-reviewer）の結論と対応:
- 残るリスク・未実施事項:
