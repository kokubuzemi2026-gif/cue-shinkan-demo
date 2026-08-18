# Task 002: ドメイン型・架空データ・マッチング

## 目的

説明可能で再現可能なマッチングを、UIから独立したpure functionとして作る。

## 最初に読む

- `docs/matching_and_safety.md`
- `docs/implementation_plan.md`

## 変更してよい範囲

- `app/src/domain/**`
- `app/src/data/**`
- `app/src/**/*.test.ts`

## 実装要件

1. StudentPreference、Club、ClubOffer、MatchResult、OfferResponseの型を定義する
2. 実装計画にある架空団体・学生データを作る
3. `calculateMatch(student, offer)`をpure functionで実装する
4. eligible、score、reasons最大3件、cautions最大2件を返す
5. 65点未満、受信停止、カテゴリ不一致ではeligible=falseにする
6. 配点は`docs/matching_and_safety.md`に従う
7. 境界値と主要ケースのunit testを作る

## 対象外

- UI
- localStorage
- API
- 機械学習・外部AI

## 受入条件

- メイン学生と六甲アウトドア会が高得点でマッチする
- 予算超過などがcautionsへ出る
- 同じ入力は同じ結果を返す
- マッチ・非マッチ・境界値のテストがある
- lint、test、buildが成功する

