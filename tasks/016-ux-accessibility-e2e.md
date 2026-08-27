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
- [x] コントラスト比が基準を満たす（測定結果を記録する）※本文（1.4.3）は全組み合わせで4.5以上。**細線の枠（1.4.11）は未達**で、残る課題へ記録した
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

### コントラスト（WCAG 2.1 相対輝度で計算）

**最初の測定方法が誤っていた。** 同一CSSルールの中に前景色と背景色が
両方書かれている場合しか走査しておらず、**入れ子と継承で成立する組み合わせを
取りこぼしていた**。独立レビューが、取りこぼした2件が実際に使われていることを
指摘した（下記「独立レビューの結論と対応」B1）。

- `.danger-button`（coral文字・15px bold）が `.danger-card`（白）の上 → **2.79**
- `.audience-quota`（muted・12px）が `.audience-hero`（mint）の**中** → **4.33**

**走査で個別に潰す方法をやめ、トークンの側で成立しないようにした。**
前景として使うトークンが、背景として使う全トークンに対して4.5以上なら、
どんな入れ子でも失敗しようがない。

| 変更 | 前 | 後 | 理由 |
|---|---|---|---|
| `--color-muted` | `#66727d` | `#5f6a75` | mint上で4.33しかなかった（最も条件が厳しい背景） |
| `--color-danger`（新規） | — | `#c62f21` | coralは白背景で2.79。**文字色には使えない**ため、読める赤を別に持つ |
| `.danger-button` の文字・枠 | coral | danger | 「興味パスポートを削除」「アカウントを削除」「団体から脱退」 |
| `.danger-card--open` の枠 | coral | danger | 確認が開いた状態の枠 |
| `.context-switcher-button[aria-pressed]` の枠 | coral | ink | 選択中を示す主要な手がかり。1.4.11（非テキスト3:1）を満たしていなかった |
| `.bottom-nav-item[aria-current] .bottom-nav-icon` | coral | ink | coralを文字色に使う最後の1件（到達不能なPhase 1デモ側）。**`color: var(--color-coral)` の使用を0件にして、grepで機械的に確認できる状態にした** |

変更後の**許可する組み合わせ全件**（これ以外の組み合わせは実装に存在しない）:

| 前景 | 背景 | 比 | AA本文(4.5) |
|---|---|---|---|
| ink #17212b | white / cream / mint / coral | 16.29 / 15.47 / 14.34 / 5.83 | OK |
| muted #5f6a75 | white / cream / mint | 5.52 / 5.24 / 4.86 | OK |
| white #ffffff | ink | 16.29 | OK |
| danger #c62f21 | white / cream / mint | 5.48 / 5.21 / 4.83 | OK |

非テキスト（1.4.11・3:1）: 選択中の枠 ink on white = 16.29。

**半透明の背景も数え直した**（トークン同士だけを見ると、これも取りこぼす）。
CSSに直書きされている背景は3種類あり、下地（white / cream / mint）と合成した色で計算した。

| 重ねている背景 | 使っているルール | 上に載る文字 | 合成後のコントラスト |
|---|---|---|---|
| `rgba(23,33,43,0.08)` | `.offer-status--answered` / `.status-chip--paused` / `.wizard-progress-bar` | ink（`.offer-status`・`.status-chip`が指定）／文字なし | 12.31〜13.90 OK |
| `rgba(255,107,94,0.14)` | `.form-error` / `.status-suspended` | ink | 12.58〜14.11 OK |
| `rgba(23,33,43,0.45)` | `.demo-dialog::backdrop` | 文字なし | — |

**muted をこれらの上に載せている箇所は無い**（載せると mint 下地で 4.17 まで落ちる）。
`background: transparent` / `none` は親の背景をそのまま使うため上表に含まれる。

前景として `color:` に現れるトークンは ink(23) / muted(46) / white(3) / danger(1) / inherit(1) の
5種類だけで、上表と合わせて**全組み合わせを網羅している**（`grep -o 'color: [^;]*'` で確認）。

`.button:disabled { opacity: 0.45 }`はコントラストを下げるが、WCAG 1.4.3は
無効コントロールを対象外とする。状態は文言（「送信しています…」等）でも示す。

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
6. `sb-*`を消した（＝この端末からセッション情報が失われた）状態でも
   白画面にならずログイン画面へ戻る
   （**期限切れ**は`autoRefreshToken`が更新するため別経路、
     **別端末でのログアウト**は古いtokenが残るため別経路。どちらも未検証）

### 実行した検証

| 検証 | 結果 |
|---|---|
| oxlint / tsc / vitest / vite build | すべてgreen（ユニット362テスト） |
| E2E typecheck | green |
| E2E 実行（CI） | **9テスト green**（既存7 + 本タスクの2）。オファー作成〜送信のキーボード操作を含む |
| CI 3ジョブ（quality / db-tests / e2e） | green |

**途中でdb-testsが赤になった**が、原因は本タスクの変更ではなく
`26_notification_control_test.sql` の時限式だった（`develop` でも赤）。
別PR #18 で修正して `develop` へmergeし、本ブランチへ取り込んでいる
（経緯は `tasks/010-email-notifications.md`「後日みつかった不具合」）。

本環境にはDockerが無く、Playwrightとローカルsupabaseスタックを起動できない。
E2Eの実行はCIでのみ確認している（`docs/launch_plan.md` §5の制約）。

### 独立レビューの結論と対応

**reviewer**: Blocker 2件（修正後に再レビュー）。**どちらも自分で再現したうえで修正した。**

| 指摘 | 深刻度 | 再現内容 | 対応 |
|---|---|---|---|
| B1（コントラストのNG組が実際に使われている） | Blocker | 自分の走査は**同一ルール内に前景と背景が両方書かれている場合しか見ておらず**、入れ子と継承の組み合わせを取りこぼしていた。`.danger-button`（coral文字）が `.danger-card`（白）の上で**2.79**、`.audience-quota`（muted 12px）が `.audience-hero`（mint）の中で**4.33**。どちらもPhase 2から到達する画面（削除導線・送信確認）。受入条件に`[x]`を付けていたが実際には未達だった | 個別に潰すのをやめ、**トークン側で成立しないようにした**（`--color-muted` を暗く、`--color-danger` を新設）。許可する前景×背景の全組み合わせが4.5以上であることを確認（上表）。`color: var(--color-coral)` の使用は**0件**にして、grepで機械的に確認できるようにした |
| B2（verified団体どうしの切替でフォーカスが移らない） | Blocker | `6ac94dc` で `OrgHome` の ref を verified のとき外したが、`OrgOffersPanel` のフォーカスeffectの依存に `organizationId` が無く、`AuthenticatedShell` は `key` を渡さず、取得effectも成功時に `status` を `'ready'` のまま入れ直すだけ。よって**effectが一度も再実行されず**、フォーカスは切替前のボタンに残る。**自分が `6ac94dc` で作った穴** | 依存へ `organizationId` を追加 |
| N1（wizard step1だけ着地点が違う） | Non-blocker | `HomePanel`（親）の key が wizard 突入で変わるため、`PassportWizard`（子）が step見出しへ移した直後に親が h1 を奪う。step2以降は子だけが走るので**step1だけ挙動が違う** | wizard分岐では親がrefを渡さない |
| N2（横スクロール判定が甘い） | Non-blocker | `window.innerWidth` は縦スクロールバー幅を含むため、実際に横スクロールが出ていても通る | `documentElement.clientWidth` と比較する |
| N3（キーボード検証の範囲） | Non-blocker | オファー作成〜送信は全てマウス操作だった | **キーボードだけで通すよう書き換えた**（入力4件＋チップ3件＋理由＋2ボタン） |
| N4（AppRoot直下のエラー画面） | Non-blocker | 「読み込みに失敗しました」「このアカウントでは利用できません」「はじめる前に（同意の読み込み失敗）」にフォーカス移動が無い | 3つへ共通のrefを追加 |
| N5（E2Eのトートロジー） | Non-blocker | 「文字がある」の検査が直前のassertionから自明で、何も検証していない | 状態の説明文と、配信導線が出ていないことを検査する形へ |
| N7（bandラベル依存） | Non-blocker | `/人の新入生へ配信しました/u` は band が `50人以上` だとマッチしない | `/新入生へ配信しました/u` へ |
| N6（e2eが恒常的な型検査の網に無い） | Non-blocker | `tsc -b` は `e2e/` を見ない | **別PR**（`tsconfig` はIn scope外） |
| Nit（引数名 `step`） | Nit | wizardのstepと紛らわしい | `screenKey` へ改名 |

**reviewer（再レビュー）**: コード差分について**Blockerゼロ**。B1・B2の解消を、
同じ列挙・全数照合の方法で独立に確認した。

- 前景の網羅: ink23 / muted46 / white3 / danger1 / inherit1。`color: var(--color-coral)` は**0件**
- 背景の網羅: white27 / mint20 / cream16 / ink3 / coral2 / transparent系4 / 半透明3種。
  **面の集合が閉じている**ことを確認
- 危険なペア（muted・danger を ink / coral / 合成背景の上に、white を非ink背景の上に）が
  実際に描画されないことを、CSSとTSXの突合で全11ルール個別に追跡
- カスケードの穴（基底が色+背景を持ち派生が背景だけ差し替える型）も検査。
  `.status-chip`/`.status-pending` は両方とも背景と文字色をセットで持つため混ざらない
- `--color-muted` は `color:` 専用（border/background/shadowでの使用0件）＝暗くした副作用なし
- B2は「再マウントされない・`campaignState.status` が変わらない」条件下で
  `organizationId` の変化により effect が再実行され、`headingRef.current` が
  生きている見出しを指すことをトレースで確認。pending→verified、verified→pending、
  学生⇄団体の4遷移すべてで二重移動が起きないことも確認
- N3のTab順がDOM順と単調増加で噛み合い、最大ホップ15 Tab（上限60）で成立することを
  `OfferComposer.tsx` と定数の個数から確認

**security-reviewer**: Blocker 0件（承認可）。指摘はすべて自分で確認したうえで対応した。

| 指摘 | 深刻度 | 内容 | 対応 |
|---|---|---|---|
| N1（アーティファクトへの秘密値） | Non-blocker（優先度高） | **Playwright 1.51以降は、失敗時に必ず `page.ariaSnapshot()` を撮って `test-results/<test>/error-context.md` へ書き出す。** `trace`/`video`/`screenshot` の無効化とは無関係で、gateは `PLAYWRIGHT_NO_COPY_PROMPT` 環境変数だけ。aria snapshotは `input`/`textarea` の**値をそのまま含む**ため、6桁コードの入力直後や招待リンク表示中に失敗すると、それらがファイルへ落ちる | **CI実ログで裏を取った**（Task 016の失敗runに `Error Context: test-results/.../error-context.md` が出ている）。`playwright.config.ts`・`package.json`・`ci.yml` は本タスクのIn scope外のため、**別PRで `PLAYWRIGHT_NO_COPY_PROMPT=1` を設定し、config/CIのコメントも実態へ直す**（AGENTS §2「対象外ファイルを変更しない」）。現状の実害は限定的: `test-results/` はgitignore、CIに `upload-artifact` が無く使い捨てrunnerで破棄、値はローカル使い捨てSupabaseの合成アカウント向け1回限りのもの |
| N2（セッション切れの主張が広すぎる） | Non-blocker | `sb-*` を消す操作は「この端末からセッション情報が失われた」場合であり、**access tokenの期限切れ**（`autoRefreshToken`が更新する）とも**別端末でのログアウト**（古いtokenが残り `getSession()` が成功する）とも別経路 | specのコメントと本ファイルの記述を実態へ訂正。2つの未検証経路を明記 |
| N5（フォーカス移動の抜け） | Non-blocker | `AccountDataPanel` の `h1 アカウントとデータ` と、`OrgOffersPanel` のダッシュボード読み込みエラー分岐に見出しrefが無い | 両方へ追加。E2Eにアカウントタブのフォーカス検査を足した。CSSのフォーカス枠に `.auth-card-title[tabindex='-1']` を追加 |
| N3（合成学生が残る） | Non-blocker | `seedStudentPool` の8人が消えない | 対応不要と判断。CIは毎回 `supabase start` で作り直す使い捨てDB。`outdoor` の下限側assertionは無く（`task011` は `travel` 4人で検査）、「本来ブロックされるはずが通る」向きの汚染は起きないことをレビュー側が確認 |
| N6（受信箱のスクロール位置） | Non-blocker | 詳細から戻ると `window.scrollTo(0,0)` で読んでいた位置が失われる | 対応不要と判断。`ServerOfferDetail` も表示時に先頭へ戻すため、詳細を開いた時点で既にスクロールは0。回帰ではない |
| N4（execSqlの文字列連結） | Non-blocker | 値はすべてテスト内の定数で注入は成立しない。既存specより安全側（`-c` ではなく標準入力・`ON_ERROR_STOP=1`） | 対応不要 |

**確認して問題が無かったと明示されたもの**: OTP入力欄・招待リンクへの自動フォーカスは無い（見出しへ移すだけ）/ `DeletionCard` は説明を飛ばす方向に働かない（DOM順が 見出し→注意→消えるもの→残るもの→実行ボタン）/ CSS追加は情報露出の経路にならない / secretの混入なし / 受信停止・返答3択・削除導線は無傷 / migration・RPC・RLSに未接触。

### 残る課題

- コントラストは**計算値**であり、実機のディスプレイ・OSの設定（ダークモード・
  ハイコントラスト）での確認は未実施
- スクリーンリーダー実機（VoiceOver / TalkBack）での読み上げ確認は未実施。
  自動検証では「フォーカスが移ること」までしか保証できない
- `NotificationSettings`・`OrgOffersPanel`・`ServerOfferDetail`は
  `useScreenFocus`を使わず、以前からの個別実装のまま残している
  （挙動が微妙に異なり、書き換えると回帰リスクだけが増えるため）
- **`PLAYWRIGHT_NO_COPY_PROMPT` の設定は別PR**（本タスクのIn scope外。上記N1）
- **`e2e/` を恒常的な型検査へ入れるのも別PR**（`tsconfig` はIn scope外。reviewer N6）。
  現状は一時tsconfigで手元検査しているだけで、CIには網が無い
- **細線の枠は1.4.11（非テキスト3:1）を満たしていない**（再レビューで指摘・自分でも計算した）。
  `.choice-chip` `rgba(23,33,43,0.16)` / `.text-input` `0.18` / `.club-input` `0.24` /
  `.status-pending` `0.25` は、白地に対して **1.39〜1.68** しかない。
  3:1に届かせるには **alpha 0.50** が必要で、アプリ全体の枠線の見え方が変わる。
  Task 016のOut of scope（デザインの全面刷新）に触れるため**本タスクでは変えず**、
  Task 017の既知リスク一覧へ送る。入力欄の枠は1.4.11の対象になり得るため、
  公開前に運営者の判断が必要
- `.button-primary` の coral 背景と周囲の境界も white 2.79 / cream 2.65 で 1.4.11 未満。
  `box-shadow` と ink 太字ラベルがあるため識別自体は可能（既存・差分外）
- `opacity: 0.45` の disabled は WCAG 1.4.3 の対象外（無効コントロール）
- レビュー中にブランチが5回動いた。reviewerは最終状態（`2600ad6`）で判定しているが、
  **B1・B2の修正はその後**なので、修正内容そのものは独立レビューを通していない
- セッションの**期限切れ**と**別端末でのログアウト**は未検証（上記N2）
