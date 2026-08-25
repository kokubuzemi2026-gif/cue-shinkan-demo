// Supabase接続設定（VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY）が無いときの
// 安全な案内画面。クラッシュ・白画面にせず、デモ実装へもフォールバックしない
export function SetupNotice() {
  return (
    <main className="auth-main">
      <h1 className="page-title">接続設定が必要です</h1>
      <section className="auth-card" aria-label="設定手順の案内">
        <p className="auth-text">
          このビルドにはSupabaseの接続設定がありません。開発者は次の手順で設定してください。
        </p>
        <ol className="setup-steps">
          <li>
            <code>app/</code>で<code>npm run db:start</code>を実行する（Dockerが必要）
          </li>
          <li>
            表示されたAPI URLとpublishable keyを<code>app/.env.local</code>へ転記する
            （雛形は<code>app/.env.example</code>）
          </li>
          <li>
            <code>npm run dev</code>を再起動する
          </li>
        </ol>
        <p className="auth-hint">
          secret keyやservice-role keyは使いません。設定してよいのは上記の2値だけです。
        </p>
      </section>
    </main>
  )
}
