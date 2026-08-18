# Demo Implementation Plan

- Deadline: 2026-08-22（土）
- Goal: メンバー持ち寄りで最も記憶に残る、動作するスマートフォンデモ
- Scope: 学生登録 → 団体オファー → 学生受信・返答 → 団体指標更新

## 1. 技術構成

```text
GitHub repository
├── app/                    Vite + React + TypeScript
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   ├── data/
│   │   ├── domain/
│   │   ├── storage/
│   │   └── styles/
│   └── package.json
├── docs/
├── tasks/
├── prompts/
└── .github/workflows/
```

### 採用

- Vite + React + TypeScript
- CSS variablesと独自CSS
- localStorageでデモ状態を保存
- Vitestでマッチング関数を検証
- GitHub Actionsでlint・test・build
- GitHub Pagesで静的公開

### 採用しない

- バックエンド
- ログイン・認証
- Supabase / Firebase
- 本番プッシュ通知
- チャット
- React Router
- 重いUIコンポーネントライブラリ
- 外部AI API

## 2. デモ用画面

### 共通

- 画面上部のデモ用ロール切替: 「新入生」「団体」
- デモ状態リセット
- 「デモ用架空データ」の小さな表示

### 新入生

1. ウェルカム
2. 興味パスポート
3. ホーム
4. オファー受信箱
5. オファー詳細
6. 返答完了
7. 受信設定

### 団体

1. ダッシュボード
2. オファー作成
3. マッチ対象プレビュー
4. 送信完了
5. ファネル更新

## 3. デザイン方針

### ブランド

- Working name: CUE
- Tagline: 新歓は、探すから届くへ。
- Tone: 歓迎、安心、軽やか。就活スカウトの緊張感を出さない

### 色

- Ink: `#17212B`
- Coral: `#FF6B5E`
- Mint: `#DFF6E8`
- Cream: `#FFF8F0`
- White: `#FFFFFF`
- Muted text: `#66727D`

紫系AIグラデーション、過剰なガラス表現、テンプレート感の強いダッシュボードを避ける。

### UIの見せ場

- 封筒ではなく、イベントカード型のオファー
- オファー受信時の小さな到着アニメーション
- 「あなたに届いた理由」をタグではなく短い文章で表示
- 「行ってみたい」を押すと団体側の数字が増える
- 完璧一致だけでなく、注意点のあるオファーも1件用意する

## 4. デモデータ

すべて架空と明記する。

### メイン団体

- 六甲アウトドア会
- イベント: はじめての六甲山ハイク
- 条件: アウトドア、初心者歓迎、土日、月1〜2回、参加費1,500円

### 比較用団体

- Harbor Film Lab
- Blue Note Session
- Kobe Weekend Runners
- Bridge Volunteer Team
- Table Talk International

### メイン学生

- 表示: あなた
- 興味: アウトドア、写真、旅行
- 目的: 友達を作る、新しいことへ挑戦
- スタイル: ほどほど
- 頻度: 月1〜2回
- 日時: 土日
- 経験: 未経験
- 予算: 1回2,000円以内

## 5. マッチング実装

- pure functionとして実装する
- 入力: StudentPreference, ClubOffer
- 出力: eligible, score, reasons, cautions
- 100点満点
- 65点以上を配信対象
- 理由を最大3件
- 注意点を最大2件
- 同じ入力は常に同じ結果
- unit testを作る

## 6. 状態

localStorageへ保存する。

- 学生の興味パスポート
- 作成済みオファー
- オファーの送信状態
- 学生の返答
- 団体側ファネル

「デモを最初から」ボタンでseed stateへ戻せるようにする。

## 7. 実装順序

### 8月18日（火）

- Task 001: Vite基盤、デザイントークン、アプリシェル
- Task 002: 型、架空データ、マッチング関数とテスト

### 8月19日（水）

- Task 003: 興味パスポート
- Task 004: 学生の受信箱・詳細・返答

### 8月20日（木）

- Task 005: 団体のオファー作成・送信・ファネル
- 学生と団体の状態連動を完成

### 8月21日（金）

- Task 006: 空状態・エラー・アニメーション・デモリセット
- Task 007: CI、GitHub Pages、スマートフォンQA
- 90秒デモを3回通す

### 8月22日（土）

- 機能追加禁止
- リンク、表示、リセットだけ確認
- デモ前にseed stateへ戻す

## 8. 完了の定義

- GitHub PagesのURLをスマートフォンで開ける
- 学生側で興味パスポートを完了できる
- 団体側でオファーを作成・送信できる
- 学生側へ新しいオファーが現れる
- 学生の返答後、団体側ファネルが変化する
- リロードしても状態が維持される
- リセットで同じデモを再現できる
- lint、test、buildが成功する
- 主要導線に行き止まりがない

## 9. 失敗時の削減順

時間不足の場合、次の順で削る。

1. 比較・お気に入り
2. 受信設定の詳細
3. 複数団体の作成
4. 細かなアニメーション
5. ファネルのグラフ表現

学生→団体→学生→団体の状態連動は削らない。

## 10. 公式参照

- Vite Getting Started: https://vite.dev/guide/
- Vite Static Deploy / GitHub Pages: https://vite.dev/guide/static-deploy
- GitHub Pages custom workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- Claude Code Plan Mode: https://docs.anthropic.com/en/docs/claude-code/common-workflows
- Claude Code project memory / CLAUDE.md: https://docs.anthropic.com/en/docs/claude-code/memory
