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
- `.github/workflows/`（必要な場合のみ）
- `tasks/018-release-v1.md`

## Out of scope

- 新機能の追加
- 実データの投入

## 前提条件（すべて満たすまでrelease PRを作らない）

- [ ] Task 010・011・013〜017が`develop`へmerge済み
- [ ] P0/P1の既知不具合ゼロ
- [ ] 未解決の認証・RLS・privacy blockerゼロ
- [ ] 全CI green（quality / db-tests / e2e）
- [ ] staging E2E green
- [ ] migration・rollback確認済み
- [ ] secret漏洩なし
- [ ] 合成データ以外がcommitされていない
- [ ] privacy / termsのdraftがあり、要確認箇所が明示されている

## Acceptance criteria

- [ ] release notesがある（変更点・既知の制限・運用上の注意）
- [ ] 公開後smoke testの手順がある
- [ ] rollback手順がある（**履歴を破壊しない**方法に限る）
- [ ] `develop` → `main` のrelease PRに独立レビューとセキュリティレビューを実施した
- [ ] main反映後のdeployが完了している
- [ ] smoke test: トップページ / OTP開始 / ロール別ログイン / 新入生パスポート /
      団体画面 / 受信箱 / offer作成 / privacy-safe preview / メール通知 / エラー監視
- [ ] `v1.0.0` のrelease / tagがある
- [ ] `docs/launch_plan.md` が完了になっている

## Rollback

- **履歴を破壊するrollbackは禁止**。revert PRまたは機能停止（kill switch）で対応する。
- GitHub Pagesは前のdeployへ戻せることを確認しておく。

## Verification record

実装後に記入する。
