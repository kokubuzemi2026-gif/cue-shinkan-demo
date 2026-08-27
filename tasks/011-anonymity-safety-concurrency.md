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
- `app/src/features/club/funnel.ts`（`CampaignView.funnel`の型を拡張）
- `app/src/features/club/funnelDisclosure.ts` / `funnelDisclosure.test.ts`（新規。抑制・丸めの表示モデル）
- `app/src/features/club/audienceBand.ts` / `audienceBand.test.ts`（新規。区分の表示文言）
- `app/src/features/club/SendConfirm.tsx` / `ClubDashboard.tsx`（区分・抑制の表示）
- `app/src/serverdata/apiText.ts`（新しいエラーコードの定型文）
- `app/src/serverdata/serverData.test.ts`（変換テストの更新）
- `app/supabase/tests/14〜16`（契約変更に伴う既存テストの更新）
- `app/e2e/task009-server-data.spec.ts`（k=5・10-5ルールに合わせた更新）
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

- 実行モード: **Deep**（`app/supabase/**`・匿名性・並行処理・PIIに触れるため）
- ブランチ: `feat/011-anonymity-safety-concurrency`（`develop` の `f28d834` から作成）
- PR: [#12](https://github.com/kokubuzemi2026-gif/cue-shinkan-demo/pull/12)
- lint: `npm run lint`（oxlint）→ green（指摘0件）
- unit test: `npm run test -- --run` → **328件 / 26ファイル** すべてpass（develop比 +11件）
- build: `npm run build`（`tsc -b && vite build`）→ 成功
- pgTAP: **316件 / 22ファイル** すべてpass（develop比 +87件）。
  ローカルはDockerが無いため PostgreSQL 16 + Supabase相当スキャフォールド
  （`auth.users` / `auth.uid()` / anon・authenticated・service_role / pgcrypto / pgtap）へ
  全11migrationを順に適用して実行。CIの `db-tests`（本物のSupabaseスタック）でも green
- 並行テスト: `npm run db:test:concurrency` → 8件すべてpass（ローカル・CI とも）
- E2E: **ローカル未実施**（Dockerデーモンが無く `supabase start` を起動できない）。
  CIの `e2e` ジョブで green（task008 / task009 / task011 の4テスト）
- 手動QA（390px）: **未実施**（同上）。E2E内の `expectNoHorizontalScroll` で自動検証している
- hookテスト: `python3 .claude/hooks/test_hooks.py` → 201件pass（変更なし）
- CI: quality / db-tests / e2e すべて green（`b0e217d`）。
  db-testsのログで pgTAP `Files=22, Tests=316, Result: PASS`、
  並行テスト8件pass、生成型ドリフト検査の差分ゼロ（警告なし）を確認

### 実装中に見つけて直した問題

| 内容 | 検知した手段 | 対応 |
|---|---|---|
| 同一文のCTEは同じsnapshotを見るため、受信者を挿入した直後に同じ文で `window_count` を数えると常に挿入前の値になっていた | 並行テスト | 枠の観測値の更新を別の文へ分離 |
| `list_org_campaigns` のOUTパラメータ `delivery_id` が `on conflict` のカラム参照と衝突（`column reference is ambiguous`） | pgTAP | snapshot確定を `private.ensure_funnel_snapshots()` へ分離 |
| pgTAP 22 の dblink がSupabaseのローカルスタックで使えない（postgres が superuser ではない） | CI（db-tests） | 本物の並行実行を `scripts/concurrency_test.sh`（psql複数プロセス）へ移し、pgTAP 22は単一セッションで決定的に検証できる部分に限定 |
| E2Eの `execSql` が `update ... returning id` の戻り値にコマンドタグ（`UPDATE 1`）を混ぜていた | CI（e2e） | psqlへ `-q` を追加。今回はじめてorgIdをSQLへ埋め込んだことで露見した潜在不具合 |
| E2Eの母集団がspec間で混ざる（DBを共有して直列実行するため） | CI（e2e） | task011に専用カテゴリ（旅行・スポーツ・ボランティア）を割り当て |

### 並行テストの実効性（変異テスト）

「テストが通ること」ではなく「壊したら落ちること」を確認した。

| 変異 | 結果 |
|---|---|
| 枠の `FOR UPDATE` ループを外す | `scripts/concurrency_test.sh` が **3回とも失敗**（同時起動4件がすべて成立し、学生1人が4件受信＝上限1件を突破） |
| 週枠の再判定で上限を `now()` で閉じる | pgTAP 22 が失敗（後からcommitされた配信を取りこぼす） |

なお、第1フェーズ（Aが枠を確保している間にBが来る形）だけでは、枠の行に対する
`insert ... on conflict do nothing` の一意制約待ちが偶然の直列化を生むため、
`FOR UPDATE` を外しても検出できなかった。遅延を入れずに4団体を同時起動する
第2フェーズを足して、はじめて変異を検出できるようになった。

### 差分攻撃について確認したこと

`20_differential_attack_test.sql` で、攻撃が理論上成立する状況（費用以外の合計が60点＝
参加費の5点で配信可否が変わる学生を1人だけ混ぜた12人の母集団）を作り、次を確認した。

- 区分化により、標的1人が外れても区分は `10-24` のまま動かない
- 集団が保たれる範囲を8条件掃引しても、観測される区分は1種類だけ
- 条件数の制限（20条件/24時間）で掃引が打ち切られる
- 24時間固定により、標的が予算を変えても同一条件の再previewは古い区分を返す
- 3人へ絞り込んでも送信は `insufficient_audience` で拒否され、送信をoracleにできない

**正直な限界**: 集団全体が対象から外れる価格帯では区分が動く（`10-24` → `0`）。
これは「その条件では誰も該当しない」という集計情報であり、個人の予算上限を特定する
情報ではない。D036へ残余リスクとして記録し、テストでも明示している。

### 残るリスク・未実施事項

- **E2Eと390pxの手動QAがローカル未実施**（Dockerデーモンが無い）。CIで担保している。
- 枠のロックは対象学生数に比例した回数取得するため、母集団が非常に大きい場合は
  送信のレイテンシが伸びる（閉鎖βの規模では問題にならない。`docs/server_data_model.md` §9へ記録）。
- ~~`database.types.ts` は手書きで更新した~~ → CIの生成型ドリフト検査で
  **差分ゼロ**（警告なし）を確認済み。生成器の出力と一致している。
- 10-5ルールは公開手法を参考にしたものであり、**法令準拠を主張しない**（D037）。
  運営者による最終確認が必要。
- hosted stagingへの0011 migration適用は未実施（`docs/launch_plan.md` §7 H1）。
- 独立レビュー（reviewer / security-reviewer）の結論と対応: 後述のとおり実施し、追記する。
