import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchAccounts, useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { PH_REGIONS, DEALER_CLASSIFICATIONS, CHANNELS, PRIORITIES } from '../../lib/constants'
import { PageHeader, Field, Spinner } from '../../components/ui'
import { fetchOwnedDealers } from '../../lib/targets'
import { todayYmd } from '../../lib/dates'

const blank = {
  account_type: 'sub_dealer', company_name: '', owners: '', contact_no: '', email: '', business_address: '', region: '',
  dealer_classification: '', channel: '', parent_dealer_id: null, visit_freq_days: '', payment_terms: '', credit_limit: '',
  contact_person: '', contact_designation: '', contact_email: '', kam_id: null, priority: '', notes: '', active: true,
}

// Fields mirror the "Customer Information" header of the ACS FCR forms, plus
// the contact the acknowledgement email goes to by default.
//
// Since Oct 16, 2026 dealers come only from the TTA plan upload (by BP code);
// this form creates sub-dealers and edits contact details. A dealer's name,
// BP code and monthly KAM are read-only here (the database enforces it).
export function AccountForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile, canWrite } = useAuth()
  const { byId } = useProfiles()
  const [form, setForm] = useState(null)
  const [dealers, setDealers] = useState([])
  const [allDealers, setAllDealers] = useState([])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // A KAM adds sub-dealers under the dealers they hold this month;
    // superiors and admins may pick any dealer.
    Promise.all([fetchAccounts(), profile?.role === 'kam' ? fetchOwnedDealers(user.id, todayYmd()) : Promise.resolve(null)])
      .then(([all, owned]) => {
        const ids = owned && new Set(owned.map((o) => o.account_id))
        setAllDealers(all.filter((a) => a.account_type === 'dealer'))
        setDealers(all.filter((a) => a.account_type === 'dealer' && a.bp_code && a.id !== id && (!ids || ids.has(a.id))))
      })
    if (id) {
      supabase.from('accounts').select('*').eq('id', id).single().then(({ data }) => setForm({ ...blank, ...data, credit_limit: data?.credit_limit ?? '' }))
    } else {
      setForm({ ...blank, kam_id: profile?.role === 'kam' ? user.id : null })
    }
  }, [id, user, profile])

  if (!form) return <Spinner />
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))

  const save = async () => {
    const err = {}
    if (!form.company_name.trim()) err.company_name = 'Required'
    if (form.account_type === 'sub_dealer' && !form.parent_dealer_id) err.parent_dealer_id = 'Pick the dealer this sub-dealer buys from'
    if (!form.region) err.region = 'Required'
    for (const k of ['email', 'contact_email']) if (form[k] && !/^\S+@\S+\.\S+$/.test(form[k])) err[k] = 'Check the email address'
    setErrors(err)
    if (Object.keys(err).length) return
    setSaving(true)
    const payload = { ...form, credit_limit: form.credit_limit === '' ? null : Number(String(form.credit_limit).replace(/,/g, '')), priority: form.priority || null,
      parent_dealer_id: form.account_type === 'sub_dealer' ? form.parent_dealer_id : null,
      dealer_classification: form.account_type === 'sub_dealer' ? 'SUB DEALER' : form.dealer_classification }
    delete payload.id; delete payload.created_at; delete payload.updated_at; delete payload.created_by
    // Set by the TTA plan import / owner sync, never by this form.
    delete payload.bp_code; delete payload.registered_name; delete payload.mdm_name; delete payload.area; delete payload.kam_id
    if (!id) payload.account_type = 'sub_dealer'
    const res = id ? await supabase.from('accounts').update(payload).eq('id', id).select().single()
      : await supabase.from('accounts').insert(payload).select().single()
    setSaving(false)
    if (res.error) {
      toast.error(res.error.code === '23505' ? 'An account with this name and type already exists. Search for it under Accounts > All.'
        : res.error.code === '42501' ? 'You can add sub-dealers only under a dealer assigned to you this month.' : res.error.message)
      return
    }
    toast.success('Account saved')
    navigate(`/accounts/${res.data.id}`)
  }

  const isSub = form.account_type === 'sub_dealer'
  return (
    <div className="max-w-4xl">
      <PageHeader title={id ? 'Edit account' : 'New sub-dealer'}
        subtitle={id ? undefined : 'Dealers come from the TTA plan by BP code. Add the sub-dealers you cover here.'}
        back={<Link to={id ? `/accounts/${id}` : '/accounts'} className="btn-ghost -ml-2 mb-1 text-ink-3"><ArrowLeft size={14} /> Back</Link>} />
      <div className="panel p-5 space-y-6">
        {!isSub && (
          <div className="grid sm:grid-cols-3 gap-4 rounded border border-line bg-canvas px-4 py-3 text-[13px]">
            <div><p className="label">BP code</p><p className="font-semibold tabular-nums">{form.bp_code || <span className="text-warn">Not linked to the TTA plan</span>}</p></div>
            <div><p className="label">Registered name</p><p>{form.registered_name || '—'}</p></div>
            <div><p className="label">KAM this month</p><p>{byId[form.kam_id]?.full_name || 'No KAM this month'}</p></div>
            <p className="sm:col-span-3 text-[12px] text-ink-3">Dealer name, BP code and KAM come from the TTA plan upload. Edit contact and visit details below.</p>
          </div>
        )}

        <section className="grid sm:grid-cols-2 gap-4">
          <Field label={isSub ? 'Sub-dealer name *' : 'Account name'} error={errors.company_name} className="sm:col-span-2"><input className="input" value={form.company_name} onChange={set('company_name')} disabled={!isSub} /></Field>
          <Field label="Owner/s"><input className="input" value={form.owners} onChange={set('owners')} /></Field>
          <Field label="Contact no."><input className="input" value={form.contact_no} onChange={set('contact_no')} /></Field>
          <Field label="Business address" className="sm:col-span-2"><input className="input" value={form.business_address} onChange={set('business_address')} /></Field>
          <Field label="Region *" error={errors.region}>
            <select className="input" value={form.region} onChange={set('region')}>
              <option value="">Select region</option>
              {PH_REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Company email" error={errors.email}><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
          {isSub ? (
            <Field label="Dealer (buys from) *" error={errors.parent_dealer_id} className="sm:col-span-2">
              <select className="input" value={form.parent_dealer_id || ''} onChange={(e) => set('parent_dealer_id')(e.target.value || null)}>
                <option value="">Select dealer</option>
                {[...dealers, ...allDealers.filter((d) => d.id === form.parent_dealer_id && !dealers.some((x) => x.id === d.id))]
                  .map((d) => <option key={d.id} value={d.id}>{d.company_name}{d.bp_code ? ` · BP ${d.bp_code}` : ''}</option>)}
              </select>
            </Field>
          ) : (<>
            <Field label="Dealer classification">
              <input className="input" list="dl-class" value={form.dealer_classification} onChange={set('dealer_classification')} />
              <datalist id="dl-class">{DEALER_CLASSIFICATIONS.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Channel">
              <input className="input" list="dl-channel" value={form.channel} onChange={set('channel')} />
              <datalist id="dl-channel">{CHANNELS.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          </>)}
        </section>

        <section className="grid sm:grid-cols-3 gap-4 pt-5 border-t border-line">
          <Field label="KAM">
            <p className="h-8 flex items-center text-[13px] text-ink-2">{isSub ? `${byId[form.kam_id]?.full_name || 'You'} · follows the dealer's KAM` : (byId[form.kam_id]?.full_name || 'No KAM this month')}</p>
          </Field>
          <Field label="Visit frequency / days" hint="As on the FCR header, e.g. 2x a month"><input className="input" value={form.visit_freq_days} onChange={set('visit_freq_days')} /></Field>
          <Field label="Priority">
            <select className="input" value={form.priority || ''} onChange={set('priority')}>
              <option value="">Not set</option>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          {!isSub && <>
            <Field label="Payment terms"><input className="input" value={form.payment_terms} onChange={set('payment_terms')} placeholder="e.g. 30 days PDC" /></Field>
            <Field label="Credit limit (PHP)"><input className="input text-right tabular-nums" inputMode="decimal" value={form.credit_limit} onChange={set('credit_limit')} /></Field>
          </>}
        </section>

        <section className="grid sm:grid-cols-3 gap-4 pt-5 border-t border-line">
          <p className="sm:col-span-3 text-[12px] text-ink-3 -mb-2">Default meeting contact. Pre-fills the attendee on new FCRs; the acknowledgement email goes here unless changed on the FCR.</p>
          <Field label="Contact person"><input className="input" value={form.contact_person} onChange={set('contact_person')} /></Field>
          <Field label="Designation"><input className="input" value={form.contact_designation} onChange={set('contact_designation')} /></Field>
          <Field label="Contact email" error={errors.contact_email}><input className="input" type="email" value={form.contact_email} onChange={set('contact_email')} /></Field>
          <Field label="Notes" className="sm:col-span-3"><textarea className="input min-h-[72px]" value={form.notes || ''} onChange={set('notes')} /></Field>
          {id && (
            <label className="flex items-center gap-2 text-[13px] sm:col-span-3">
              <input type="checkbox" checked={form.active} onChange={(e) => set('active')(e.target.checked)} /> Active (inactive accounts are hidden from plans and new FCRs)
            </label>
          )}
        </section>

        <div className="flex justify-end gap-2 pt-4 border-t border-line">
          <Link to={id ? `/accounts/${id}` : '/accounts'} className="btn-secondary">Cancel</Link>
          <button className="btn-primary" onClick={save} disabled={saving || !canWrite}>{saving ? 'Saving…' : 'Save account'}</button>
        </div>
      </div>
    </div>
  )
}
