# Decision Log

## Status legend

- Accepted: ユーザーが明示した確定事項
- Proposed: 勝つための設計案。ユーザー承認前
- Open: 未決事項

| ID | Status | 決定・論点 | 理由・備考 |
|---|---|---|---|
| D001 | Accepted | 新入生と部活・サークルをマッチングする | ゼミ課題 |
| D002 | Accepted | スマートフォン向けWebアプリ | ユーザー指定 |
| D003 | Accepted | 団体側から新入生へオファー・案内を届ける | 従来の自発応募の心理的障壁を下げる |
| D004 | Accepted | 新入生は興味分野を事前登録する | アウトドア等の関心に基づく配信 |
| D005 | Accepted | GitHubを正本として使う | CodexとClaudeの知識を共有する |
| D006 | Accepted | Claude Maxを利用できる | Claude Code等を使用可能 |
| D007 | Proposed | 団体には学生個人一覧を見せず、集計条件へ配信する | 差別・プライバシー・スパム対策 |
| D008 | Proposed | 学生が受信カテゴリと週間上限を設定する | 招待の気軽さと利用者制御の両立 |
| D009 | Proposed | 返答は3段階にする | 断りづらさを下げる |
| D010 | Proposed | 初期マッチングは説明可能なルールベース | デモの安定性と説明性 |
| D011 | Proposed | ワーキングタイトルは「CUE」 | 「参加のきっかけが届く」を表現 |
| D012 | Accepted | Vite + React + TypeScript + localStorage + Vitest | 数日で安定した静的デモを作る |
| D013 | Accepted | 2026年8月22日（土）までにデモ版完成 | メンバー間で持ち寄る |
| D014 | Accepted | ゼミメンバーが各自の成果物を持ち寄って比較する | 動作と第一印象が重要。詳細な採点表は不明 |
| D015 | Open | 神戸大学固有か汎用デモか | データと表現に影響 |
| D016 | Proposed | GitHub Pagesで共有URLを用意する | 持ち寄り時の再現性を高める |
| D017 | Accepted | 認証・本番DB・実通知はデモ対象外 | コア体験の完成度を優先する |
| D018 | Proposed | 架空大学・架空団体のデモデータを使う | 実在団体との混同を防ぐ |
| D019 | Accepted | 費用は学生予算・オファー参加費とも「1回あたり（円/回）」で統一する | 根拠のない月額換算は行わない。Task 003のUIも「1回あたりの予算」と表示する。月額比較へ変更する場合は別途仕様決定する |
| D020 | Accepted | 受信停止・週上限は「新規配信の判定」に適用する。これらの設定変更だけでは、表示中の受信済み案内を消さない | Task 004では配信イベントが未実装のため、受信箱の表示集合は現在の興味パスポートによる再評価で導出する暫定仕様（興味・受信カテゴリの編集は表示へ反映される）。Task 005で配信イベントを保存し、受信済み集合を不変の履歴として固定する。デモではdemoOffersのeligible 3件を受信済み相当として表示し、週上限を含む配信判定はTask 005の送信処理で実装する |
| D021 | Accepted | 週上限の「週」は判定時点から遡る7日間のローリングウィンドウとし、`now − 7日 < deliveredAt ≤ now`（下限exclusive・上限inclusive・UTCミリ秒比較・未来時刻は数えない）で判定する。学生の週間受信上限と、団体の週3キャンペーン上限（「1週間に作成できる有効キャンペーン」を直近7日間の送信数と解釈）の両方に配信時点で適用する | 固定の週始まりを持たず決定的。現在時刻は純関数の引数（nowIso）として注入する。過去日付のシード配信は現在週の枠を消費しない |
| D022 | Accepted | 団体ファネルは、配信（recipientの一意人数）・閲覧（read markまたは何らかのresponseを持つ受信者の一意人数）・関心（interestedまたはthinkingの返答を持つ受信者の一意人数）・参加意向（interestedの返答を持つ受信者の一意人数）の匿名件数とし、すべて受信者集合との積集合をstudentId単位で重複排除して数える。独立保存せず配信イベント・既読・返答から導出する。見送り件数は表示しない。第4指標の表示名は「参加意向」とし、「行ってみたい」の回答数であり参加の確約ではない旨を注記する | 配信⊇閲覧⊇関心⊇参加意向が保存障害時（既読保存失敗など）にも単調に保たれる。正本の一本化。「行ってみたい」の非確約性（matching_and_safety §6）と整合 |
| D023 | Accepted | 配信イベント（OfferDelivery）を送信済みキャンペーンと受信箱の唯一の正本とし、オファー内容全体（ClubOffer snapshot）と受信者別のscore・理由・注意点snapshotを配信時点の値で内蔵・固定する。再送禁止は、同一オファーIDの配信冪等化に加え、団体・正規化イベント名・日時・正規化場所が一致する同一イベントを別IDでも送信拒否することで実装し、確認画面と送信確定処理の両方で判定する | D020が予告した履歴固定の完成。パスポート編集は今後の配信判定にのみ影響し、受信済み表示（内容・理由とも）を変えない。1レコード=1書込で原子的に保存する |
| D024 | Accepted | マッチ人数の実計算のため架空の匿名学生プール（19人・PIIなし・表示名「匿名新入生NN」）を導入する。母集団は現在のメイン学生＋プールの20人。団体側画面には人数と匿名集計のみを表示し、個人の属性・一覧は表示しない。初期3件の配信履歴シードは、現在の保存済みパスポートではなくcanonicalなdemoStudentとプールから決定的に生成する | 「12人とマッチ」を演出でなく計算で成立させる（D007の実装形）。シードがユーザーの編集状態に依存せず、Task 004期の既読・返答レコードとofferIdで接続する |
| D025 | Accepted | デモリセットはCUEの4キー（preference・offer-responses・offer-reads・offer-deliveries）だけをsnapshot/rollback付きで削除して直ちにfull reloadし、完了通知はsessionStorageの一時フラグ、確認UIはnative dialogとし、新しいlocalStorage schemaは追加しない | PR #6実装の追認（レビューNon-blocker回収）。localStorage.clear()は使わず無関係キーを保護する。Task 007のscope exceptionとして承認のうえ記録 |
| D026 | Accepted | Phase 2への移行を承認する。D017（認証・本番DB・実通知はデモ対象外）は2026-08-22デモ（Phase 1）限定の決定とし、Phase 2では①大学メールによる登録・ログイン ②新入生と団体担当者の権限分離 ③一人が複数役割を持てる設計 ④団体を共有アカウントにせず複数担当者が所属する組織として管理 ⑤localStorageからサーバーデータへの移行 ⑥オファー到着時の登録メールへの通知 ⑦団体側に学生のメール・氏名・学籍番号を非表示、を実装する | ユーザー承認（2026-08-24）。Task 008（認証・権限基盤）/ 009（サーバーデータ移行）/ 010（メール通知）/ 011（運用・セキュリティQA）の4PRへ分割。mainと公開デモは凍結し、PRのbaseは`develop` |
| D027 | Accepted | Phase 2の技術はSupabase Auth（メールOTP）+ PostgreSQL + RLSを採用する。認証・権限はSQL（SECURITY DEFINER RPC + RLS）で完結させ、secret/service-role keyをフロントエンド・CIへ持ち込まない。Edge Functions + ResendはTask 010の通知まで導入しない | 原子性・pgTAP検証・鍵管理の観点でSQL RPCを優先。既存localStorageデモは隔離保持し、データ移行はTask 009 |
| D028 | Accepted | メール許可規則: 正規化（trim+小文字化）後にドメインが`stu.kobe-u.ac.jp`へ完全一致するものだけを許可する。サブドメイン・類似ドメインは不可。ローカル部に`+`を含むアドレスは拒否する（plus addressingによる複数アカウント化防止）。学籍番号の文字種など、これ以上に狭い形式は推測しない | D015は「少なくともPhase 2の認証は神戸大学学生メール限定」として解決。判定表はTypeScript関数とSQL関数で同一とし、双方でテストする |
| D029 | Accepted | D007を恒久要件化する。団体向けのtable・view・RPC・生成TypeScript型に、学生のメール・氏名・学籍番号・`auth.users.id`・配信対象学生ID一覧を含めない。大学メールは`auth.users`だけに保持し、ローカル部（学籍番号相当の機密）を`public`スキーマ・ログ・テスト出力へ保存しない | Task 009の集計APIも匿名件数のみを返す前提。担当者表示はPIIを含まないランダムラベルに限定する |
| D030 | Accepted | Before User Created Hookは採用しない（現行プランではTeam以上限定のため）。認証境界は①クライアントがドメイン外メールのOTP送信を拒否 ②`is_university_user()`が現在の`auth.users.email`（正規化判定+`email_confirmed_at IS NOT NULL`）をサーバー側で確認 ③すべてのRLSとSECURITY DEFINER RPCが同関数を必須条件とする、の3層とする | 悪意ある利用者がAuth API直接呼出でドメイン外のauth identityを作成し得ることは残余リスクとして受容し、そのidentityはCUEの全データ・RPCへアクセス不能にする。CAPTCHA・レート制限・identity掃除運用はTask 011 |
| D031 | Accepted | Task 008はPhase A（ローカル実装: migration・RLS/RPC・pgTAP・フロントエンド・Mailpit OTP・CI・lint/test/build・PII/secret検査）とPhase B（hosted staging: migration手動適用・本人所有の大学メール1件でのOTP実機確認ほか）の二段階で完了判定する。Phase B完了までは「実装完了・hosted検証待ち」とする | 実装開始前に`main`へbranch ruleset（PR必須・force push禁止・削除禁止）を人間が設定し、`develop`作成直後にも同等の保護を設定する。手順は`docs/runbook_supabase_hosted.md` |
