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
| `supabase/migrations/20260827120000_0013_admin_controls.sql` | `platform_controls`（単一行のkill switch）・`admin_audit_log`・`offer_deliveries.stopped_at/stopped_reason`・配信行とpreviewキャッシュのBEFORE INSERTトリガ（ともに`ENABLE ALWAYS`） |
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
| pgTAP（ローカルPostgres 16 + Supabase相当スキャフォールド） | 29ファイル **477テスト PASS**（Task 012時点の399から+78） |
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
| 緊急停止中のpreview拒否を削除（L1） | 28: 3件 |
| `pending`でオファーを止めない（L2） | 27: 2件 |
| トリガを`ENABLE ALWAYS`から戻す（L3） | 28: 1件 |
| offer停止時のメール取り消しを削除 | 27: 2件 |
| 団体停止時のメール取り消しを削除 | 27: 1件 |

### 独立レビューの結論と対応

- **security-reviewer**: Blocker 0 / Critical・High・Medium 0。権限昇格・kill switch迂回・
  停止オファーからの窓口回収・監査記録からの個人特定・差分攻撃の復活・DoSを実ロールで
  実行し、すべて防がれることを確認。指摘は Low 3件。
- **Low 3件はいずれも自分で再現したうえで、文書化ではなく構造で直した**:
  - L1: 緊急停止がpreviewを止めない（停止中に区分`5-9`が返ることを再現）
    → previewキャッシュへの挿入トリガで、**新しい条件**の評価を止める。
      24時間以内に答えた同一条件は返す（既に団体が知っている値で、新しい情報を渡さない）
  - L2: `pending`へ戻しても配信中オファーが止まらない（停止後も返答でき、
    公式窓口`@repro`が開示され続けることを再現）
    → `verified`以外へ変える操作すべてで配信中オファーを止める
  - L3: トリガが既定の`ENABLE`（`session_replication_role='replica'`で不発になり得る）
    → 両トリガを`ENABLE ALWAYS`にする
- **reviewer**: （結果を追記する）

### CIで見つけて直したもの

- e2eの`getByText('審査待ち')`がstrict mode violation（状態チップと説明文の2要素に一致）。
  調査中に、`delivery_paused` / `offer_stopped` が `serverErrorMessage` の既知コードに無く、
  「通信環境を確認して…」という誤解を招く汎用文言になっていたことを発見して修正
- e2eの最終検査（console errorが無いこと）が失敗。意図的に拒否される要求について、
  ブラウザは`response`とは別に console へも「Failed to load resource」を出すため、
  「拒否されたこと」自体を失敗として数えていた → 拒否を許す区間をフラグで明示する
- e2eの「団体側にも停止が見える」が失敗。`OrgOffersPanel`が`ServerCampaign`→`CampaignView`を
  1項目ずつ書き写す形で`stopped`を落としていた。`CampaignView.stopped`をoptionalにしていた
  ためtscが検出できなかった → **必須**にして、書き忘れがコンパイルエラーになることを確認

### 残る課題

- 運営画面UIは未実装（SQL Editorからの操作。`docs/operations.md`が手順の正本）
- 停止を団体へ能動的に通知する仕組みが無い（Task 017）
- `daily_digest`は取り消せない（D044に理由と影響を記録）
- 監査記録の保持期間・削除方針が未定（Task 017）
