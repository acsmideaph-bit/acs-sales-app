import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase, rpc } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Modal, Field } from './ui'

// Change password + where digests are sent (notify_email, MBT lesson 2).
// Also opens automatically after a password-reset link is followed.
export function AccountSettings({ open, onClose }) {
  const { profile, recovery, endRecovery, refreshProfile, isAdmin, twoStepOn } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [notify, setNotify] = useState('')
  const [busy, setBusy] = useState(false)
  const show = open || recovery
  useEffect(() => { if (show) { setPw(''); setPw2(''); setNotify(profile?.notify_email || '') } }, [show, profile])

  const close = () => { endRecovery(); onClose?.() }
  const save = async () => {
    setBusy(true)
    try {
      if (pw || pw2) {
        // Same rule as the Supabase Auth password policy (security review, Oct 18, 2026).
        if (pw.length < 10 || !/[a-z]/i.test(pw) || !/\d/.test(pw)) throw new Error('Use at least 10 characters, with letters and at least one number.')
        if (pw !== pw2) throw new Error('The two passwords do not match.')
        const { error } = await supabase.auth.updateUser({ password: pw })
        if (error) throw error
      }
      if (!recovery && (notify || '') !== (profile?.notify_email || '')) {
        await rpc('set_my_notify_email', { p_email: notify.trim() || null })
        await refreshProfile()
      }
      toast.success('Saved')
      close()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={show} onClose={close} title={recovery ? 'Set a new password' : 'My account'}
      footer={<><button className="btn-secondary" onClick={close}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="space-y-4">
        <Field label="New password" hint={`At least 10 characters, letters and a number.${recovery ? '' : ' Leave blank to keep your current password.'}`}>
          <input type="password" className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" className="input" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        {!recovery && isAdmin && (
          <p className="text-[13px] text-ink-2">Two-step login: <strong className={twoStepOn ? 'text-ok' : ''}>{twoStepOn ? 'On' : 'Off'}</strong> (authenticator app, required for admins).</p>
        )}
        {!recovery && (
          <Field label="Send report emails to" hint={`Weekly and monthly digests go here. Blank = ${profile?.email}.`}>
            <input type="email" className="input" value={notify} onChange={(e) => setNotify(e.target.value)} placeholder={profile?.email} />
          </Field>
        )}
      </div>
    </Modal>
  )
}
