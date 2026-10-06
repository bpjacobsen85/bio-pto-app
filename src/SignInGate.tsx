import { Leaf, ShieldCheck } from 'lucide-react'

type SignInGateProps = {
  status: 'idle' | 'checking' | 'signing-in' | 'error'
  message: string
  onSignIn: () => void
}

export function SignInGate({ status, message, onSignIn }: SignInGateProps) {
  const checking = status === 'checking'
  const signingIn = status === 'signing-in'

  return (
    <main className="auth-gate">
      <div className="auth-card">
        <span className="home-logo auth-logo"><Leaf size={26} /></span>
        <h1>Potential to Occur</h1>
        <p className="app-subtitle">Species screening</p>

        {checking ? (
          <p className="auth-checking">Checking your session…</p>
        ) : (
          <>
            <p className="auth-copy">Sign in with your Insignia ArcGIS account to continue.</p>
            <button
              type="button"
              className="primary-button auth-button"
              onClick={onSignIn}
              disabled={signingIn}
            >
              <ShieldCheck size={17} />
              {signingIn ? 'Signing in…' : 'Sign in with ArcGIS'}
            </button>
            {status === 'error' && (
              <p className="auth-error-text">{message || 'Sign-in failed. Please try again.'}</p>
            )}
          </>
        )}
      </div>
    </main>
  )
}
