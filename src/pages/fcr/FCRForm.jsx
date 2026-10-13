import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft, Save, Send, Mail, Link2, RefreshCw, FileDown, Trash2, CheckCircle2, Clock3, Lock, Users, Lightbulb, Check, X, Eye, MessageCircle, Copy,
} from 'lucide-react'
import { supabase, rpc, invokeFunction } from '../../lib/supabase'
import { fetchAccounts, useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt, fmtDateTime, todayYmd } from '../../lib/dates'
import {
  templateFor, templateForAccountType, emptyFormData, normalizeFormData, customerInfoFromAccount,
} from '../../lib/fcrTemplates'
import { buildMinutes } from '../../lib/fcrMinutes'
import { buildSuggestions } from '../../lib/fcrSuggestions'
import { downloadFcrPdf } from '../../lib/lazy'
import { FCRFormBody, CustomerInfo } from './FCRFormBody'
import { MinutesView } from '../../components/MinutesView'
import { PageHeader, Spinner, StatusChip, AckChip, Field, Segmented, Modal, confirm, prompt } from '../../components/ui'
import { notifyPendingChanged } from '../../components/Layout'
import {
  ACK_CHANNEL_LABELS, ackLink, ackRequestLine, mobileFromContact, normalizePhMobile, viberChatUrl, viberForwardUrl, viberMessage,
} from '../../lib/ack'

export function FCRForm() {
  const { id } = useParams()
  const { state } = useLocation()
  const navigate = useNavigate()
  const { user, profile, canFile } = useAuth()
  const { profiles, byId } = useProfiles()
  const [accounts, setAccounts] = useState([])
  const [fcr, setFcr] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState('')
  const [dirty, setDirty] = useState(false)
  const [history, setHistory] = useState([])
  const [emails, setEmails] = useState([])
  const [showMinutes, setShowMinutes] = useState(false)
  const [requests, setRequests] = useState([])
  const [viber, setViber] = useState(null) // { number, message } after a Viber request is recorded

  useEffect(() => { fetchAccounts({ activeOnly: false }).then(setAccounts) }, [])

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('fcrs').select('*').eq('id', id).single()
    if (error) { toast.error('FCR not found or not visible to you'); navigate('/fcr'); return }
    const t = templateFor(data.template_id, data.template_version)
    setFcr({ ...data, form_data: normalizeFormData(t, data.form_data) })
    setDirty(false)
    supabase.from('email_log').select('created_at, recipient, result, error').eq('related_id', id).order('created_at', { ascending: false }).then(({ data: e }) => setEmails(e || []))
    supabase.from('fcr_ack_requests').select('*').eq('fcr_id', id).order('sent_at', { ascending: false }).then(({ data: r }) => setRequests(r || []))
  }, [id, navigate])

  useEffect(() => {
    if (id) load()
    else setFcr({
      account_id: state?.accountId || '', visit_date: todayYmd(), period: new Date().getHours() < 12 ? 'AM' : 'PM',
      template_id: null, template_version: 1, form_data: null, customer_info: {},
      attendee_name: '', attendee_designation: '', attendee_email: '', attendee_mobile: '', attendee_mobile_owner: '', companion_id: null, companion2_id: null,
      status: 'draft', ack_status: 'not_sent', owner_id: user.id,
    })
  }, [id, state, user, load])

  const account = accounts.find((a) => a.id === fcr?.account_id)
  const template = useMemo(() => {
    if (!fcr) return null
    if (fcr.template_id) return templateFor(fcr.template_id, fcr.template_version)
    return account ? templateForAccountType(account.account_type) : null
  }, [fcr, account])

  // New FCR: once an account is picked, set the template and pre-fill.
  useEffect(() => {
    if (!fcr || fcr.id || !account || fcr.template_id) return
    const t = templateForAccountType(account.account_type)
    setFcr((f) => ({
      ...f, template_id: t.id, template_version: t.version, form_data: emptyFormData(t, account),
      attendee_name: f.attendee_name || account.contact_person || '',
      attendee_designation: f.attendee_designation || account.contact_designation || '',
      attendee_email: f.attendee_email || account.contact_email || '',
      attendee_mobile: f.attendee_mobile || mobileFromContact(account.contact_no),
    }))
  }, [fcr, account])

  // Past approved FCRs for the suggestions panel.
  useEffect(() => {
    if (!fcr?.account_id) return setHistory([])
    supabase.from('fcrs').select('id, visit_date, template_id, template_version, form_data')
      .eq('account_id', fcr.account_id).eq('status', 'approved').neq('id', fcr.id || '00000000-0000-0000-0000-000000000000')
      .order('visit_date', { ascending: false }).limit(6).then(({ data }) => setHistory(data || []))
  }, [fcr?.account_id, fcr?.id])

  if (!fcr) return <Spinner />

  const owner = byId[fcr.owner_id]
  const isOwner = fcr.owner_id === user.id
  const editable = isOwner && canFile && ['draft', 'rejected'].includes(fcr.status)
  const isDirectSuperior = owner?.supervisor_id === user.id
  const update = (patch) => { setFcr((f) => ({ ...f, ...patch })); setDirty(true) }
  const kamName = owner?.full_name || profile?.full_name
  const parentName = accounts.find((a) => a.id === account?.parent_dealer_id)?.company_name
  const customerInfo = fcr.id && !editable ? fcr.customer_info : customerInfoFromAccount(account, { kamName, parentDealerName: parentName })
  const minutes = template && fcr.form_data ? buildMinutes({ fcr: { ...fcr, customer_info: customerInfo }, submitterName: kamName, submitterPosition: owner?.position || profile?.position }) : null
  const suggestions = buildSuggestions(history)
  const companions = profiles.filter((p) => p.active && p.id !== fcr.owner_id && ['kam', 'rsm', 'channel_head'].includes(p.role))

  const validate = () => {
    const e = {}
    if (!fcr.account_id) e.account_id = 'Pick the account you visited'
    if (!fcr.visit_date) e.visit_date = 'Required'
    if (fcr.visit_date > todayYmd()) e.visit_date = 'Cannot be in the future'
    setErrors(e)
    return !Object.keys(e).length
  }

  const persist = async () => {
    const payload = {
      account_id: fcr.account_id, template_id: template.id, template_version: template.version,
      visit_date: fcr.visit_date, period: fcr.period,
      customer_info: customerInfo, form_data: fcr.form_data,
      attendee_name: fcr.attendee_name?.trim() || null, attendee_designation: fcr.attendee_designation?.trim() || null,
      attendee_email: fcr.attendee_email?.trim() || null,
      attendee_mobile: fcr.attendee_mobile?.trim() || null, attendee_mobile_owner: fcr.attendee_mobile_owner?.trim() || null,
      companion_id: fcr.companion_id || null, companion2_id: fcr.companion2_id || null,
    }
    if (fcr.id) {
      const { error } = await supabase.from('fcrs').update(payload).eq('id', fcr.id)
      if (error) throw new Error(error.message)
      return fcr.id
    }
    const { data, error } = await supabase.from('fcrs').insert(payload).select('id').single()
    if (error) throw new Error(error.message)
    return data.id
  }

  // Saving changes after the request went out invalidates the old link (the
  // database resets acknowledgement so the customer confirms what is archived).
  const confirmResetIfNeeded = async () => {
    if (!dirty || fcr.ack_status === 'not_sent') return true
    return confirm({
      title: 'The customer will need to confirm again',
      body: fcr.ack_status === 'acknowledged'
        ? 'This FCR was already acknowledged. Saving changes cancels that acknowledgement, and you must send a new request.'
        : 'An acknowledgement request is already out. Saving changes cancels that link; send a new one afterwards.',
      confirmLabel: 'Save changes',
    })
  }

  const save = async () => {
    if (!validate() || !await confirmResetIfNeeded()) return
    setBusy('save')
    try {
      const newId = await persist()
      toast.success('Draft saved')
      if (!fcr.id) navigate(`/fcr/${newId}`, { replace: true }); else await load()
    } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }

  const ensureSaved = async () => {
    if (!validate()) return null
    if (!fcr.attendee_name?.trim()) { setErrors({ attendee_name: 'Enter the attendee name first' }); return null }
    if (fcr.id && !dirty) return fcr.id
    if (!await confirmResetIfNeeded()) return null
    const newId = await persist()
    if (!fcr.id) navigate(`/fcr/${newId}`, { replace: true })
    return newId
  }

  const sendEmail = async () => {
    if (!fcr.attendee_email?.trim()) { setErrors({ attendee_email: 'Enter the attendee email, or send by Viber' }); return }
    setBusy('email')
    try {
      const fid = await ensureSaved()
      if (!fid) return
      const res = await invokeFunction('send-fcr-acknowledgment', { fcr_id: fid })
      if (res?.ok) toast.success(`Sent to ${fcr.attendee_email}. If it doesn't arrive, send by Viber.`)
      else toast.error(res?.error || 'Email not sent. Send by Viber instead.')
      if (fcr.id) await load()
    } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }

  // Viber: the request (number + whose number it is) is recorded first, so the
  // RSM sees where it went; then Viber opens on that number with the message
  // ready to paste (Viber's links can't pre-fill text into a specific chat).
  const sendViber = async () => {
    const number = normalizePhMobile(fcr.attendee_mobile)
    const owner = (fcr.attendee_mobile_owner || fcr.attendee_name || '').trim()
    const e = {}
    if (!number) e.attendee_mobile = 'Enter a mobile number, e.g. 0917 123 4567'
    if (!owner) e.attendee_mobile_owner = 'Whose number is this?'
    if (Object.keys(e).length) { setErrors(e); return }
    setBusy('viber')
    try {
      if (!fcr.attendee_mobile_owner?.trim()) setFcr((f) => ({ ...f, attendee_mobile_owner: owner }))
      const fid = await ensureSaved()
      if (!fid) return
      const token = await rpc('request_fcr_ack', { p_id: fid, p_channel: 'viber', p_recipient: number, p_recipient_name: owner })
      const message = viberMessage({
        attendeeName: fcr.attendee_name, kamName, company: customerInfo?.company_name,
        visitDate: fcr.visit_date, period: fcr.period, link: ackLink(token),
      })
      try { await navigator.clipboard.writeText(message) } catch { /* shown in the dialog to copy by hand */ }
      setViber({ number, owner, message })
      if (fcr.id) await load()
    } catch (err) { toast.error(err.message) } finally { setBusy('') }
  }

  const copyLink = async () => {
    setBusy('link')
    try {
      const fid = await ensureSaved()
      if (!fid) return
      const token = await rpc('request_fcr_ack', { p_id: fid, p_channel: 'link' })
      const url = ackLink(token)
      try { await navigator.clipboard.writeText(url); toast.success('Link copied. Prefer "Send by Viber" so the number is on record for your RSM.') }
      catch { await prompt({ title: 'Acknowledgement link', body: 'Copy this link and send it to the customer.', initial: url, confirmLabel: 'Done' }) }
      if (fcr.id) await load()
    } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }

  const submit = async () => {
    setBusy('submit')
    try { await rpc('submit_fcr', { p_id: fcr.id }); toast.success('Submitted to your direct superior'); await load() }
    catch (e) { toast.error(e.message) } finally { setBusy('') }
  }

  const remove = async () => {
    if (!await confirm({ title: 'Delete this draft FCR?', danger: true, confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('fcrs').delete().eq('id', fcr.id)
    if (error) toast.error(error.message); else { toast.success('Deleted'); navigate('/fcr') }
  }

  const review = async (approve) => {
    let comment = null
    if (!approve) {
      comment = await prompt({ title: 'Return this FCR to the KAM', label: 'What needs to be corrected?', required: true, confirmLabel: 'Return', danger: true })
      if (!comment) return
    } else {
      comment = await prompt({ title: 'Approve this FCR', label: 'Comment (optional)', confirmLabel: 'Approve' })
      if (comment === null) return
    }
    try { await rpc('review_fcr', { p_id: fcr.id, p_approve: approve, p_comment: comment || null }); toast.success(approve ? 'Approved' : 'Returned to KAM'); notifyPendingChanged(); await load() }
    catch (e) { toast.error(e.message) }
  }

  const pdf = async () => {
    setBusy('pdf')
    try { await downloadFcrPdf({ fcr: { ...fcr, customer_info: customerInfo }, submitterName: kamName, submitterPosition: owner?.position, reviewerName: byId[fcr.reviewed_by]?.full_name }) }
    catch (e) { toast.error('PDF failed: ' + e.message) } finally { setBusy('') }
  }

  const selectableAccounts = accounts.filter((a) => a.active || a.id === fcr.account_id)
  const mine = selectableAccounts.filter((a) => a.kam_id === fcr.owner_id)
  const others = selectableAccounts.filter((a) => a.kam_id !== fcr.owner_id)

  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title={template ? template.title : 'New Field Contact Report'}
        subtitle={fcr.id ? `${kamName} · ${owner?.team || ''} · ${fmt(fcr.visit_date)} ${fcr.period}` : 'Pick the account first; the form follows the account type (dealer or sub-dealer).'}
        back={<Link to="/fcr" className="btn-ghost -ml-2 mb-1 text-ink-3"><ArrowLeft size={14} /> Field Contact Reports</Link>}
        actions={<>
          {fcr.id && <><AckChip status={fcr.ack_status} /><StatusChip status={fcr.status} /></>}
          {!editable && fcr.id && <span className="chip-draft"><Lock size={11} /> Read-only</span>}
          {fcr.id && <button className="btn-secondary" onClick={pdf} disabled={busy === 'pdf'}><FileDown size={14} /> PDF</button>}
          {editable && fcr.id && fcr.status === 'draft' && fcr.ack_status !== 'acknowledged' && <button className="btn-ghost text-bad" onClick={remove} aria-label="Delete"><Trash2 size={14} /></button>}
          {editable && <button className="btn-secondary" onClick={save} disabled={Boolean(busy) || !template}><Save size={14} /> Save draft</button>}
        </>} />

      {fcr.status === 'rejected' && fcr.review_comment && (
        <div className="mb-4 px-4 py-3 rounded border border-bad/30 bg-bad-soft text-[13px] text-bad">
          <strong>Returned by {byId[fcr.reviewed_by]?.full_name}:</strong> {fcr.review_comment}
          <span className="block text-bad/80 mt-0.5">Correct the report, then request acknowledgement again (or resubmit if no change is needed).</span>
        </div>
      )}
      {isDirectSuperior && fcr.status === 'pending_approval' && (
        <div className="mb-4 px-4 py-3 rounded border border-warn/30 bg-warn-soft flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-warn flex-1">Waiting for your approval. Acknowledged by {fcr.acknowledged_name} on {fmtDateTime(fcr.acknowledged_at)}.{fcr.ack_channel && <span className="block text-ink-2">{ackRequestLine(fcr)}</span>}</p>
          <button className="btn-danger" onClick={() => review(false)}><X size={14} /> Return</button>
          <button className="btn-ok" onClick={() => review(true)}><Check size={14} /> Approve</button>
        </div>
      )}

      <div className="grid xl:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-4 min-w-0">
          {/* Visit */}
          <div className="panel p-4 grid sm:grid-cols-[1fr_170px_120px] gap-3">
            <Field label="Account visited" error={errors.account_id}>
              <select className="input" disabled={!editable || Boolean(fcr.id)} value={fcr.account_id}
                onChange={(e) => setFcr((f) => ({ ...f, account_id: e.target.value, template_id: null, form_data: null }))}>
                <option value="">Select account</option>
                <optgroup label="My accounts">{mine.map((a) => <option key={a.id} value={a.id}>{a.company_name}{a.account_type === 'sub_dealer' ? ' (sub-dealer)' : ''}</option>)}</optgroup>
                <optgroup label="Other accounts">{others.map((a) => <option key={a.id} value={a.id}>{a.company_name}{a.account_type === 'sub_dealer' ? ' (sub-dealer)' : ''}</option>)}</optgroup>
              </select>
            </Field>
            <Field label="Visit date" error={errors.visit_date} hint={fcr.ack_requested_at ? 'Locked once acknowledgement is requested' : undefined}>
              <input type="date" className="input" max={todayYmd()} disabled={!editable || Boolean(fcr.ack_requested_at)} value={fcr.visit_date} onChange={(e) => update({ visit_date: e.target.value })} />
            </Field>
            <Field label="Period">
              <Segmented value={fcr.period} onChange={(p) => editable && !fcr.ack_requested_at && update({ period: p })} options={[{ value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }]} />
            </Field>
            {!fcr.id && !accounts.length && <p className="text-[12px] text-ink-3 sm:col-span-3">No accounts yet. <Link className="text-accent" to="/accounts/new">Profile an account</Link> first.</p>}
          </div>

          {template && fcr.form_data && (
            <>
              <CustomerInfo template={template} info={customerInfo} visitDate={fcr.visit_date} period={fcr.period} kamName={kamName} />
              <FCRFormBody template={template} formData={fcr.form_data} readOnly={!editable} errors={errors}
                onChange={(fd) => update({ form_data: fd })} />
            </>
          )}
        </div>

        {/* Right rail */}
        {template && fcr.form_data && (
          <div className="space-y-4 xl:sticky xl:top-5">
            <div className="panel">
              <div className="panel-head"><span className="panel-title">Customer acknowledgement</span><AckChip status={fcr.ack_status} /></div>
              <div className="p-4 space-y-3">
                <Field label="Attendee name *" error={errors.attendee_name}>
                  <input className="input" disabled={!editable} value={fcr.attendee_name || ''} onChange={(e) => update({ attendee_name: e.target.value })} />
                </Field>
                <Field label="Designation">
                  <input className="input" disabled={!editable} value={fcr.attendee_designation || ''} onChange={(e) => update({ attendee_designation: e.target.value })} />
                </Field>
                <Field label="Attendee email" error={errors.attendee_email}>
                  <input className="input" type="email" disabled={!editable} value={fcr.attendee_email || ''} onChange={(e) => update({ attendee_email: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Viber number" error={errors.attendee_mobile}>
                    <input className="input" inputMode="tel" placeholder="0917 123 4567" disabled={!editable} value={fcr.attendee_mobile || ''} onChange={(e) => update({ attendee_mobile: e.target.value })} />
                  </Field>
                  <Field label="Number owner" error={errors.attendee_mobile_owner}>
                    <input className="input" placeholder={fcr.attendee_name || 'Name'} disabled={!editable} value={fcr.attendee_mobile_owner || ''} onChange={(e) => update({ attendee_mobile_owner: e.target.value })} />
                  </Field>
                </div>

                {fcr.ack_status === 'acknowledged' ? (
                  <div className="rounded border border-ok/30 bg-ok-soft px-3 py-2 text-[13px] text-ok">
                    <p className="flex items-center gap-1.5 font-medium"><CheckCircle2 size={14} /> Confirmed by {fcr.acknowledged_name}</p>
                    <p className="text-[12px] mt-0.5">{fmtDateTime(fcr.acknowledged_at)}</p>
                    {fcr.acknowledged_comment && <p className="mt-1.5 text-ink-2 whitespace-pre-wrap">"{fcr.acknowledged_comment}"</p>}
                  </div>
                ) : fcr.ack_status === 'pending' ? (
                  <p className="flex items-center gap-1.5 text-[13px] text-warn"><Clock3 size={14} /> Waiting for the customer since {fmtDateTime(fcr.ack_requested_at)}</p>
                ) : null}

                {editable && fcr.ack_status !== 'acknowledged' && (
                  <div className="space-y-2">
                    <p className="text-2xs font-semibold uppercase tracking-[0.05em] text-ink-3">{fcr.ack_status === 'pending' ? 'Send again' : 'Send for acknowledgement'}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button className="btn-primary justify-center" onClick={sendEmail} disabled={Boolean(busy)}><Mail size={14} /> By email</button>
                      <button className="btn-primary justify-center" onClick={sendViber} disabled={Boolean(busy)}><MessageCircle size={14} /> By Viber</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-ghost" onClick={copyLink} disabled={Boolean(busy)} title="Other apps. The recipient is not recorded."><Link2 size={14} /> Copy link only</button>
                      {fcr.ack_status === 'pending' && <button className="btn-ghost" onClick={load}><RefreshCw size={14} /> Refresh</button>}
                    </div>
                  </div>
                )}
                {editable && fcr.ack_status === 'acknowledged' && ['draft', 'rejected'].includes(fcr.status) && (
                  <button className="btn-primary w-full" onClick={submit} disabled={Boolean(busy)}><Send size={14} /> Submit for approval</button>
                )}
                <button className="btn-ghost w-full" onClick={() => setShowMinutes(true)}><Eye size={14} /> Preview minutes the customer will see</button>
                <p className="text-2xs text-ink-4 leading-relaxed">When the customer confirms, the FCR goes to {byId[owner?.supervisor_id]?.full_name || 'your direct superior'} for approval automatically.</p>
                {requests.length > 0 && (
                  <div className="pt-2 border-t border-line">
                    <p className="text-2xs font-semibold uppercase tracking-[0.05em] text-ink-3 mb-1">Where the request went</p>
                    {requests.map((r) => (
                      <p key={r.id} className="text-[12px] text-ink-2 leading-snug py-0.5">
                        <span className="font-medium text-ink">{ACK_CHANNEL_LABELS[r.channel]}</span>
                        {r.recipient && <> · {r.recipient}</>}{r.recipient_name && <> ({r.recipient_name})</>}
                        <span className="block text-ink-4">{fmtDateTime(r.sent_at)} · by {byId[r.sent_by]?.full_name || 'KAM'}</span>
                      </p>
                    ))}
                  </div>
                )}
                {emails.length > 0 && (
                  <div className="pt-2 border-t border-line">
                    <p className="text-2xs font-semibold uppercase tracking-[0.05em] text-ink-3 mb-1">Email delivery</p>
                    {emails.map((e, i) => (
                      <p key={i} className="text-[12px] text-ink-2"><span className={e.result === 'sent' ? 'text-ok' : 'text-bad'}>{e.result}</span> · {e.recipient} · {fmtDateTime(e.created_at)}{e.error ? ` · ${e.error}` : ''}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head"><span className="panel-title flex items-center gap-1.5"><Users size={14} /> Joint visit</span></div>
              <div className="p-4 space-y-3">
                {[['companion_id', 'Companion 1'], ['companion2_id', 'Companion 2']].map(([k, label]) => (
                  <Field key={k} label={label}>
                    <select className="input" disabled={!editable} value={fcr[k] || ''} onChange={(e) => update({ [k]: e.target.value || null })}>
                      <option value="">None</option>
                      {companions.filter((p) => p.id !== fcr[k === 'companion_id' ? 'companion2_id' : 'companion_id']).map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.team ? ` (${p.team})` : ''}</option>)}
                    </select>
                  </Field>
                ))}
                <p className="text-2xs text-ink-4">Companions can view this FCR. They do not file a separate one.</p>
              </div>
            </div>

            {suggestions.length > 0 && editable && (
              <div className="panel">
                <div className="panel-head"><span className="panel-title flex items-center gap-1.5"><Lightbulb size={14} /> From past visits</span></div>
                <ul className="p-4 space-y-2">
                  {suggestions.map((s) => <li key={s.id} className="text-[12.5px] leading-snug"><span className="chip-info mr-1">{s.category}</span>{s.text}</li>)}
                </ul>
                <p className="px-4 pb-3 text-2xs text-ink-4">Rule-based from this account's approved FCRs. Not AI-generated.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {editable && template && (
        <div className="sticky bottom-0 mt-5 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-white/95 backdrop-blur border-t border-line flex items-center gap-2 print:hidden">
          <span className="text-[12px] text-ink-3">{dirty ? 'Unsaved changes' : fcr.id ? 'All changes saved' : 'Not saved yet'}</span>
          <button className="btn-secondary ml-auto" onClick={save} disabled={Boolean(busy)}><Save size={14} /> Save draft</button>
          {fcr.ack_status !== 'acknowledged' && <>
            <button className="btn-primary" onClick={sendEmail} disabled={Boolean(busy)}><Mail size={14} /> Send by email</button>
            <button className="btn-primary" onClick={sendViber} disabled={Boolean(busy)}><MessageCircle size={14} /> Send by Viber</button>
          </>}
        </div>
      )}

      <Modal open={Boolean(viber)} onClose={() => setViber(null)} title="Send by Viber" width="max-w-lg"
        footer={viber && <>
          <button className="btn-secondary mr-auto" onClick={async () => { try { await navigator.clipboard.writeText(viber.message); toast.success('Message copied') } catch { toast.error('Select the message and copy it') } }}><Copy size={14} /> Copy message</button>
          <a className="btn-secondary" href={viberForwardUrl(viber.message)}>Pick contact in Viber</a>
          <a className="btn-primary" href={viberChatUrl(viber.number)}><MessageCircle size={14} /> Open chat with {viber.number}</a>
        </>}>
        {viber && <>
          <p className="text-[13px] text-ink-2 mb-3">Recorded for your RSM: <strong className="text-ink">Viber to {viber.number} ({viber.owner})</strong>. The message is copied. Open the chat and paste it.</p>
          <textarea className="input font-mono text-[12px] h-36" readOnly value={viber.message} onFocus={(e) => e.target.select()} />
          <p className="text-2xs text-ink-4 mt-2">Send it to the number above, so the record matches. If Viber does not open on this device, copy the message and send it from your phone.</p>
        </>}
      </Modal>

      <Modal open={showMinutes} onClose={() => setShowMinutes(false)} title="Minutes of the Meeting" width="max-w-2xl"
        footer={<button className="btn-secondary" onClick={() => setShowMinutes(false)}>Close</button>}>
        {minutes && <MinutesView minutes={minutes} />}
        <p className="text-2xs text-ink-4 mt-4">This is exactly what the customer reviews and confirms, and what the PDF archives.</p>
      </Modal>
    </div>
  )
}
