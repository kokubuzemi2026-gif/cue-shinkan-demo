// 新入生コンテキストの準備中画面。
// 既存のlocalStorageデモ（興味パスポート・受信箱）はユーザーIDで分離されていないため、
// 認証済みシェルからはマウントしない。Task 009でこのアカウントへ接続される
export function StudentPreparing() {
  return (
    <>
      <h1 className="page-title">新入生ホーム</h1>
      <section className="placeholder-card" aria-label="準備中の案内">
        <span className="placeholder-chip">準備中</span>
        <p className="placeholder-text">
          アカウントの登録が完了しました。興味パスポートの登録と、興味に合う団体からの新歓案内の受信は、次の開発段階（サーバーデータ移行）でこのアカウントに接続されます。
        </p>
        <p className="placeholder-text">
          登録に使うのは大学メールだけです。氏名・学籍番号を集めることはなく、団体側にあなたのメールアドレスが表示されることもありません。
        </p>
      </section>
    </>
  )
}
