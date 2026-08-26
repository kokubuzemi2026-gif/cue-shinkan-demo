# 自律開発ハーネス

このリポジトリでAIエージェント（主にClaude Code）が自走するための実行規約です。`CLAUDE.md` と `AGENTS.md` を、実行手順のレベルまで具体化したものです（D032）。

正本の分担は次のとおりです。

- **実行手順**（モード選択・ループ・レビューの回し方・hookの仕様と限界）は本書が正本です
- **プロダクト仕様・安全要件・プライバシー・タスク境界**は `AGENTS.md` と `CLAUDE.md` が優先します

安全要件に関わる記述が食い違う場合は `AGENTS.md` → `CLAUDE.md` → 本書の順に優先してください。

想定する使い方は、人間が「Task 010やって」のような短い指示を出し、エージェントが調査から設計・実装・テスト・独立レビュー・修正・PR・CI追跡まで進める形です。人間の確認は、後述の「人間へのエスカレーション」に該当する場合だけ求めます。

## 1. 実行モード

タスクの性質に応じて3段階から選びます。モードは作業開始時に宣言し、途中で条件を満たしたら引き上げます（引き下げはしません）。

| モード | 使う場面 | 進め方 | 検証 |
|---|---|---|---|
| Fast | 文言・typo・コメント・単一ファイルの軽微な修正。仕様解釈の余地がないもの | 調査 → 実装 → 検証 → 自己レビュー | lint / test / build（`app/` を変更した場合） |
| Standard | 通常の `tasks/NNN-*.md`。UI追加、ロジック追加、複数ファイルの変更 | architect → 実装 → test-engineer → reviewer | lint / test / build + 受入条件の対応表 |
| Deep | 認証・権限・RLS・migration・データ移行・通知・破壊的変更・仕様の矛盾があるもの | architect（Best-of-N）→ 実装 → test-engineer → reviewer → security-reviewer | Standardの検証 + pgTAP + E2E + 段階的commit |

引き上げの条件（1つでも当てはまればDeep）:

- `app/supabase/**`、認証・権限、個人情報の扱い、通知、外部サービス連携に触れる
- 既存の保存データ（localStorage / DB）の形を変える、または移行が必要
- 正本の文書間に矛盾がある、または受入条件が曖昧で解釈が分かれる
- 変更が `main` / `develop` の公開物やCIの合否に直接影響する

## 2. 実行ループ

すべてのモードで、次のループを回します。

### Plan

1. 正本を読む。`README.md` → `docs/decisions.md` → 対象タスクに必要な仕様書 → `tasks/NNN-*.md`。
   タスクに関係しない文書を無制限に読み込まない。
2. GitHubの現在状態を確認する。`develop` の最新、open PR、CIの状況。
   古い会話やAIの記憶にあるSHA・ブランチ名を信用しない。
3. `develop` の最新から作業ブランチを作る（`feat/NNN-short-description` / `fix/NNN-short-description`）。
4. 変更予定ファイル、実装方針、受入条件との対応、リスクを提示する。
   **提示はするが、人間の承認を待って停止しない。**（Plan Modeで起動された場合を除く）
5. Standard以上では architect subagent に調査と設計を任せる。

### Implement

- タスクに書かれた範囲だけを実装する。仕様にない要件を推測で足さない。
- 意味のまとまりごとにcommitする。1タスク・1ブランチ・1PR。
- 既存の型・純関数・保存キーを再利用する。重複定義を作らない。
- 実装中に仕様の穴を見つけたら、`docs/decisions.md` へ追記する候補としてメモし、実装は最小の解釈で進める。

### Verify

`app/` を変更した場合は、少なくとも次を自分で実行する。

```bash
cd app
npm run lint
npm run test -- --run
npm run build
```

変更内容に応じて追加する。

- DB・RLS・RPC・migrationに触れた: `npm run db:test`（pgTAP）
- 認証・主要導線のUIに触れた: `npm run e2e`（Playwright）
- `.claude/hooks/` に触れた: `python3 .claude/hooks/test_hooks.py`
- UIに触れた: 幅390pxで主要導線・空状態・エラー状態を確認
- 常時: `git diff --check`

実行できなかった検証は「未検証」として報告に残す。合格扱いにしない。

### Review

- Standard以上では reviewer subagent に**独立レビュー**を依頼する。
  実装者の説明を渡して同意を求めるのではなく、差分と正本を自分で読ませる。
- 認証・DB・RLS・RPC・migration・Edge Function・通知・PIIに触れた場合は
  security-reviewer も必ず通す。
- Blockerが1件でもあれば、Repairへ戻る。

### Repair

- 失敗（lint / test / build / DBテスト / E2E / レビュー指摘 / CI）は、原因を特定してから直す。
  エラーメッセージだけを見た当て推量の修正を繰り返さない。
- 修正したら、同じ検証を再実行して回帰がないことを確認する。
- テストを弱体化して通さない。`skip` / `only` / アサーション削除 / 期待値の緩和は禁止。
- **同じ失敗に対する修正が3回連続で失敗したら、ループを止める。**
  そこまでの事実（実行したコマンド、出力、立てた仮説と棄却理由）を整理し、
  人間へエスカレーションする。無限に試行し続けない。

## 3. Best-of-N

Deepモード、または実装方針が分岐するときに使います。

- 設計案を2〜3案作る。**設計だけを複数作り、実装は1案だけ**にする（実装のN並列はコストに見合わない）。
- 評価軸: 仕様適合 / 安全・プライバシー / 可逆性 / テスト容易性 / スコープ最小性。
- 各案について「この案を選ばない理由」を1行で書く。書けない案は理解が浅いので、調査へ戻る。
- 選んだ理由と捨てた案を、タスクファイルの「Verification record」またはPR本文へ残す。
- 決定が今後のタスクを縛る場合は `docs/decisions.md` へD番号付きで追記する。

## 4. Definition of Done

次をすべて満たしたときだけ「完了」と報告します。

1. タスクの受入条件を1つずつ確認し、充足・不足・未検証を明示した
2. スコープ外のファイルを変更していない
3. `app/` 変更時: lint / unit test / build がローカルでgreen
4. 変更内容に応じた追加検証（pgTAP / E2E / hookテスト / 390px確認）を実行、または未実施として明示した
5. 独立レビュー（Standard以上。Fastは自己レビュー）を通し、Blockerが残っていない
6. secret・実在する個人情報・APIキーをコミットしていない
7. feature branchへpushし、`develop` 向けPRを作成した
8. CIがgreen、または赤の原因と対応方針をPRへ記録した
9. 日本語で、変更概要・変更ファイル・検証結果・仕様との対応・残るリスクを報告した

自動マージはしません。マージの判断は人間が行います。

## 5. 人間へのエスカレーション

次の場合**だけ**作業を止めて人間に確認します。

- OAuth / OTP / 2FA など、人間の操作や本人所有アカウントが必要な認証
- 課金、有料プラン、外部サービスの新規契約
- production環境への不可逆な変更（データ削除、公開設定変更、DNS、鍵の失効）
- 正本の文書間に、受入条件を左右する重大な矛盾がある
- タスクの前提が現状と食い違い、続行するとスコープを大きく越える
- 同じ失敗に対する修正が3回連続で失敗した（第2節 Repair）
- リポジトリ・CI・公開物に、実在する個人情報またはsecretが含まれている疑いがある

逆に、次では止まりません。自分で調べて直します。

- コマンドの失敗、依存関係の不足、環境変数の未設定（実値が必要な場合を除く）
- lint / test / build / CIの失敗
- レビュー指摘、設計のやり直し
- 想定より変更点が多いこと（タスク境界の中に収まる限り）

エスカレーションするときは、質問だけを投げず、次を添えます。

- 何を確認したか（読んだファイル、実行したコマンドと結果）
- 何が決められないか、選択肢は何か
- 各選択肢の影響と、エージェントとしての推奨

## 6. 自動ガード（hooksと権限設定）

`.claude/settings.json` から2つのhookと、`.env`系ファイルのRead拒否が有効になります。hookの実装は `.claude/hooks/` にあり、python3が必要です。

### guard_git.py（PreToolUse / Bash）

次の**5種類だけ**を機械的に拒否します。判定はトークン解析で行い、tool inputをshellへ展開しません。拒否理由にコマンド全文を含めない（URLに埋め込まれたトークンを出さない）設計です。

- `main` / `develop` への直接push（明示的なrefspec、`HEAD`、refspecなしの暗黙push、`--all` / `--mirror`、削除push）
- force push（`--force` / `-f` / `--force-with-lease` / `--force-if-includes` / `+refspec`）
- `git reset --hard`
- `git clean -f`（`-fd` などの結合短オプションを含む。`--dry-run` 併用時は許可）
- `git branch -D` / `git branch --delete --force`

次の回避経路も判定できるようにしています。

- gitが受理する長オプションの短縮形（`--har` は `--hard`、`--fo` は `--force`）
- ラッパーコマンド経由（`env` / `sudo` / `nohup` / `time` / `command` / `timeout` / `nice` など）
- `bash -c "..."` / `sh -c "..."` / `eval "..."` の中身、バッククォート、`$(...)`
- シェル制御構文（`if ... then`、`for ... do`、`{ }`、`&&`、`;`、`|`、改行、行継続）
- git alias（`git -c alias.x=push x` とリポジトリ設定の両方を展開してから判定）
- NUL文字による引数の切り詰め

### quality_gate.py（Stop）

セッション終了時に、`app/` に変更がある場合だけ `npm run lint` → `npm run test -- --run` → `npm run build` を実行します。失敗したらStopをブロックし、失敗コマンドと出力の末尾をエージェントへ返します。

- 変更判定は「`app/` の未コミット変更」または「ベースref（`origin/develop` → `origin/main` →
  `develop` → `main` の順）からの差分に `app/` が含まれること」です。
  セッション単位ではなく**ブランチ単位**なので、`app/` を触ったブランチでは
  文書だけを編集したセッションでもゲートが走ります（安全側に倒しています）。
- `stop_hook_active` が true のときは即座に終了し、無限ループを防ぎます。
  そのため**ブロックは1セッションにつき1回まで**です。2回目以降の担保はCIが行います。
- 重いDBテスト・E2Eはここでは実行しません。タスクのDoDとCIで担保します。
- `app/node_modules` がない場合は `npm ci` を促してブロックします。
  npm自体がない環境ではゲートを省略します（CIが最終的な砦）。
- 出力は既知形式のsecret（`ghp_` / `github_pat_` / `sb_secret_` / `sbp_` / `re_` / JWT /
  `Bearer` / URL埋め込み資格情報 / `*_KEY=` など）をマスクしてから返します。
  **網羅は保証しません。**この出力をPR・タスクファイル・報告へ転記する前に、必ず目視で確認してください。

### permissions.deny（`.env`系の保護）

`.claude/settings.json` の `permissions.deny` で、`.env` / `.env.local` / `.env.*.local` /
`.env.development` / `.env.production` / `.env.staging` / `.env.test` と `.git/config` の
**Readツールでの読み取り**を拒否します。プレースホルダーだけの `app/.env.example` は読めます。
アプリが開発コマンド内で環境変数を使うことは妨げません。

この拒否は**Readツールにしか効きません**。`cat` / `grep` / `printenv` などBash経由の読み取りは防げません。実値の保護は `.gitignore` と、「secretをローカルにも置かない・Dashboardへ直接入力する」運用（`docs/runbook_supabase_hosted.md`）で担保します。

### hookの限界（把握したうえで使う）

- **ローカルの最終防衛線ではありません。** `main` / `develop` の保護は、GitHubの
  ブランチ保護（PR必須・force push禁止・削除禁止）とCIが本来の防御です。
- 上記5種類以外の破壊的操作は拒否しません。`git branch -M`、`git checkout -f`、
  `git restore .`、`git stash clear`、`git update-ref -d`、`git rebase`、`git commit --amend` は
  素通りします。**`git reset --hard` / `git clean -f` / `git branch -D` は、
  失われるのがローカルの未コミット変更なので、リモート側に受け皿がありません。**
  規約（本書とCLAUDE.md）で守る前提です。
- 変数展開・コマンド置換の**結果**は判定できません。`git push origin $BRANCH` や
  `echo main | xargs git push origin` は、実行時の値が `main` でも検出できません。
- Claude Codeの `Bash` ツール経由のコマンドだけを見ます。他のツール、エディタ、
  別ターミナルからの実行は対象外です。
- ヒアドキュメントの本文は判定対象から除いていますが、引用符が閉じていないなど
  解析できないコマンドは、既知の危険パターンだけを正規表現で拒否します（誤検知しうる）。
- `.claude/hooks/` を変更したら `python3 .claude/hooks/test_hooks.py` を実行してください。

## 7. subagentの使い分け

`.claude/agents/` にプロジェクトsubagentを置いています。

| subagent | 役割 | 編集方針 | 使う場面 |
|---|---|---|---|
| architect | 調査と設計、Best-of-N比較 | 編集しない | Standard以上の実装前 |
| test-engineer | 受入条件のテスト化 | テストファイルのみ | 実装後、レビュー前 |
| reviewer | 独立レビュー | 編集しない | commit・PR前（Standard以上） |
| security-reviewer | 安全・プライバシーレビュー | 編集しない | 認証・DB・RLS・RPC・migration・Edge Function・通知・PIIに触れたとき |

「編集方針」は規約であって機械的な強制ではありません。レビュー系subagentも `Bash` を持つため、技術的にはファイルを書けます（`tools` から `Edit` / `Write` を外しても、リダイレクトや `sed -i` は塞げません）。test-engineerの「テストファイルのみ」も同様に規約です。

レビュー系subagentには「自分の実装が正しいことを確認して」と依頼しないでください。差分と正本を渡し、独立に検証させます。

## 8. ハーネス改善ルール

このハーネス自体も、正本と同じ手順で改善します。

1. **同じ種類の失敗を2回繰り返したら、仕組みを直す。** 個別の修正で終わらせない。
   直す先は次のいずれか。
   - 判断基準が曖昧だった → `CLAUDE.md` / `AGENTS.md` / 本書
   - 機械的に防げた → `.claude/hooks/`
   - タスクの書き方が悪かった → `tasks/_template.md`
   - 検証が足りなかった → テスト、またはCI
2. ハーネスの変更も1タスク・1ブランチ・1PRで行う。実装タスクのPRに混ぜない。
3. hookを変更したら `python3 .claude/hooks/test_hooks.py` を更新・実行する。
   テストのないガードは追加しない。
4. ルールを追加するときは、同時に「いつ止めなくてよいか」も書く。
   禁止だけを増やすと、エージェントが過剰に停止して自走しなくなる。
5. 使われなかったルール・守れなかったルールは削除するか、守れる形に書き換える。

## 9. 既知の限界

- ローカル品質ゲートは1セッションにつき1回しかブロックできません（無限ループ防止のため）。
- hookはClaude Codeの `Bash` ツール経由のコマンドだけを見ます。他のツールや、
  エディタから直接実行されたコマンドは対象外です。変数展開・コマンド置換の結果、
  および標準入力から渡される引数（`xargs` など）は判定できません。
- guard_gitが拒否するのは §6 に列挙した5種類だけです。それ以外の破壊的操作は素通りします。
- Stop hookの出力マスクは既知形式のsecretに限られます。網羅は保証しません。
- `permissions.deny` はReadツールにしか効かず、Bash経由の読み取りは防げません。
- subagentの「編集しない」は規約であり、機械的な強制ではありません（§7）。
- 本書はエージェントの行動規約であり、権限の分離ではありません。
  実効的な保護は、GitHubのブランチ保護（PR必須・force push禁止・削除禁止）とCIです。
  ただし `git reset --hard` / `git clean -f` / `git branch -D` が壊すのはローカルの
  未コミット変更なので、リモート側に受け皿がありません。この3つは規約とhookだけが防御です。
