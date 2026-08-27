# Task 013: 団体確認・不正利用対策・kill switch

## Goal（目的）

運営者が、団体を確認（verified化）し、問題があれば停止でき、
誤配信・不正利用が起きたときに配信を止められる状態にする。
団体側から権限を越えた操作ができないことを、テストで保証する。

## Source of truth（正本）

- `docs/decisions.md`: D026（権限分離）、D029（PIIサーフェス）、D030（残余リスクはTask 011/013へ）、D036〜D039
- `docs/auth_and_authorization.md`: §4（権限モデル）、§7（RLS・grant方針）
- `docs/matching_and_safety.md`: §7（偽団体・危険な勧誘）、§9（受入条件）
- `docs/launch_plan.md`: §2.3（運営者の完成像）

## In scope

- `app/supabase/migrations/2026*_0013_*.sql`
- `app/supabase/tests/27_*.sql`〜`29_*.sql`（26はTask 010が使用済み）
- `app/src/org/` / `app/src/features/student/` / `app/src/student/`（停止状態の表示）
- `app/e2e/task013-org-controls.spec.ts`
- `docs/operations.md`（新規・運営操作の正本）、`docs/decisions.md`、`docs/launch_plan.md`
- `tasks/013-org-verification-and-killswitch.md`

## Out of scope

- 運営者向けの管理画面UI（本タスクでは安全なadmin経路とSQL手順まで。UIはスコープ外）
- メール通知（Task 010）、アカウント削除（Task 014）

## Acceptance criteria

- [x] 団体状態が `pending` / `verified` / `suspended` の3値で管理されている
- [x] `verified` 以外の団体はオファーを配信できない（既存の`org_not_verified`を維持）
- [x] 状態変更は service role または安全なadmin経路だけが行える。クライアント経路が存在しない
- [x] 団体を `suspended` にすると、その団体の新規配信が止まる
- [x] 個別のofferを停止でき、停止後は学生の受信箱に「募集終了」等が反映される
- [x] 全団体の配信を止める緊急停止（kill switch）があり、1操作で有効化・解除できる
- [x] kill switch有効中は `send_offer` が明確な理由で拒否される
- [x] 他団体への越権操作（状態変更・offer停止）ができないことのnegative testがある
- [x] admin権限をクライアント側の判定だけに依存させていない
- [x] 認証・配信・通知・権限変更の必要最小限の監査記録が残る（PIIを含まない）
- [x] 監査記録に学生の希望条件・メール・氏名が含まれない
- [x] pgTAP / lint / test / build がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| 状態遷移と配信可否・オファー停止 | pgTAP | `supabase/tests/27_org_status_test.sql` |
| kill switch | pgTAP | `supabase/tests/28_kill_switch_test.sql` |
| 越権操作の拒否・監査記録のPII | pgTAP | `supabase/tests/29_admin_boundary_test.sql` |
| 停止状態の画面表示・運営操作の反映 | Playwright | `e2e/task013-org-controls.spec.ts` |
| 受信行・キャンペーン行の`stopped`変換 | Vitest | `src/serverdata/serverData.test.ts` |

## Rollback

- 本PRのrevert + 追加オブジェクトのdrop。既存の配信データは変更しない。

## Verification record

実装日: 2026-08-27 / ブランチ: `feat/013-org-verification`

### 変更したもの

| ファイル | 内容 |
|---|---|
| `supabase/migrations/20260827120000_0013_admin_controls.sql` | `platform_controls`（単一行のkill switch）・`admin_audit_log`・`offer_deliveries.stopped_at/stopped_reason`・配信行のBEFORE INSERTトリガ |
| `supabase/migrations/20260827120002_0013_admin_rpcs.sql` | 運営RPC 4本（service_role専用）・`private.cancel_offer_mail`・`list_my_inbox`/`list_org_campaigns`へ`stopped`列追加・`respond_to_offer`の`offer_stopped` |
| `supabase/tests/27_〜29_*.sql` | 状態遷移・kill switch・越権/PIIの3ファイル（+68テスト） |
| `supabase/tests/16_org_funnel_pii_test.sql` | `list_org_campaigns`の戻り列allowlistへ`stopped`を追加 |
| `src/features/student/inbox.ts` / `serverdata/inboxApi.ts` / `serverdata/offerApi.ts` / `features/club/funnel.ts` | `stopped`をInboxItem・ServerCampaignへ伝搬 |
| `src/features/student/OfferCard.tsx` / `student/ServerOfferDetail.tsx` / `features/club/ClubDashboard.tsx` | 「募集終了」「停止中」の表示と返答導線の閉鎖 |
| `src/lib/database.types.ts` | `stopped`列と運営RPC 4本を追記 |
| `src/styles/inbox.css` / `club.css` | 停止表示のスタイル（色だけに依存させない） |
| `e2e/task013-org-controls.spec.ts` | 審査待ち→確認→配信→停止→緊急停止→解除の通し |
| `docs/operations.md`（新規）/ `decisions.md` D043〜D045 / `server_data_model.md` §11 / `runbook_supabase_hosted.md` §6.2・§8 | 正本の更新 |

### 実行した検証

| 検証 | 結果 |
|---|---|
| pgTAP（ローカルPostgres 16 + Supabase相当スキャフォールド） | 29ファイル **470テスト PASS**（Task 012時点の399から+71） |
| 並行配信テスト（`npm run db:test:concurrency`） | 8件 PASS（Task 013のトリガ追加後も不変） |
| oxlint / tsc / vitest / vite build | すべてgreen（ユニット346テスト） |
| E2E typecheck | green（実行はCIのローカルSupabaseスタック上） |

### mutation test（テストが実際に壊れを捕まえるか）

| 壊した箇所 | 落ちたテスト |
|---|---|
| トリガのkill switch判定を削除 | 28: 5件 |
| 停止済みofferへの返答拒否を無効化 | 27: 1件 |
| 停止時の公式窓口非開示を無効化 | 27: 2件 |
| 団体停止時のoffer一括停止を削除 | 27: 2件 |
| 運営RPCを`authenticated`へgrant | 29: 5件 |
| offer停止時のメール取り消しを削除 | 27: 2件 |
| 団体停止時のメール取り消しを削除 | 27: 1件 |

### 残る課題

- 運営画面UIは未実装（SQL Editorからの操作。`docs/operations.md`が手順の正本）
- 停止を団体へ能動的に通知する仕組みが無い（Task 017）
- `daily_digest`は取り消せない（D044に理由と影響を記録）
- 監査記録の保持期間・削除方針が未定（Task 017）
