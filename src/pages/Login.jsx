import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try { await signIn(email.trim(), password) }
    catch (err) { setError(err.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : err.message) }
    finally { setBusy(false) }
  }

  const reset = async () => {
    if (!email.trim()) { setError('Enter your email first, then click "Forgot password".'); return }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + window.location.pathname })
    if (err) setError(err.message)
    else toast.success('If that email is registered, a reset link is on its way.')
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_440px] bg-white">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-canvas border-r border-line">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-accent text-white text-[11px] font-bold flex items-center justify-center">ACS</div>
          <span className="text-[14px] font-semibold">ACS Sales Operations</span>
        </div>
        <div className="max-w-md">
          <p className="text-[28px] font-semibold tracking-[-0.02em] leading-tight">Plan the month. Report every visit. Get it confirmed.</p>
          <p className="text-[14px] text-ink-3 mt-3 leading-relaxed">MCP planning, Field Contact Reports with customer acknowledgement, and approvals by your Regional Sales Manager, in one place.</p>
        </div>
        <p className="text-[12px] text-ink-4">Concepcion Midea Inc. Philippines · AC Specialist team</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-[320px] space-y-4">
          <div>
            <h1>Sign in</h1>
            <p className="text-[13px] text-ink-3 mt-1">Use your company email.</p>
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" className="input h-9" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="current-password" className="input h-9" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-[13px] text-bad">{error}</p>}
          <button className="btn-primary w-full h-9" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="btn-ghost w-full text-ink-3" onClick={reset}>Forgot password</button>
        </form>
      </div>
    </div>
  )
}
