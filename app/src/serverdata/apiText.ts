// Task 009のサーバーデータRPCのエラー→利用者向け定型文。
// orgApi.tsのorgApiErrorTextと同じ方針: サーバーの生メッセージ・ID・メールを画面へ出さない

export function serverErrorMessage(error: unknown): string {
  switch (serverErrorCode(error)) {
    case 'not_student':
      return '新入生としての登録が見つかりません。権限を追加してからお試しください。'
    case 'not_authorized':
      return 'この操作を行う権限がありません。'
    case 'not_university_user':
      return '大学メールで認証されたアカウントだけが利用できます。'
    case 'org_not_verified':
      return 'オファーの配信は、運営の認証が完了した団体だけが利用できます。'
    // Task 013: 意図的な停止を「通信環境を確認して」と案内すると、
    // 何度も再試行させたうえに原因を誤解させる。理由をそのまま伝える
    case 'delivery_paused':
      return '現在、システム全体で配信を一時停止しています。運営の対応が終わるまでお待ちください。'
    case 'offer_stopped':
      return 'この案内は募集を終了したため、返答できません。'
    case 'duplicate_event':
      return '同じイベントはすでに配信済みのため、再送できません'
    case 'weekly_limit_reached':
      return '今週の作成上限（3件）に達しているため送信できません'
    case 'no_recipients':
      return '現在の条件で配信できる新入生がいないため送信できません'
    case 'insufficient_audience':
      return '対象の新入生が5人未満のため、個人が特定されないよう送信できません。条件を広げてください'
    case 'preview_required':
      return '対象の確認から24時間が過ぎています。もう一度「対象を確認する」からやり直してください'
    case 'preview_quota_exceeded':
      return '対象人数の確認は24時間に20条件までです。しばらく時間をおいてからお試しください'
    case 'payload_too_large':
      return '入力が長すぎます。内容を短くしてからお試しください。'
    case 'invalid_offer':
      return 'オファーの内容に不備があります。入力を確認してください。'
    case 'invalid_passport':
      return '興味パスポートの内容を保存できませんでした。入力を確認してください。'
    case 'not_recipient':
      return 'この案内への操作は行えません。'
    // Task 014: 削除・脱退（D046〜D048）
    case 'last_owner':
      return 'あなたが唯一の代表者になっている団体があります。先に別の担当者を代表者にしてから、もう一度お試しください。'
    case 'not_member':
      return 'この団体に所属していません。'
    case 'passport_not_found':
      return '興味パスポートはすでに削除されています。'
    case 'nothing_to_delete':
      return '削除できるデータがありません。すでに削除されています。'
    // Task 015: 同意（D050）
    case 'consent_required':
      return '利用規約とプライバシーポリシーへの同意が必要です。同意してからお試しください。'
    case 'consent_version_mismatch':
      return '規約が更新されています。最新の内容を確認して、もう一度同意してください。'
    case 'invalid_org_contact':
      return '公式窓口は表示名50文字・連絡先100文字以内で入力してください。'
    default:
      return '処理に失敗しました。通信環境を確認して、もう一度お試しください。'
  }
}

// RPCのraise exceptionメッセージ（既知コード）だけを取り出す。未知の内容は'unknown'
export function serverErrorCode(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : ''
  const known = [
    'not_student',
    'not_authorized',
    'not_university_user',
    'org_not_verified',
    'delivery_paused',
    'offer_stopped',
    'duplicate_event',
    'weekly_limit_reached',
    'no_recipients',
    'insufficient_audience',
    'preview_required',
    'preview_quota_exceeded',
    'payload_too_large',
    'invalid_offer',
    'invalid_passport',
    'invalid_response',
    'not_recipient',
    'invalid_org_contact',
    'last_owner',
    'not_member',
    'passport_not_found',
    'nothing_to_delete',
    'consent_required',
    'consent_version_mismatch',
  ]
  return known.includes(message) ? message : 'unknown'
}
