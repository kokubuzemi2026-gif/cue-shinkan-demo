# Task 016: UX・アクセシビリティ・完全E2E

## Goal（目的）

スマートフォン幅で、新入生と団体担当者の主要導線が最後まで破綻なく通ることを保証する。
キーボード操作・フォーカス・ラベル・コントラスト・エラー表示など、基本的なアクセシビリティを満たす。

## Source of truth（正本）

- `AGENTS.md`: §5（UI/UX）
- `CLAUDE.md`: UI要件
- `docs/launch_plan.md`: §2.4
- 各機能タスクの受入条件

## In scope

- `app/src/**`（UI・スタイルの修正。ロジックの仕様変更はしない）
- `app/e2e/**`
- `docs/launch_plan.md`、`tasks/016-ux-accessibility-e2e.md`

## Out of scope

- 新機能の追加、仕様変更
- デザインの全面刷新

## Acceptance criteria

- [x] スマホ幅390pxで全主要導線が横スクロールなしで通る
- [x] 主要画面に loading / empty / error / retry の状態がある
- [x] キーボードだけで主要導線を完了できる
- [x] フォーカスリングが見える。画面遷移でフォーカスが適切な位置へ移る
- [x] すべての入力にラベルがある
- [x] 色だけに意味を依存させていない
- [x] コントラスト比が基準を満たす（測定結果を記録する）
- [x] バリデーションメッセージが具体的で、どこを直せばよいか分かる
- [x] 二重送信が防止されている
- [x] ブラウザバック・再読み込み・セッション切れで壊れない
- [x] 新入生の完全なE2E（登録→パスポート→受信→返答→窓口開示→設定変更→削除）がある
- [x] 団体の完全なE2E（登録→団体作成→確認待ち→verified→窓口→オファー→送信→ファネル）がある
- [x] lint / test / build / E2E がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| 390px・状態・キーボード・フォーカス | E2E | `e2e/task016-a11y.spec.ts` |
| コントラスト | 計算（WCAG 2.1 相対輝度。結果を本ファイルへ記録） | 本ファイル |
| 完全導線（新入生・団体） | 既存E2E + 本タスクのa11y spec（対応は下表） | `e2e/` |

## Rollback

- 本PRのrevert。UI表示のみの変更で、保存データに影響しない。

## Verification record

実装日: 2026-08-27 / ブランチ: `feat/016-ux-a11y-e2e` / PR: #17

### 直した問題（実装のバグ）

**画面が切り替わってもフォーカスが移っていなかった。**
CUEはルーティングライブラリを使わず、stateで画面そのものを差し替える。
そのため画面が変わると、フォーカスは「消えたボタン」から`body`へ落ちる。
スクリーンリーダーは新しい画面を読み上げず、キーボード利用者は毎回
先頭からTabをやり直すことになっていた。

Phase 1のデモ画面（`src/features/`）には`headingRef`パターンが入っていたが、
Task 008〜015で追加したPhase 2の画面には入っていなかった
（`OrgOffersPanel`・`ServerOfferDetail`・`NotificationSettings`の3つを除く）。

- `src/a11y/useScreenFocus.ts`: 共通フック（見出しへフォーカス＋先頭へスクロール）
- 適用: `SignInScreen`（メール⇄コード）・`ConsentScreen`・`RoleOnboarding`・
  `OrgCreateScreen`・`AcceptInviteScreen`・`OrgHome`・`StudentArea`の
  `HomePanel`/`InboxPanel`
- `DeletionCard`: 確認が開いたら確認見出しへ（「消えるもの／残るもの」を
  読み飛ばして実行ボタンへ着かないように）
- 見出しへのフォーカスに`:focus-visible`の枠（マウス操作では出ない）

**親子のeffect順序**に注意した。Reactは子のeffectを先に走らせるため、
親（`OrgHome`）が無条件にフォーカスを取ると子（`OrgOffersPanel`）の移動を
上書きしてしまう。`OrgHome`は団体IDが変わったときだけ動かす。

### CIで見つけて直したもの

- **`OrgOffersPanel` のフォーカス移動が、非同期の読み込みを挟む画面で不発だった**（実装のバグ）。
  依存が `view` だけだったため、`対象を確認する` を押した直後は
  「配信対象を確認しています…」（見出しを持たない）が出て `ref` が null のまま
  effectが走り、preview が返って `送信内容の確認` が描画されても
  **effectは二度と走らずフォーカスは`body`へ落ちたまま**だった。
  ダッシュボードも同じ経路で不発になる。
  → 依存に `confirmState.status` と `campaignState.status` を追加した。
  新しいE2Eがこれを検出した（Task 016で追加した検査が既存実装の欠陥を見つけた形）
- **フォーカスが2回動く問題**。`OrgHome`（親）と `OrgOffersPanel`（子）の両方が
  マウント時にフォーカスを取ると、子→親→子（読み込み完了）の順で3回動く。
  読み上げの途中で移ると読み直しになるため、verifiedの団体では
  `OrgHome` 側が `ref` を渡さないようにした（審査待ちの団体では
  オファー画面が無いので `OrgHome` が団体名の見出しへ移す）

### 既存実装で満たしていた項目（調査結果）

| 受入条件 | 根拠 |
|---|---|
| 非interactive要素へのクリック | `div`/`li`/`span`の`onClick`は**0件**（すべて`button`） |
| すべての入力にラベル | 全`input`/`textarea`/`select`に`htmlFor`または`aria-label` |
| 二重送信の防止 | 16ファイルで`disabled={...busy}`、送信は`sendingRef`の一次防衛つき |
| 色だけに依存しない | 状態チップは文字、通知設定は`●`/`○`、完了は`✓`＋文言 |
| バリデーション文言 | 「イベント名を入力してください」など対象フィールドを名指し |
| loading/empty/error/retry | 各画面が3値以上の状態を持ち、errorには再試行ボタンがある |
| フォーカスリング | `.button`・`.choice-chip`・`.text-input`・`.club-input`・`.offer-card`・`.context-switcher-button`・`.bottom-nav-item`に`:focus-visible` |
| タップ領域 | `--tap-target: 44px` / `.button { min-height: 48px }` |

### コントラスト（`tokens.css`・WCAG 2.1 相対輝度で計算）

| 前景 | 背景 | 比 | AA本文(4.5) | AA大字(3.0) |
|---|---|---|---|---|
| ink #17212b | cream #fff8f0 | 15.47 | OK | OK |
| ink | white #ffffff | 16.29 | OK | OK |
| ink | mint #dff6e8 | 14.34 | OK | OK |
| ink | coral #ff6b5e | 5.83 | OK | OK |
| muted #66727d | cream | 4.67 | OK | OK |
| muted | white | 4.92 | OK | OK |
| muted | mint | 4.33 | NG | OK |
| white | coral | 2.79 | NG | NG |

NGの2組は**実際には使われていない**ことを確認した。

- `passport.css`冒頭に「coral背景に白文字は載せない」と明記され、
  `.button-primary`は`color: var(--color-ink)`（5.83）
- mint背景のルール内に`color: var(--color-muted)`を持つものは0件（走査で確認）
- `.button:disabled { opacity: 0.45 }`はコントラストを下げるが、WCAG 1.4.3は
  無効コントロールを対象外とする。状態は文言（「送信しています…」等）でも示す

### 「完全なE2E」の対応

受入条件の「完全な導線」は、既存specの積み上げと本タスクのa11y specで満たす。
**同じ機能を3度検証してCI時間を延ばすことはしない。**

| 導線の区間 | 検証しているspec |
|---|---|
| 登録（OTP）→同意→権限選択 | `task008-auth` / 全spec共通のログインヘルパー |
| パスポート作成 | `task009` step1 / `task016` step1-3（キーボードのみ） |
| 団体作成→審査待ち→verified | `task009` step4-5 / `task013` step2-3 / `task016` step2-2〜2-4 |
| 公式窓口の登録 | `task009` step6 |
| オファー作成→preview（区分）→送信 | `task009` step7 / `task011` step2-3 / `task016` step2-5 |
| 受信→既読→返答→窓口開示 | `task009` step8-9 / `task013` step4 |
| ファネル（10–5） | `task009` step10 / `task011` step4-5 |
| 通知設定の変更・停止 | `task010` step3・5 / `task016` step1-6（キーボードのみ） |
| パスポート削除・アカウント削除・脱退 | `task014` step3-8 |
| 再読み込み・ログアウト・別context | `task009` step11-12 / `task016` step1-4・1-8・1-9 |
| 停止・緊急停止 | `task013` step5-7 |

本タスクで新しく足したのは、上記の**どのspecも検証していなかった**次の観点。

1. キーボードだけで主要導線を完了できる（`tabTo`はTabで到達できなければ失敗する）
2. 画面が切り替わるたびに、その画面の見出しへフォーカスが移る
3. 390px幅で横スクロールが起きない（各画面で個別に検査）
4. メールのリンク（`#notifications`）で着地でき、URLにhashが残らない
5. 別ページから戻ってもセッションが残り、白画面にならない
6. `sb-*`を消した（＝期限切れ・別端末でのログアウト相当）状態でも
   白画面にならずログイン画面へ戻る

### 実行した検証

| 検証 | 結果 |
|---|---|
| oxlint / tsc / vitest / vite build | すべてgreen（ユニット362テスト） |
| E2E typecheck | green |
| E2E 実行（CI） | **9テスト green**（既存7 + 本タスクの2） |
| CI 3ジョブ（quality / db-tests / e2e） | green（`6ac94dc`） |

本環境にはDockerが無く、Playwrightとローカルsupabaseスタックを起動できない。
E2Eの実行はCIでのみ確認している（`docs/launch_plan.md` §5の制約）。

### 残る課題

- コントラストは**計算値**であり、実機のディスプレイ・OSの設定（ダークモード・
  ハイコントラスト）での確認は未実施
- スクリーンリーダー実機（VoiceOver / TalkBack）での読み上げ確認は未実施。
  自動検証では「フォーカスが移ること」までしか保証できない
- `NotificationSettings`・`OrgOffersPanel`・`ServerOfferDetail`は
  `useScreenFocus`を使わず、以前からの個別実装のまま残している
  （挙動が微妙に異なり、書き換えると回帰リスクだけが増えるため）
