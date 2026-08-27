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
| `delivery_paused` | `false` | `true` なら誰かが緊急停止している。`admin_list_audit` で誰がいつ止めたか確認（§5） |
| `pending_organizations` | 運営の作業待ち件数 | 増え続けるなら確認作業が滞っている（`docs/operations.md` §2） |
| `outbox_pending` | 0〜少数 | 増え続けるなら送信ワーカーが動いていない（§2） |
| `outbox_failed` | 0 | 1以上なら送信に失敗している（§2） |
| `outbox_stuck_sending` | 0 | 1以上ならワーカーが途中で落ちた（§2） |
| `oldest_pending_age_minutes` | 15分以内 | 大きいならワーカーの停止か詰まり（§2） |
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

## 3. quota（週間受信枠）の異常

`platform_health()` の `quota_over_limit` が1以上のとき。**設計上は起きない。**

```sql
-- 対象を特定する（学生の識別子は必要最小限にとどめる）
select q.window_count, p.reception_weekly_limit, q.window_started_at, q.updated_at
  from private.student_delivery_quota q
  join public.student_passports p on p.user_id = q.user_id
 where q.window_count > p.reception_weekly_limit;
```

1. **まず緊急停止**（`docs/operations.md` §5）。配信を続けると被害が広がる
2. `send_offer` の枠確保（`FOR UPDATE`）が壊れていないかを確認する。
   直近のmigrationで `send_offer` を作り直していないか
3. 直せるまで停止を維持する

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
| 1つの案内に問題がある | `docs/operations.md` §4 でその案内を止める | 団体へ連絡。必要なら §3 |
| 1団体が繰り返し問題を起こす | §3 で団体を停止 | 監査記録を残し、運営内で判断 |
| 対象人数を探っている疑い | §3 で団体を停止（previewも止まる） | 上記 §4 の抽出を保存 |
| 原因が分からない・広範囲 | **§5 で全体を止める** | 調査し、個別に止めてから全体を戻す |
| メールが止まっている | 上記 §2 | Edge Functionのログ |
| quotaが上限を超えている | **緊急停止** | 上記 §3 |
| secretが漏れた疑い | **緊急停止** → secret rotation | `docs/runbook_operations.md` §6 |
| 個人情報が漏れた疑い | **緊急停止** → 影響範囲の特定 | 記録を残す。**チャット・PRへ実データを貼らない** |

**全体を戻す前に、原因の団体・案内を個別に止めておく。**
全体停止を戻すと、止めていた団体以外の配信は即座に再開する。

## 7. 事後

1. 何が起きたか、いつ気づいたか、何をしたかを時系列で残す（個人情報を含めない）
2. 同じことが起きないように、**テストか構造で止められないか**を検討する
3. 直せないものは `docs/launch_plan.md` の既知リスクへ追記する
