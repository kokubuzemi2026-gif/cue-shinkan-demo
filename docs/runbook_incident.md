# 障害・事故対応手順

対象: CUE（仮）の運営者。**迷ったら「止める」を先に選ぶ。** 止めても受信済みの案内は消えない。

- 運営操作のSQLは `docs/operations.md` が正本
- migration・backup・secretは `docs/runbook_operations.md`

## 0. 最初の3つ

1. **止めるか決める。** 原因が分からない・広範囲なら、先に緊急停止する（`docs/operations.md` §5）
2. **時刻と事実を書き留める。** 誰が何を見て、何を実行したか。**学生のメール・氏名は書かない**
3. **health checkを見る。** 下記 §1

## 1. health check

service_role で1本だけ実行する（Supabase Dashboard → SQL Editor）。

```sql
select * from public.platform_health();
```

| 列 | 正常 | 異常のとき見るところ |
|---|---|---|
| `delivery_paused` | `false` | `true` なら誰かが緊急停止している。`admin_list_audit` で誰がいつ止めたか確認（本書 §5） |
| `pending_organizations` | 運営の作業待ち件数 | 増え続けるなら確認作業が滞っている（`docs/operations.md` §2） |
| `outbox_pending` | 0〜少数 | 増え続けるなら送信ワーカーが動いていない（§2） |
| `outbox_failed` | 0 | 1以上なら送信に失敗している（§2） |
| `outbox_stuck_sending` | 0 | 1以上ならワーカーが途中で落ちた（§2） |
| `oldest_pending_overdue_minutes` | **負値または15分以内** | **負値は正常**（まとめメールのように将来の時刻を予約している行がある）。大きな正の値ならワーカーの停止か詰まり（§2） |
| `quota_over_limit` | **0** | **1以上は設計上起きない。** 枠の確保が壊れている（§3） |
| `stale_preview_rows` | 増減する | 掃除の目安。異常ではない |
| `admin_audit_rows` | 増える一方 | 年1回の剪定の目安（`docs/runbook_operations.md` §8） |

`platform_health()` は **件数と時刻しか返さない**。学生の希望条件・メール・受信者IDは含まない（D029）。

## 2. メール通知が届かない

### 確認

```sql
select * from public.email_outbox_health();
```

| 症状 | 見立て | 対応 |
|---|---|---|
| `pending_count` が増え続け、`sending_count` が0 | ワーカーが動いていない | Supabase Dashboard → Edge Functions → `send-notifications` のスケジュールとログを確認 |
| `sending_count` が減らない（`oldest_sending_at` が古い） | ワーカーが送信中に落ちた | 猶予を過ぎた行はDB側が自動で拾い直す。何度も起きるならログを確認 |
| `failed_count` が増える | SMTPの認証・接続・宛先の問題 | Function のログで `errorCode` を見る（`smtp_timeout` / `smtp_auth` など） |
| すべて0なのに届かない | 通知設定が `off` / 迷惑メール判定 | 本人の設定を確認。SMTPの送信元ドメイン設定（SPF/DKIM）を確認 |

### ログの見方

送信ワーカーのログには**宛先・本文・SMTP資格情報を出していない**（D041）。出るのは
`outboxId` / `kind` / `attempt` / `result` / `errorCode` だけ。
「どの学生に届かなかったか」はログからは分からない。`outboxId` から
`private.email_outbox` を引く。

**メールが送れないことは、オファー配信の失敗ではない。** 送信は配信トランザクションの
外にあり、失敗しても配信そのものは成立している（受信箱には届いている）。

## 2.5 ログインできない・OTPが届かない

**認証（Auth）の生存は、DBのRPCでは確認できない。** `platform_health()` が返すのは
DBから観測できる兆候だけで、OTPを送っているのは Supabase Auth 自身のSMTPであり、
`email_outbox`（CUEの通知メール）とは**完全に別経路**である。

### まず見る

```sql
select confirmed_identities, newest_identity_at,
       non_university_identities, orphan_identities
  from public.platform_health();
```

| 見え方 | 見立て |
|---|---|
| `newest_identity_at` が数日前で止まっている | 新規登録が成立していない。Auth側の異常を疑う |
| `non_university_identities` が急に増えた | ドメインゲートを試されている（ゲート自体は効いている） |
| `orphan_identities` が増える一方 | 登録直後に離脱している。同意画面やパスポートで詰まっている可能性 |

### 生存の確認（人間の手順）

**実際にOTPを往復させるしかない。** 運営者本人の大学メールで、

1. 公開URLで「6桁コードを送る」が成功するか
2. **実際にメールが届くか**（迷惑メールも見る）
3. コードでログインできるか

届かない・入れないときは Supabase Dashboard で次を確認する。

| 確認先 | 見るもの |
|---|---|
| Authentication → Providers | Email が有効か。OTP（Email OTP）が有効か |
| Authentication → URL Configuration | Site URL と Redirect URLs に公開ドメインが入っているか |
| Authentication → Emails / SMTP | カスタムSMTPの設定と送信元。**組込みSMTPは低レートで、組織メンバー宛にしか届かない** |
| Logs → Auth | 直近のエラー。**Freeプランは保持期間が短い**ので当日中に見る |
| Project の状態 | **Freeプロジェクトは約1週間の非アクティブでpauseされ得る**。停止していたらRestore |

**これは公開後のsmoke testの2番目と同じ手順**（`tasks/018-release-v1.md`）。

## 3. quota（週間受信枠）の異常

`platform_health()` の `quota_over_limit` が1以上のとき。**設計上は起きない。**

**ただし先に確認する。** `window_count` は配信時にしか再計算されない観測値で、
`reception_weekly_limit` は**本人がいつでも下げられる**。
「3件受け取ったあとに上限を1へ下げた」は正常な操作であり、異常ではない。
この誤検知を避けるため、RPCは**最後の配信より後にパスポートが更新された行を除いて**いるが、
数え方の前提が崩れていないかを、下の抽出で `last_delivered_at` と
`updated_at` の前後関係を見て確かめる。

```sql
-- 対象を特定する（学生の識別子は必要最小限にとどめる）
select q.window_count, p.reception_weekly_limit,
       q.window_started_at, q.last_delivered_at, p.updated_at as passport_updated_at
  from private.student_delivery_quota q
  join public.student_passports p on p.user_id = q.user_id
 where q.window_count > p.reception_weekly_limit
 order by q.last_delivered_at desc;
```

1. `passport_updated_at` が `last_delivered_at` より**後**なら、本人が上限を下げただけ。
   異常ではないので止めない（RPC側で除外しているので、ここに出ること自体が想定外）
2. そうでなければ**緊急停止**（`docs/operations.md` §5）。配信を続けると被害が広がる
3. `send_offer` の枠確保（`FOR UPDATE`）が壊れていないかを確認する。
   直近のmigrationで `send_offer` を作り直していないか
4. 直せるまで停止を維持する

「想定外の消費」の見方: 同じ学生の `window_count` が短時間で増える、
`window_started_at` が更新されないまま `window_count` だけ増える、など。

## 4. 差分攻撃・探索の疑い

団体が対象人数を細かく変えて何度も試している疑いがあるとき。

```sql
-- 団体ごとのpreview条件数（24時間で20条件の上限がある）
select organization_id, count(*) as conditions, max(last_accessed_at) as last_seen
  from private.offer_preview_cache
 where first_computed_at > now() - interval '24 hours'
 group by organization_id
 order by conditions desc;
```

上限に張り付いている団体があれば、`docs/operations.md` §3 で停止する。
停止すると preview も `org_not_verified` で止まる。

## 5. 誰が何をしたかを確認する

```sql
select * from public.admin_list_audit(100);
```

運営操作（団体の確認・停止・オファー停止・緊急停止）が時系列で出る。
**学生の個人情報は入っていない**（D043）。`actor_label` は運用で決めた識別子。

削除の記録は主体を持たない日次集計。

```sql
select * from private.deletion_audit_log order by occurred_on desc limit 30;
```

## 6. 状況別の初手

| 状況 | 最初にやること | 次に |
|---|---|---|
| 1つの案内に問題がある | `docs/operations.md` §4 でその案内を止める | 団体へ連絡。必要なら `docs/operations.md` §3 |
| 1団体が繰り返し問題を起こす | `docs/operations.md` §3 で団体を停止 | 監査記録を残し、運営内で判断 |
| 対象人数を探っている疑い | `docs/operations.md` §3 で団体を停止（previewも止まる） | 本書 §4 の抽出を保存 |
| 原因が分からない・広範囲 | **`docs/operations.md` §5 で全体を止める** | 調査し、個別に止めてから全体を戻す |
| メールが止まっている | 本書 §2 | Edge Functionのログ |
| ログインできない・OTPが届かない | 本書 §2.5 | Supabase Dashboard の Authentication |
| quotaが上限を超えている | 本書 §3（**まず本人の設定変更を確認**） | 必要なら `docs/operations.md` §5 |
| secretが漏れた疑い | **緊急停止** → secret rotation | `docs/runbook_operations.md` §6 |
| 個人情報が漏れた疑い | **緊急停止** → 影響範囲の特定 | 記録を残す。**チャット・PRへ実データを貼らない** |

**全体を戻す前に、原因の団体・案内を個別に止めておく。**
全体停止を戻すと、止めていた団体以外の配信は即座に再開する。

## 7. 事後

1. 何が起きたか、いつ気づいたか、何をしたかを時系列で残す（個人情報を含めない）
2. 同じことが起きないように、**テストか構造で止められないか**を検討する
3. 直せないものは `docs/launch_plan.md` の既知リスクへ追記する
