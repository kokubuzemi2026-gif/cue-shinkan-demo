// Task 010: メール送信ワーカー（Supabase Edge Function）。
//
// 役割は「outboxを1バッチ取り出して送り、結果を書き戻す」だけ。
// 対象の決定・冪等化・backoff・上限はすべてDB側（claim_email_batch / complete_email）が持つ。
//
// 安全上の約束（docs/notifications.md）:
// - service role keyとSMTP資格情報は環境変数からのみ読み、ログ・応答へ出さない
// - 宛先メールアドレスをログ・応答へ出さない（件数だけを返す）
// - 本文はemailTemplate.tsが組み立てる。団体名・希望条件・返答状態を含まない
// - 例外は短い分類コードへ落としてからDBへ渡す（SMTPの生メッセージを保存しない）
//
// 実行はスケジューラ（Supabaseのcron）から。1回の呼び出しで最大 BATCH_SIZE 件を処理する。
import { createClient } from 'jsr:@supabase/supabase-js@2'
// SMTPはnodemailer（Supabase公式のEdge Function SMTPサンプルと同じ構成・D058）。
// denomailer 1.6.0はEdge Runtime上でSMTP会話の途中に
// `Interrupted: operation canceled` でストリームが切られ、送信できなかった
import nodemailer from 'npm:nodemailer@9.0.6'

import { buildEmail, classifyError, logSafe, type EmailKind } from './emailTemplate.ts'

const BATCH_SIZE = 50

type ClaimedRow = {
  outbox_id: string
  kind: EmailKind
  recipient_email: string
  offer_count: number
  attempt: number
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (value === undefined || value === '') {
    // 値そのものは出さない。どの設定が足りないかだけを示す
    throw new Error(`missing_env:${name}`)
  }
  return value
}

Deno.serve(async () => {
  let sent = 0
  let failed = 0

  let supabase
  let smtp
  let from: string
  let appUrl: string
  try {
    supabase = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false } },
    )
    // SMTPの資格情報と全学生の宛先がこの接続に載るため、暗号化を必須にする。
    // 465は最初からTLS（secure）、それ以外はSTARTTLSでの昇格を必須にする
    // （requireTLS）。平文へ落とす設定は用意しない
    const port = Number(requiredEnv('CUE_SMTP_PORT'))
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('invalid_env:CUE_SMTP_PORT')
    }
    smtp = nodemailer.createTransport({
      host: requiredEnv('CUE_SMTP_HOST'),
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: {
        user: requiredEnv('CUE_SMTP_USER'),
        pass: requiredEnv('CUE_SMTP_PASSWORD'),
      },
    })
    from = requiredEnv('CUE_SMTP_FROM')
    appUrl = requiredEnv('CUE_APP_URL')
  } catch (error) {
    // 設定不足・不正だけを名前で示す。それ以外は固定文言に落として、
    // ライブラリの例外メッセージ（URLや資格情報を含み得る）をログへ出さない
    const raw = error instanceof Error ? error.message : ''
    const code =
      raw.startsWith('missing_env:') || raw.startsWith('invalid_env:') ? raw : 'setup_failed'
    console.error(`send-notifications setup failed: ${code}`)
    return Response.json({ error: 'setup_failed' }, { status: 500 })
  }

  const { data, error } = await supabase.rpc('claim_email_batch', { batch_size: BATCH_SIZE })
  if (error) {
    console.error('send-notifications claim failed')
    return Response.json({ error: 'claim_failed' }, { status: 500 })
  }

  for (const row of (data ?? []) as ClaimedRow[]) {
    const mail = buildEmail({ kind: row.kind, offerCount: row.offer_count, appUrl })
    try {
      await smtp.sendMail({
        from,
        to: row.recipient_email,
        subject: mail.subject,
        text: mail.text,
      })
      const { error: completeError } = await supabase.rpc('complete_email', {
        outbox_id: row.outbox_id,
        succeeded: true,
      })
      if (completeError) {
        // 書き戻しに失敗するとsendingのまま残る。DB側のリース回収が拾い直すが、
        // 気づけるようにログへ残す（宛先・本文は出さない）
        console.error(`send-notifications complete failed outbox=${row.outbox_id}`)
      }
      sent += 1
      console.log(
        logSafe({ outboxId: row.outbox_id, kind: row.kind, attempt: row.attempt, result: 'sent' }),
      )
    } catch (sendError) {
      const errorCode = classifyError(sendError)
      const { error: completeError } = await supabase.rpc('complete_email', {
        outbox_id: row.outbox_id,
        succeeded: false,
        error_code: errorCode,
      })
      if (completeError) {
        console.error(`send-notifications complete failed outbox=${row.outbox_id}`)
      }
      failed += 1
      console.error(
        logSafe({
          outboxId: row.outbox_id,
          kind: row.kind,
          attempt: row.attempt,
          result: 'failed',
          errorCode,
        }),
      )
    }
  }

  try {
    smtp.close()
  } catch {
    // 切断の失敗は送信結果に影響しない
  }

  // 応答にも宛先・本文を含めない
  return Response.json({ sent, failed })
})
