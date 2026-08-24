import {
  isSameContext,
  type AccountContext,
  type MyAccount,
} from '../account/contextModel'

type ContextSwitcherProps = {
  account: MyAccount
  contexts: AccountContext[]
  active: AccountContext
  onSelect: (context: AccountContext) => void
}

function contextLabel(context: AccountContext, account: MyAccount): string {
  if (context.kind === 'student') return '新入生'
  const membership = account.memberships.find(
    (candidate) => candidate.organizationId === context.organizationId,
  )
  return membership?.organizationName ?? '団体'
}

// 新入生⇄所属団体の表示切替。UI状態のみで、認可は常にサーバーRLS/RPCが判定する
export function ContextSwitcher({ account, contexts, active, onSelect }: ContextSwitcherProps) {
  if (contexts.length <= 1) return null
  return (
    <div className="context-switcher" role="group" aria-label="利用モードの切替">
      {contexts.map((context) => {
        const key = context.kind === 'student' ? 'student' : `org:${context.organizationId}`
        return (
          <button
            key={key}
            type="button"
            className="context-switcher-button"
            aria-pressed={isSameContext(context, active)}
            onClick={() => onSelect(context)}
          >
            {contextLabel(context, account)}
          </button>
        )
      })}
    </div>
  )
}
