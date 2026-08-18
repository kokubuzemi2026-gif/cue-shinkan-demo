# Task 007: CI・GitHub Pages・最終QA

## 目的

GitHub上で品質確認し、スマートフォンから開ける共有URLを作る。

## 変更してよい範囲

- `.github/workflows/**`
- `app/vite.config.*`
- デプロイに必要な最小設定
- `README.md`の実行・公開手順

## 実装要件

1. pull requestとmain pushでlint、test、buildを実行
2. main pushまたは手動実行でGitHub Pagesへ`app/dist`を公開
3. `app/`をworking directoryとして扱う
4. リポジトリ配下URLでasset pathが壊れないようにする
5. READMEへローカル実行と公開手順を追加

## 受入条件

- GitHub Actionsが成功する
- Pages URLをiPhoneで開ける
- 再読み込みしても白画面にならない
- 主要画面の画像・CSS・JSが読み込まれる
- デモリセットが動く
- 公開物に秘密情報・実在学生データがない

