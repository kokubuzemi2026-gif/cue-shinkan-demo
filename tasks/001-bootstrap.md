# Task 001: フロントエンド基盤とアプリシェル

## 目的

後続機能を安全に追加できる、スマートフォン向けデモの最小基盤を作る。

## 変更してよい範囲

- `app/**`
- `.gitignore`

## 実装要件

1. `app/`にVite + React + TypeScriptプロジェクトを作る
2. lintとbuildが動く状態にする
3. Vitestを導入し、サンプルテストを1件作る
4. `docs/implementation_plan.md`の色をCSS variablesとして定義する
5. 390px幅を基準としたアプリシェルを作る
6. デモ用の「新入生／団体」ロール切替を作る
7. 共通ヘッダーと、新入生側の下部ナビの外枠を作る
8. 「デモ用架空データ」の表示を入れる

## 対象外

- 実際の画面機能
- マッチング
- localStorage
- GitHub Actions
- GitHub Pages
- UIライブラリ
- ルーター

## 受入条件

- `npm run dev`で表示できる
- 390px幅で横スクロールがない
- ロール切替で見出しが変わる
- `npm run lint`が成功する
- `npm run test -- --run`が成功する
- `npm run build`が成功する

