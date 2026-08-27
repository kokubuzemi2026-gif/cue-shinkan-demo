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
    case 'duplicate_event':
      return '同じイベントはすでに配信済みのため、再送できません'
    case 'weekly_limit_reached':
      return '今週の作成上限（3件）に達しているため送信できません'
    case 'no_recipients':
      return '現在の条件で配信できる新入生がいないため送信できません'
    case 'insufficient_audience':
      return '対象の新入生が5人未満のため、個人が特定されないよう送信できません。条件を広げてください'
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
    'duplicate_event',
    'weekly_limit_reached',
    'no_recipients',
    'insufficient_audience',
    'preview_quota_exceeded',
    'payload_too_large',
    'invalid_offer',
    'invalid_passport',
    'invalid_response',
    'not_recipient',
    'invalid_org_contact',
  ]
  return known.includes(message) ? message : 'unknown'
}
