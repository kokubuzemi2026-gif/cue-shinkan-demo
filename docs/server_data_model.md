# サーバーデータ設計（Task 009正本）

- Status: Accepted（2026-08-25実装。決定はdocs/decisions.md D032〜D034）
- 対象: Task 009（localStorageデモデータのサーバーデータ移行）以降のPhase 2データ層
- 実装: `app/supabase/migrations/20260825*_0009_*.sql`（DB正本）、`app/src/serverdata/`・`app/src/student/`・`app/src/org/`（クライアント）
- 前提: `docs/auth_and_authorization.md` §11「Task 009へ引き継ぐ契約」に全面的に従う

## 1. 移行の全体像

Phase 1デモがlocalStorageへ保存していた4種のデータを、認証済みユーザーのサーバーデータへ移行する。認証済みアプリのデータ正本はすべてSupabase（PostgreSQL + RLS + SECURITY DEFINER RPC）であり、localStorageに置く認証・アプリデータは`sb-*`（auth-jsのセッション）のみとする。

| 旧localStorage（cue-demo:*） | 内容 | 移行先 | 旧キーの扱い |
|---|---|---|---|
| `student-preference` | 興味パスポート | `public.student_passports`（1人1行） | 検証付きで一回限り取り込み後に削除（§7） |
| `offer-deliveries` | 配信イベント+snapshot | `private.offer_deliveries` + `private.offer_recipients` | 削除のみ（架空デモ団体のデータのため取り込まない） |
| `offer-reads` | 既読 | `private.offer_reads` | 同上 |
| `offer-responses` | 3段階返答 | `private.offer_responses` | 同上 |

Phase 1の`src/demo/DemoApp.tsx`（隔離済みデモ）と公開デモ（main・GitHub Pages）は変更しない。

## 2. スキーマ

| テーブル | スキーマ | 公開 | 概要 |
|---|---|---|---|
| `student_passports` | public | SELECTのみ（RLS: 自分の行だけ） | 興味パスポート。PII列なし。書込は`save_student_passport` RPCのみ |
| `offer_deliveries` | private | RPC経由のみ | 配信イベント。オファー内容+団体表示（名称・紹介・公式窓口）のsnapshotを固定保存（D023）。`unique(organization_id, event_fingerprint)`で同一イベント再送をDBレベルで拒否 |
| `offer_recipients` | private | RPC経由のみ | 受信者ごとのscore・理由・注意点snapshot。PK(delivery_id, user_id) |
| `offer_reads` | private | RPC経由のみ | 開封記録（初回時刻を保持）。受信者行への複合FKで「受信者本人以外の既読」を構造的に排除 |
| `offer_responses` | private | RPC経由のみ | 3段階返答。(配信,学生)ごと1行へ上書き。同じく複合FK |

- 学生の正本ID = `auth.uid()`（`student_accounts.user_id`へFK）、団体 = `organizations.id`へFK（§11契約1）。
- enum（`interest_category`・`purpose`・`activity_style`・`frequency`・`day_slot`・`experience_level`・`response_choice`）は`domain/types.ts`の定数配列と同値・同順でpublicに定義し、生成型へ含める。
- `organizations`へ公式窓口2列（`contact_label`・`contact_handle`）を追加（D033）。「行ってみたい」後にだけ学生へ開示する団体の公式アカウントで、個人の連絡先は置かない（matching_and_safety.md §6）。開示のゲートは`list_my_inbox`のサーバー側にあり、返答が`interested`以外の行では空文字を返す（クライアント表示だけの制御にしない）。
- 配列列はCHECKで要素数上限と重複禁止（`private.has_unique_elements`）を強制し、直接DML迂回でも配点操作（目的の重複登録など）ができない。

## 3. マッチングのサーバー正本

`private.match_passport()`が`domain/matching.ts`の`calculateMatch()`と**同一の判定表**を持つ（D028のメール判定と同じTS/SQL双実装パターン）。配点・65点閾値・理由/注意の文言・優先順・上限（理由3/注意2）・円の3桁区切り表記まで同一で、同一性は次の2テストが**同一ケース表（C01〜C16）**で検証する。

- TS: `app/src/domain/matchingParity.test.ts`
- SQL: `app/supabase/tests/12_matching_parity_test.sql`

同一イベント判定（`private.normalize_event_text` / `private.event_fingerprint`）も`domain/delivery.ts`と同一（NFKC→小文字化→空白除去。空白集合はJSの`\s`をエスケープ表記で明示しロケール非依存）。ただし小文字化はSQLの`lower()`とJSの`toLowerCase()`で一部のUnicode大文字（例: `İ` U+0130）の結果が異なる。認証済み導線の重複判定はサーバーのfingerprintだけを正本とするため実害はない。

## 4. RPC一覧（Task 009でクライアント公開はこの8本のみ）

| RPC | 権限条件 | 内容 |
|---|---|---|
| `save_student_passport(...)` | 学生（大学ユーザー+student_accounts行） | パスポートの作成・更新。重複除去（先頭出現順維持）+検証つきupsert |
| `update_organization_contact(org_id, new_label, new_handle)` | 対象団体のowner/admin | 公式窓口の更新（label≤50・handle≤100） |
| `preview_offer_audience(org_id, オファー15引数)` | owner/admin + verified団体 | 送信確認用。匿名件数（マッチ/週上限で除外/配信可）+重複判定+今週送信数のみを返す |
| `send_offer(org_id, オファー15引数)` | owner/admin + verified団体 | 配信正本の作成。団体行をFOR UPDATEで直列化し、週3枠（D021）・fingerprint再送禁止（D023）・受信者評価+snapshot挿入を単一トランザクションで実行。重複/週枠/配信0人では一切書き込まない。戻りは配信IDと匿名件数のみ |
| `list_my_inbox()` | 学生 | 自分の受信snapshot（オファー・団体表示・score・理由・注意・既読・返答）を配信の新しい順で返す |
| `mark_offer_read(delivery_id)` | 受信者本人 | 既読の記録（ON CONFLICT DO NOTHINGで初回時刻を保持する冪等操作） |
| `respond_to_offer(delivery_id, choice)` | 受信者本人 | 3段階返答のupsert（変更可） |
| `list_org_campaigns(org_id)` | 対象団体のメンバー | キャンペーン一覧+匿名ファネル（D022: 配信/閲覧/関心/参加意向。学生IDは返さない） |

- 週上限（D021）: `now − 7日 < delivered_at ≤ now`のローリングウィンドウ。学生の週上限（1〜5）と団体の週3キャンペーンの両方をsend時に適用する。
- ファネル（D022）: 独立保存せず受信者・既読・返答から導出。既読保存が無い返答も「閲覧」に数え、単調性を保つ。
- 全関数は作成直後にPUBLIC/anonのEXECUTEを剥奪し、公開8本だけを`authenticated`へgrant。内部ヘルパー（`is_current_student`・`evaluate_offer_audience`・`match_passport`等）はprivateスキーマでクライアント到達不能。
- 団体向けRPCの引数・戻り列に学生ID・メール・学生一覧は存在しない（D029。pgTAP 16でシグネチャを機械検査）。

## 5. RLS・grant

- deny by default。Task 009の新規オブジェクトだけをスキーマ修飾で明示revoke/grant（008と同じ方式）。
- `student_passports`: RLSポリシーは自分の行のSELECTのみ（`is_university_user()`必須）。grantはSELECTのみで、INSERT/UPDATE/DELETEのgrantを与えない（書込はRPC経由のみ）。
- private4テーブル: RLS有効・policyゼロ・grantゼロ（多層防御。アクセスはSECURITY DEFINER RPCのみ）。
- anonはすべてゼロ。検査は`app/supabase/tests/11_task009_grants_test.sql`（カタログ走査を含む）。

## 6. クライアント構成

| 層 | ファイル | 役割 |
|---|---|---|
| API | `src/serverdata/passportApi.ts` / `inboxApi.ts` / `offerApi.ts` / `apiText.ts` | RPC・RLS読取の薄い型付きラッパと、サーバー行⇄ドメイン型の変換。エラーは定型文へ変換し、生メッセージ・ID・メールを画面へ出さない |
| 学生UI | `src/student/StudentArea.tsx`（+ `ServerOfferDetail.tsx`） | ホーム（パスポートwizard/要約/停止・再開）と受信箱。既存のwizard・要約・カード部品（features/student）を再利用し、コンテナのみ新設 |
| 団体UI | `src/org/OrgOffersPanel.tsx` / `OrgContactForm.tsx` | ダッシュボード（匿名ファネル）→作成→確認（プレビューRPC）→送信の4画面と公式窓口編集。既存のClubDashboard・OfferComposer・SendConfirm部品を再利用 |
| 統合 | `src/shell/AuthenticatedShell.tsx` / `OrgHome.tsx` | 準備中プレースホルダーを実機能へ置換。wizard・オファー作成中は集中モードで切替UI・権限追加を隠す |

- 表示IDにauth UUIDを流通させない: パスポート・返答のクライアント内IDは固定の自己表示値（`me` / `あなた`）。
- 再取得中は取得済みコンテキストを保持し（useMyAccountと同じ方式）、失敗時はエラー表示+再試行ボタンを出す。返答の保存失敗では前の状態を保ち、再タップで再試行できる。
- 受信箱の表示・score・理由・注意は`list_my_inbox`のsnapshotのみを使い、クライアントで再計算しない（D023）。

## 7. 旧デモデータの一回限り移行（D034）

`src/student/demoMigration.ts`。認証済み学生コンテキストの初期化時に1回だけ実行する。

1. サーバーにパスポートが**ある** → 取り込まず`cue-demo:*`4キーを削除（移行済み/サーバー作成済み）。
2. サーバーに**なく**、`cue-demo:student-preference`が検証（schema+wizard必須条件）を通る → `save_student_passport`で保存し、**成功したときだけ**4キーを削除。失敗時はキーを残して次回再試行（データを失わない）。
3. 破損・改ざん・必須条件を満たさない値は取り込まずに削除（cleanup-only）。
4. 配信・既読・返答の3キーは常に取り込まず削除する（架空デモ団体に紐づく演出データのため）。

同じ処理を複数回実行しても重複・消失は起きない（成功後はキーが無くなるためno-op。upsertのため二重保存も安全）。検証は`src/student/demoMigration.test.ts`とE2E（task009 step 13）。

## 8. 検証

- 単体: Vitest（マッチング同値C01〜C16・serverdata変換・移行ロジック）
- DB: pgTAP `tests/11〜16`（権限サーフェス・マッチング同値・パスポートRLS・送信の権限/週枠/再送禁止/原子性・受信箱分離・ファネル/PII）
- E2E: `app/e2e/task009-server-data.spec.ts`（390×844。登録→パスポート→送信→受信→返答→ファネル→再ログイン→別context→デモ移行→REST/RPC越権プローブ→console error/失敗リクエスト/localStorageキー検査）
- hosted staging: `docs/runbook_supabase_hosted.md`の手順でmigration適用と実機確認を行い、記録は`tasks/009-server-data-migration.md`へ残す

## 9. Task 011で追加した匿名性・並行処理（D036〜D039）

Task 011は既存のテーブルを変更せず、次の3テーブルと関数の置き換えを追加した。
migrationは`app/supabase/migrations/20260827040000〜20260827040004_0011_*.sql`。

| オブジェクト | スキーマ | 内容 |
|---|---|---|
| `student_delivery_quota` | private | 学生1人1行の週間受信枠。`send_offer`がuser_id昇順で`FOR UPDATE`し、団体をまたぐ並行配信を直列化する。判定の正本は`offer_recipients`のローリング集計で、`window_count`は観測用の非正規化値 |
| `offer_preview_cache` | private | preview結果の24時間固定と条件数制限。保存するのは対象条件のSHA-256 fingerprintと区分だけ |
| `offer_funnel_snapshots` | private | ファネルの日次snapshot（生の件数）。開示は10-5ルール適用後の値のみ |

置き換えたRPC（戻り値の列が変わるためdrop→create）:

| RPC | 変更 |
|---|---|
| `preview_offer_audience` | 生の人数3値 → `audience_band`（6区分）+ 団体自身の枠情報 + preview条件の消費状況。`volatile`（キャッシュ行を書く） |
| `send_offer` | 戻りが`delivery_id` + `audience_band`（previewで確定した区分）のみ。配信可能5人未満は拒否。週枠を専用テーブルの行ロックで確保。**同一対象条件の24時間以内のpreviewを必須**とし、無ければ`preview_required`（D038） |
| `list_org_campaigns` | ファネルが`funnel_available` + 抑制済み4値 + `snapshot_date`。`volatile`（当日snapshotを確定する） |

- 週の定義はD021のローリング7日を維持する。`timestamptz`同士＝UTCの絶対時刻で比較し、ローカルtimezoneに依存しない。
  ただし枠を確保したあとの再判定では**上限を`now()`で閉じない**（並行トランザクションが自分より後の`delivered_at`でcommitし得るため）。
- ファネルの`snapshot_date`だけはAsia/Tokyoの暦日を使う（利用者が日本在住のため「同じ日」の意味を合わせる）。
- 対象学生の枠ロックはuser_id昇順の逐次取得で、団体をまたぐ並行送信でもデッドロックしない。
  ロック回数は対象学生数に比例するため、母集団が非常に大きい場合は送信のレイテンシが伸びる（閉鎖βの規模では問題にならない。将来の課題として記録する）。
- 送信は「対象を確認してから送る」導線（product_spec.md §7 団体 4→5）の後段であり、
  24時間以内の同一対象条件のpreviewを必須にする。これは導線の明文化であると同時に、
  送信経路が差分攻撃の観測窓にならないようにするための制約でもある（D038）。
- 送信が返す区分は、送信時点で数え直した人数ではなく**previewで確定した区分**。
  同一条件の結果を24時間固定する規則を送信の応答でも守る。

## 10. Task 010以降へ引き継ぐ事項

- オファー到着時のメール通知（D026⑥）はTask 010。`offer_recipients`への挿入が通知のトリガー点になる。
- 通報の受付・処理フロー、団体の確認・停止・kill switch、招待のレート制限、ドメイン外identity掃除の恒久化はTask 013
  （学生UIの通報ボタンは受付窓口が未開設である旨を明示している）。
- 招待承諾以外のメンバー管理（削除・role変更）と、アカウント・データ削除はTask 014。

## 11. Task 013で追加した運営操作（D043〜D045）

| オブジェクト | 役割 |
|---|---|
| `private.platform_controls` | 全団体の配信を止める緊急停止。**1行だけ**を持つ（`id boolean primary key check (id)`） |
| `private.admin_audit_log` | 運営操作の記録。学生を指す列を**構造として持たない** |
| `private.offer_deliveries.stopped_at` / `.stopped_reason` | 個別オファーの停止（D044） |
| `private.assert_delivery_allowed()` | 配信行のBEFORE INSERTトリガ。緊急停止と団体状態を確認する |
| `private.cancel_offer_mail(uuid)` | 停止した案内の送信待ちメールを`cancelled`にする |
| `admin_set_organization_status` / `admin_set_offer_stopped` / `admin_set_delivery_paused` / `admin_list_audit` | **service_role専用**の運営RPC 4本 |

- 配信可否の判定を**トリガへ置く**のが要点。RPCの中だけに書くと、将来別の挿入経路が
  できたときに素通りする。`send_offer`側の既存verified判定はそのまま残し、二重に守る。
- `list_my_inbox` / `list_org_campaigns`は末尾に`stopped boolean`を1列追加した。
  どちらも`drop`→`create`で置き換えているため、切り戻しには前の版の再適用が必要（`docs/runbook_supabase_hosted.md` §8）。
- `respond_to_offer`は停止済みの案内に対して`offer_stopped`を送出する。`mark_offer_read`は妨げない
  （読むこと自体は止めない）。
- 監査記録の列集合はpgTAP（`29_admin_boundary_test.sql`）で**完全一致**を検査する。
  将来PII列が足されたらテストが落ちる。

### 公開RPCの数（Task 013時点）

`authenticated`が実行できる`public`スキーマの関数は18本のまま増えていない
（Task 008の9本 + Task 009の8本 + Task 010の`save_notification_settings`）。
**Task 013で追加した4本は`service_role`専用で、この18本には入らない。**
`list_my_inbox`と`list_org_campaigns`は列が1つ増えただけで、権限は変わらない。
