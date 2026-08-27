# 運営操作（団体確認・停止・緊急停止）

- 対象: Task 013
- 正本: `docs/decisions.md` D043〜D045
- 関連: `docs/auth_and_authorization.md` §4・§7、`docs/matching_and_safety.md` §7、`docs/server_data_model.md` §11

この文書は、**運営者だけが行う操作**の正本です。団体担当者・学生の画面からは
到達できません。運営画面UIは本タスクのスコープ外で、当面はSupabaseの
SQL Editor（service_role権限）から実行します。

## 1. 権限の考え方

| 操作 | 実行できる主体 | 経路 |
|---|---|---|
| 団体を確認済みにする / 停止する / 戻す | 運営者のみ | `admin_set_organization_status` |
| 個別オファーを止める / 戻す | 運営者のみ | `admin_set_offer_stopped` |
| 全団体の配信を止める / 戻す | 運営者のみ | `admin_set_delivery_paused` |
| 運営操作の記録を見る | 運営者のみ | `admin_list_audit` |

4本とも**service_role専用**です。`anon`・`authenticated`にはEXECUTE権限がなく、
呼び出すと`permission denied`になります（`29_admin_boundary_test.sql`で検査）。

団体は`public.organizations`へのUPDATE権限を持たないため、**自分をverifiedに
することも、他団体を止めることもできません**。admin判定を画面の出し分けだけに
依存させていないことが、この設計の要点です（D043）。

## 2. 団体の確認（verify）

新しく作られた団体は`pending`（審査待ち）で始まり、配信できません。
実在確認（部室・代表者・大学の団体登録など、運営が定めた手順）を終えてから
`verified`にします。

```sql
select public.admin_set_organization_status(
  '<organization id>'::uuid,
  'verified',
  'ops-<運営担当の識別子>',   -- 氏名・メールを入れない（D043）
  '団体登録簿で確認'          -- 学生個人を特定できる記述を入れない
);
```

`actor_label`は空にできません（`invalid_admin_action`）。
存在しない団体IDは`organization_not_found`になります。

## 3. 団体の停止（suspend）

通報・偽団体の疑い・危険な勧誘（`docs/matching_and_safety.md` §7）に対して使います。

```sql
select public.admin_set_organization_status(
  '<organization id>'::uuid, 'suspended', 'ops-1', '通報対応（案件番号のみ）');
```

停止すると、次がまとめて起きます。

1. その団体は新規配信できなくなる（`org_not_verified`）
2. その団体の**配信中オファーがすべて停止**される（`stopped_at`が入る）
3. 停止した案内の**送信待ちメールが取り消される**（`cancelled`）
4. 監査記録に`organization_status_changed`が残る（変更前後の値つき）

**`'pending'`（審査中へ戻す）でも 1〜4 は同じように起きます。** 「確認済みでない
団体の案内は届いたままにしない」を一貫させるためで、`'verified'` 以外へ変える
操作はすべて配信中オファーを止めます。疑わしい団体を審査中へ戻したのに案内が
生き続け、学生が返答して公式窓口まで開示される、という事故を防ぎます。

戻すときは同じRPCで`'verified'`を指定します。**個別オファーの停止は自動では
戻りません**（意図的）。戻す必要があるものだけ§4で明示的に戻してください。

## 4. 個別オファーの停止

団体全体ではなく、特定の案内だけを止めるときに使います。

```sql
-- 止める
select public.admin_set_offer_stopped('<delivery id>'::uuid, true, 'ops-1', '内容の確認中');
-- 戻す
select public.admin_set_offer_stopped('<delivery id>'::uuid, false, 'ops-1', '確認完了');
```

止めた案内は**受信箱から消えません**（D044）。学生側では「募集終了」と表示され、
新しい返答ができなくなり、既に「行ってみたい」を選んでいた人にも公式窓口を
返さなくなります。団体側の一覧にも「停止中」と表示されます（停止理由の本文は
団体へ渡しません）。

**団体が`verified`でないと、個別の案内を戻すことはできません**（`org_not_verified`）。
団体そのものに問題があって止めた場合、個別に戻すと公式窓口と返答導線が再び開いて
しまうためです。戻す順序は必ず「§3で団体を`verified`へ戻す → §4で必要な案内だけ戻す」です。

対象の`delivery id`は、団体名やイベント名から探せます。

```sql
select d.id, d.delivered_at, d.event_name, d.stopped_at, o.name
  from private.offer_deliveries d
  join public.organizations o on o.id = d.organization_id
 where o.name = '<団体名>'
 order by d.delivered_at desc;
```

## 5. 緊急停止（kill switch）

誤配信・不正利用・原因不明の異常が起きたとき、**全団体の新規配信を1操作で
止めます**。

```sql
-- 止める
select public.admin_set_delivery_paused(true, 'ops-1', '誤配信の調査中');
-- 戻す
select public.admin_set_delivery_paused(false, 'ops-1', null);
```

- 停止中の`send_offer`は`delivery_paused`で拒否されます。
- **新しい条件での対象規模の確認（preview）も止まります。** 不正利用がpreviewでの
  探索そのものである場合に、配信だけ止めても探索が続いてしまうためです。
  24時間以内に既に答えた同一条件は返します（団体が既に知っている値であり、
  新しい情報を渡さないため）。
- 判定は`private.offer_deliveries`と`private.offer_preview_cache`への**挿入トリガ**に
  あるため、RPCを通さない経路（管理スクリプト・将来の新RPC）でも止まります（D045）。
  トリガは`ENABLE ALWAYS`で、レプリカ・ダンプ復元の経路でも発火します。
- 拒否された送信はトランザクション全体がrollbackされ、**配信行も学生の週間受信枠の
  消費も残りません**。部分的な配信は起きません。
- **既に配信済みの案内は止まりません。** 配信済みのものを止めるには§3か§4を使います。

現在の状態は次で確認します。

```sql
select delivery_paused, paused_reason, updated_at from private.platform_controls;
```

## 6. 監査記録

```sql
select * from public.admin_list_audit(100);
```

記録するのは運営操作の「誰が・何を・なぜ」だけです。**学生のuser_id・メール・
氏名・希望条件・受信者一覧は列自体が存在しません**（D029・D043）。
`actor_label`と`reason`には、氏名・メールアドレス・学生個人を特定できる記述を
書かないでください（案件番号など、運営内で追える識別子を使います）。

`max_rows`は1〜1000の範囲外だと`invalid_admin_action`になります。
`actor_label`が60文字超、`reason`が200文字超のときも`invalid_admin_action`になります
（生の制約違反にすると、エラーのDETAILへ対象行の全列が展開されてログに残るため）。

### 監査として何がどこに残るか

`admin_audit_log`は**運営操作だけ**の記録です。他の3種類は既存の構造が担っています。

| 対象 | どこに残るか |
|---|---|
| 認証 | Supabase Authのログ（保持期間は短い。§7の注意を参照） |
| 配信 | `private.offer_deliveries` の `delivered_at` と `created_by_membership_id`（誰の団体の誰が作ったか）、`stopped_at` / `stopped_reason` |
| 通知 | `private.email_outbox` の `status` / `attempts` / `sent_at` / `last_error_code`（本文・宛先は保存しない・D041） |
| 権限変更 | `private.organization_invitations` の `created_by_membership_id` / `used_by_membership_id` / `invited_role` と `public.organization_memberships` の `joined_at` |
| 運営操作 | `private.admin_audit_log`（この文書の対象） |

いずれも**学生の希望条件・氏名・メールを含みません**（D029）。

## 7. 事故対応の手順（想定）

| 状況 | 最初にやること | 次に |
|---|---|---|
| 1つの案内に問題がある | §4でその案内を止める | 団体へ連絡し、必要なら§3 |
| 1団体が繰り返し問題を起こす | §3で団体を停止（配信中の案内も止まる） | 監査記録を残し、運営内で判断 |
| 特定の団体が対象人数を探っている疑い | §3でその団体を停止（previewも`org_not_verified`で止まる） | 監査記録を残す。全団体に及ぶ疑いなら§5 |
| 原因が分からない・広範囲 | §5で全体を止める | 調査し、原因の団体・案内を個別に止めてから全体を戻す |
| メール送信が止まっている | `select * from public.email_outbox_health();` | `docs/notifications.md`の運用手順へ |

**全体を戻す前に、原因の団体・案内を個別に止めておく**のが基本です。
全体停止を戻すと、止めていた団体以外の配信は即座に再開します。

## 8. この設計で守れていないこと（残余リスク）

- **運営画面UIが無い**。操作はSQL Editorから行うため、service_role権限を持つ
  人間の操作ミスを機械的に防げません。`actor_label`の正しさも運用に依存します。
- **停止の通知が無い**。団体は自分の画面を見て初めて停止に気づきます。
  メール等での能動的な通知はTask 017以降の課題です。
- **まとめメール（`daily_digest`）は取り消せません**（D044）。どの案内を含むかを
  保持しない設計のためで、本文に団体名・イベント名を含まないため誤解は生みませんが、
  停止直後に「受信箱に新しい案内があります」が届くことはあります。
- **監査記録の保持期間・削除方針が未定**です。Task 017で決めます。
- **緊急停止は配信済みの案内を止めません**（新規配信とpreviewだけを止めます）。
  配信済みのものを止めるには§3または§4を使います。
