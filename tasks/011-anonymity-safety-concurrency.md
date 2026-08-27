# Task 011: 匿名性・安全・並行処理

## Goal（目的）

団体が「対象人数のpreviewを少しずつ変えて特定の新入生の希望条件を推測する」ことと、
「極端に少人数へ配信して受信者を特定する」ことを、DB側で成立しなくする。
あわせて、複数団体が同時に配信しても新入生の週間受信上限が破れないようにし、
団体向けファネルから個人の拒否情報が推測できないようにする。

これは実在する新入生を受け入れる前に満たすべき匿名性の下限であり、
`docs/launch_plan.md` §4 の確定仕様に従う。

## Source of truth（正本）

- `docs/launch_plan.md`: §4（本タスクの確定仕様）
- `docs/decisions.md`: D007（個人一覧非公開）、D021（週枠のローリング7日）、D022（ファネル導出）、
  D023（snapshot固定・再送禁止）、D029（PIIサーフェス）、D032（Task 009のサーバー設計）
- `docs/matching_and_safety.md`: §5（オファー量の制御）、§7（個人特定リスク）、§8（実装上の安全要件）
- `docs/server_data_model.md`: §4（RPC一覧）、§5（RLS・grant）
- `docs/auth_and_authorization.md`: §11（Task 009へ引き継ぐ契約。新テーブルにも適用する）

## In scope（変更してよい範囲）

- `app/supabase/migrations/20260827*_0011_*.sql`（新規）
- `app/supabase/tests/17_*.sql` 〜 `22_*.sql`（新規）
- `app/src/serverdata/offerApi.ts`（区分preview・ファネル抑制への対応）
- `app/src/features/club/funnel.ts` / `funnel.test.ts`（抑制・丸めの表示モデル）
- `app/src/features/club/audienceBand.ts`（新規。区分の表示文言）
- `app/src/org/OrgOffersPanel.tsx` / `app/src/styles/club.css`（区分・抑制の表示）
- `app/src/lib/database.types.ts`（生成型の更新）
- `app/e2e/task011-anonymity.spec.ts`（新規）
- `docs/decisions.md`（D036〜D039の追記）、`docs/server_data_model.md`（§10の追記）、
  `docs/launch_plan.md`（進捗）
- `tasks/011-anonymity-safety-concurrency.md`（本ファイル）

## Out of scope（変更してはいけない範囲）

- メール通知（Task 010）
- 団体のverified化・停止・kill switchの運営経路（Task 013）
- アカウント・データ削除（Task 014）
- プライバシーポリシー・利用規約（Task 015）
- `app/src/demo/**`（Phase 1デモ）、`main`・GitHub Pagesの公開物
- 既存migrationファイルの書き換え（変更は新規migrationで行う）

## Acceptance criteria（受入条件）

### 最小人数（k-匿名性）

- [ ] 配信可能人数が0人のとき、`send_offer` は `no_recipients` で拒否し、一切書き込まない
- [ ] 配信可能人数が1〜4人のとき、`send_offer` は `insufficient_audience` で拒否し、一切書き込まない
- [ ] 配信可能人数が5人以上のときだけ配信が成立する
- [ ] preview時点で5人以上でも、送信時点で4人以下へ減っていれば拒否される（サーバー側で再計算）
- [ ] 最小人数の判定はDB関数の中にあり、クライアントを改変しても迂回できない

### 対象人数preview

- [ ] `preview_offer_audience` が正確な人数を返さず、区分（`0` / `1-4` / `5-9` / `10-24` / `25-49` / `50+`）だけを返す
- [ ] 戻り値・エラーメッセージ・監査ログに生の人数が含まれない
- [ ] 同一条件のpreviewは24時間、同じ区分を返す（母集団が変わっても固定）
- [ ] 団体単位で、rolling 24時間あたり**異なる条件21件目**のpreviewが拒否される
- [ ] 同一条件の再preview は回数を消費しない
- [ ] 監査ログに学生の希望条件が残らず、条件はfingerprint（ハッシュ）だけが残る
- [ ] 条件を1項目ずつ変える差分攻撃で、個々の学生の予算・曜日が特定できない

### ファネル（10–5ルール）

- [ ] 配信人数10人未満のファネルは数値を返さず「集計に必要な人数未満」を返す
- [ ] 配信人数10人以上でも、各セルが10未満なら `suppressed` として数値を返さない
- [ ] 開示する数値は5人単位へ丸める
- [ ] パーセントを返さない
- [ ] 同じ日・同じofferには常に同じsnapshotを返す（日中に返答が増えても変わらない）
- [ ] UIが抑制を「0人」と表示しない
- [ ] 個人の拒否情報（skip した学生）を返すRPC・列・迂回経路が存在しない

### 週間受信上限（並行処理）

- [ ] quotaが専用テーブルで永続化される
- [ ] 別々の団体からの**並行**`send_offer` でも、学生の週間上限を超えて配信されない
- [ ] 例外時に部分配信・quotaだけの消費が残らない
- [ ] 同一イベントの再試行で二重配信されない
- [ ] week境界（ローリング7日・下限exclusive・上限inclusive）とtimezone（`timestamptz` のUTC比較）が文書化されている

### 入力検証・DoS

- [ ] 過大な配列長・文字列長・巨大payloadが、マッチング計算より前に拒否される
- [ ] 配列内のNULL要素が拒否される
- [ ] 空配列が拒否される
- [ ] 重複要素が正規化され、配点操作に使えない
- [ ] 境界値（各上限のちょうど・+1）のテストがある

### 共通

- [ ] migrationがcleanな状態と既存状態の双方へ適用できる
- [ ] `npm run lint` / `npm run test -- --run` / `npm run build` がgreen
- [ ] pgTAP がgreen
- [ ] スマートフォン幅390pxで団体側の確認・ダッシュボードが破綻しない
- [ ] reviewer と security-reviewer の独立レビューでBlockerが残っていない

## Test plan（テスト計画）

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| k=5の強制・0人・境界(4/5) | pgTAP | `supabase/tests/17_min_audience_test.sql` |
| preview区分・生人数の非開示 | pgTAP | `supabase/tests/18_preview_band_test.sql` |
| preview 24時間固定・20回制限・fingerprint | pgTAP | `supabase/tests/19_preview_quota_test.sql` |
| 差分攻撃の再現と防止 | pgTAP | `supabase/tests/20_differential_attack_test.sql` |
| ファネル10–5・丸め・日次snapshot | pgTAP | `supabase/tests/21_funnel_suppression_test.sql` |
| 並行配信でのquota原子性 | pgTAP（2セッション実接続） | `supabase/tests/22_concurrent_quota_test.sql` |
| 入力検証・DoS境界 | pgTAP | `supabase/tests/17_min_audience_test.sql` 内の検証節 |
| 区分・抑制の表示モデル | unit test | `src/features/club/audienceBand.test.ts` / `funnel.test.ts` |
| 抑制を0人と表示しない | unit test + E2E | 同上 / `e2e/task011-anonymity.spec.ts` |
| 390px表示 | E2E（390×844） | `e2e/task011-anonymity.spec.ts` |

## Rollback（切り戻し）

- コード: 本PRのrevertで戻る。
- DB: 新規migrationの逆順drop（policy → function → table）。Task 009までの関数は
  `create or replace` ではなく **drop→create** で置き換えるため、切り戻しには
  0009の該当関数定義を再適用する必要がある。手順を `docs/runbook_supabase_hosted.md` §8へ追記する。
- 保存データ: 既存の配信・受信者・既読・返答は変更しない（新規テーブルの追加のみ）。
  ファネルsnapshotとpreview監査は再生成可能な派生データで、削除しても正本を失わない。

## Verification record（検証記録）

実装後に記入する。

- 実行モード: Deep（`app/supabase/**`・匿名性・並行処理・PIIに触れるため）
- ブランチ / commit:
- lint:
- unit test:
- build:
- pgTAP:
- E2E:
- 手動QA（390px）:
- 独立レビュー（reviewer / security-reviewer）の結論と対応:
- 残るリスク・未実施事項:
