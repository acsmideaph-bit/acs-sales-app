import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, AlertCircle, Camera, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { templateFor, normalizeFormData } from '../lib/fcrTemplates'
import { buildMinutes } from '../lib/fcrMinutes'
import { fmt, fmtDateTime } from '../lib/dates'
import { MinutesView } from '../components/MinutesView'
import { Spinner } from '../components/ui'
import logo from '../lib/cmip-logo.jpg'

// Public page, no login. Reads and writes only through SECURITY DEFINER RPCs
// that match the exact token, so nothing else can be browsed from here.
export function Acknowledge() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading | notfound | expired | ready | done
  const [d, setD] = useState(null)
  const [name, setName] = useState('')
  const [editName, setEditName] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [photo, setPhoto] = useState(null) // { url?, taken_at, place, purged? }

  useEffect(() => {
    supabase.rpc('get_fcr_ack_details', { p_token: token }).then(({ data, error: e }) => {
      if (e || !data?.length) { setState('notfound'); return }
      const row = data[0]
      setD(row)
      // 30 days after confirmation the link stops showing the minutes.
      if (row.ack_status === 'expired') { setState('expired'); return }
      setName(row.attendee_name || ''); setEditName(!row.attendee_name)
      setState(row.ack_status === 'acknowledged' ? 'done' : 'ready')
    })
    // The meeting photo comes from the ack-photo function (short-lived signed
    // URL, token-checked). If it can't load, the page still works without it.
    supabase.functions.invoke('ack-photo', { body: { token } })
      .then(({ data }) => { if (data?.ok && data.photo) setPhoto(data.photo) })
      .catch(() => {})
  }, [token])

  const confirmIt = async () => {
    if (!name.trim()) return
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc('acknowledge_fcr', { p_token: token, p_name: name.trim(), p_comment: comment.trim() || null })
    setBusy(false)
    if (e) { setError('Something went wrong. Please try again.'); return }
    if (!data) { setError('This link has already been used or was replaced by a newer one. Please contact your Concepcion Midea representative.'); return }
    setD((x) => ({ ...x, ack_status: 'acknowledged', acknowledged_name: name.trim(), acknowledged_comment: comment.trim(), acknowledged_at: new Date().toISOString() }))
    setState('done')
  }

  if (state === 'loading') return <Spinner />

  const shell = (children) => (
    <div className="min-h-screen bg-canvas px-4 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <img src={logo} alt="Concepcion Midea Inc." className="h-10 w-auto" />
          <div className="leading-tight"><p className="text-[13px] font-semibold">Concepcion Midea Inc. Philippines</p><p className="text-[12px] text-ink-3">Meeting confirmation</p></div>
        </div>
        {children}
      </div>
    </div>
  )

  if (state === 'notfound') return shell(
    <div className="panel p-8 text-center">
      <AlertCircle size={32} className="mx-auto text-ink-4 mb-3" />
      <h1 className="text-[17px]">This link is not valid</h1>
      <p className="text-[13px] text-ink-3 mt-2">It may have been replaced by a newer link after the report was updated. Please ask your Concepcion Midea representative to send it again.</p>
    </div>,
  )

  if (state === 'expired') return shell(
    <div className="panel p-8 text-center">
      <CheckCircle2 size={32} className="mx-auto text-ok mb-3" />
      <h1 className="text-[17px]">These minutes were confirmed</h1>
      <p className="text-[13px] text-ink-3 mt-2">
        The meeting{d.visit_date ? ` on ${fmt(d.visit_date)}` : ''} was confirmed on {fmtDateTime(d.acknowledged_at)}.
        For security, this link stops showing the minutes 30 days after confirmation.
        If you need a copy, please ask {d.submitter_name || 'your Concepcion Midea representative'}.
      </p>
    </div>,
  )

  const t = templateFor(d.template_id, d.template_version)
  const minutes = buildMinutes({
    fcr: { ...d, form_data: normalizeFormData(t, d.form_data) },
    submitterName: d.submitter_name, submitterPosition: d.submitter_position,
  })

  return shell(
    <div className="panel">
      <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-line">
        <h1 className="text-[19px]">{d.customer_info?.company_name || 'Minutes of the Meeting'}</h1>
        <p className="text-[13px] text-ink-3 mt-1">Please review the minutes of your meeting with {d.submitter_name}. If they are accurate, confirm below. No login is needed.</p>
      </div>
      <div className="px-5 sm:px-6 py-5"><MinutesView minutes={minutes} /></div>
      {photo && (
        <div className="px-5 sm:px-6 pb-5">
          <p className="text-2xs font-semibold uppercase tracking-[0.05em] text-ink-3 mb-2 flex items-center gap-1.5"><Camera size={12} /> Photo from the meeting</p>
          {photo.purged ? (
            <p className="text-[13px] text-ink-3">The photo was deleted after 60 days, as scheduled.</p>
          ) : (
            <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt="Photo taken during the meeting" className="w-full rounded border border-line object-contain max-h-96 bg-canvas" /></a>
          )}
          <p className="text-[12px] text-ink-3 mt-2 flex items-start gap-1">
            <MapPin size={12} className="mt-0.5 shrink-0" />
            <span>{fmtDateTime(photo.taken_at)}{photo.place ? ` · ${photo.place}` : ''}</span>
          </p>
        </div>
      )}
      <div className="px-5 sm:px-6 py-5 border-t border-line bg-canvas/60 rounded-b-md">
        {state === 'done' ? (
          <div className="flex gap-3">
            <CheckCircle2 size={22} className="text-ok flex-shrink-0" />
            <div>
              <p className="font-medium text-ok">Confirmed by {d.acknowledged_name}</p>
              <p className="text-[12px] text-ink-3">{fmtDateTime(d.acknowledged_at)}. Thank you, nothing else is needed. You can close this page.</p>
              {d.acknowledged_comment && <p className="text-[13px] mt-2 text-ink-2">Your comment: {d.acknowledged_comment}</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {editName ? (
              <div><label className="label" htmlFor="ack-name">Your full name</label><input id="ack-name" className="input h-10 text-[15px]" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
            ) : (
              <p className="text-[14px]">Confirming as <strong>{name}</strong>. <button className="text-accent hover:underline" onClick={() => setEditName(true)}>Not you?</button></p>
            )}
            <div>
              <label className="label" htmlFor="ack-comment">Comment or correction (optional)</label>
              <textarea id="ack-comment" className="input min-h-[80px] text-[14px]" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything to add or correct?" />
            </div>
            {error && <p className="text-[13px] text-bad">{error}</p>}
            <button className="btn-primary w-full h-11 text-[15px]" disabled={!name.trim() || busy} onClick={confirmIt}>{busy ? 'Confirming…' : photo && !photo.purged ? 'Confirm the minutes and photo' : 'Confirm these minutes'}</button>
            <p className="text-2xs text-ink-4 text-center">Your name, the time and any comment are recorded with the report.{photo && !photo.purged ? ' By confirming, you also confirm the photo above was taken at this meeting.' : ''} The meeting photo is kept with Concepcion Midea's internal record of this visit for 60 days.</p>
          </div>
        )}
      </div>
    </div>,
  )
}
