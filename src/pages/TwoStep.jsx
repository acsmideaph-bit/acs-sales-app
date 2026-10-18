import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Spinner } from '../components/ui'

// Two-step login for admins (Oct 18, 2026 security review). Admins see all
// accounts, targets and sales, so a password alone is not enough: after the
// password they enter a 6-digit code from an authenticator app (Google
// Authenticator, Microsoft Authenticator, 1Password...). Supabase TOTP, free.
// The database enforces it too: admin rights need an aal2 session.
export function TwoStep() {
  const { user, signOut, refreshAal } = useAuth()
  const [mode, setMode] = useState('loading') // loading | enroll | verify | error
  const [factorId, setFactorId] = useState(null)
  const [qr, setQr] = useState(null)
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice; enrol once
    started.current = true
    ;(async () => {
      const { data, error: e } = await supabase.auth.mfa.listFactors()
      if (e) { setError(e.message); setMode('error'); return }
      const verified = data.totp?.[0]
      if (verified) { setFactorId(verified.id); setMode('verify'); return }
      // A setup that was started but never finished: discard it and start over.
      for (const f of data.all || []) {
        if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data: en, error: e2 } = await supabase.auth.mfa.enroll({
        factorType: 'totp', issuer: 'ACS Sales Ops', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      })
      if (e2) { setError(e2.message); setMode('error'); return }
      // supabase-js hands back "data:image/svg+xml;utf-8,<svg…>" unencoded; a
      // "#" in the SVG (colour values) would cut the image short. Encode it.
      const svg = String(en.totp.qr_code || '').replace(/^data:image\/svg\+xml;[^,]*,/, '')
      setFactorId(en.id); setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`); setSecret(en.totp.secret); setMode('enroll')
    })()
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    const c = code.replace(/\D/g, '')
    if (c.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return }
    setBusy(true); setError('')
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: c })
    if (err) {
      setBusy(false); setCode('')
      setError(/invalid|expired|code/i.test(err.message)
        ? 'That code did not match. Codes change every 30 seconds; enter the one showing now.'
        : err.message)
      return
    }
    await refreshAal()
  }

  if (mode === 'loading') return <Spinner label="Checking two-step login" />

  const codeForm = (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label" htmlFor="otp">6-digit code</label>
        <input id="otp" className="input h-10 text-[18px] tracking-[0.3em] tabular-nums text-center" inputMode="numeric"
          autoComplete="one-time-code" maxLength={7} value={code} autoFocus
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} />
      </div>
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <button className="btn-primary w-full h-9" disabled={busy}>{busy ? 'Checking…' : mode === 'enroll' ? 'Turn on two-step login' : 'Continue'}</button>
    </form>
  )

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <div className="panel w-full max-w-[400px] p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={18} className="text-accent" />
          <h1 className="text-[17px]">Two-step login</h1>
        </div>

        {mode === 'error' && (
          <>
            <p className="text-[13px] text-bad">Two-step login could not start: {error}</p>
            <button className="btn-secondary w-full h-9 mt-4" onClick={() => window.location.reload()}>Try again</button>
          </>
        )}

        {mode === 'verify' && (
          <>
            <p className="text-[13px] text-ink-2 mb-4">Open your authenticator app and enter the code for <strong>ACS Sales Ops</strong> ({user?.email}).</p>
            {codeForm}
          </>
        )}

        {mode === 'enroll' && (
          <>
            <p className="text-[13px] text-ink-2">Admin accounts see every account, target and sales figure, so they need a second step after the password. Set it up once:</p>
            <ol className="text-[13px] text-ink-2 mt-3 space-y-1.5 list-decimal pl-5">
              <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar).</li>
              <li>In the app, add an account and scan this code.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="my-4 flex justify-center">
              <img src={qr} alt="QR code for your authenticator app" width={176} height={176} className="border border-line rounded bg-white p-2" />
            </div>
            <details className="mb-4 text-[12px] text-ink-3">
              <summary className="cursor-pointer select-none">Can't scan? Enter this key instead</summary>
              <p className="mt-2 font-mono text-[13px] text-ink break-all select-all bg-canvas border border-line rounded px-2 py-1.5">{secret}</p>
            </details>
            {codeForm}
          </>
        )}

        <div className="mt-5 pt-4 border-t border-line flex items-center justify-between gap-3 text-[12px]">
          <span className="text-ink-3">Lost your phone? Ask the app owner to reset it.</span>
          <button className="text-accent hover:underline whitespace-nowrap" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  )
}
