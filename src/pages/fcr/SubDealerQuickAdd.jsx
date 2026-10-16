import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { PH_REGIONS } from '../../lib/constants'
import { Modal, Field } from '../../components/ui'

// Sub-dealers are typed in by the KAM, under a dealer the KAM holds this
// month (dealers themselves come only from the TTA plan upload). Opened from
// the FCR so the KAM never leaves the report to profile a new sub-dealer.
const blank = { company_name: '', parent_dealer_id: '', region: '', owners: '', contact_person: '', contact_no: '', business_address: '' }

export function SubDealerQuickAdd({ open, onClose, onCreated, dealers }) {
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { setForm({ ...blank, parent_dealer_id: dealers.length === 1 ? dealers[0].id : '' }); setErrors({}) } }, [open, dealers])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    const err = {}
    if (!form.company_name.trim()) err.company_name = 'Required'
    if (!form.parent_dealer_id) err.parent_dealer_id = 'Pick the dealer this sub-dealer buys from'
    if (!form.region) err.region = 'Required'
    setErrors(err)
    if (Object.keys(err).length) return
    setSaving(true)
    const { data, error } = await supabase.from('accounts').insert({
      ...form,
      company_name: form.company_name.replace(/\s+/g, ' ').trim(),
      account_type: 'sub_dealer',
      dealer_classification: 'SUB DEALER',
    }).select().single()
    setSaving(false)
    if (error) {
      toast.error(error.code === '23505' ? 'A sub-dealer with this name already exists. Ask your RSM or the admin to assign it to you.' : error.message)
      return
    }
    toast.success(`${data.company_name} added`)
    onCreated(data)
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a sub-dealer" width="max-w-xl"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add and select'}</button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Sub-dealer name *" error={errors.company_name} className="sm:col-span-2"><input className="input" value={form.company_name} onChange={set('company_name')} autoFocus /></Field>
        <Field label="Buys from (your dealer) *" error={errors.parent_dealer_id} className="sm:col-span-2">
          <select className="input" value={form.parent_dealer_id} onChange={set('parent_dealer_id')}>
            <option value="">Select dealer</option>
            {dealers.map((d) => <option key={d.id} value={d.id}>{d.company_name} · BP {d.bp_code}</option>)}
          </select>
        </Field>
        <Field label="Region *" error={errors.region}>
          <select className="input" value={form.region} onChange={set('region')}>
            <option value="">Select region</option>
            {PH_REGIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Owner/s"><input className="input" value={form.owners} onChange={set('owners')} /></Field>
        <Field label="Contact person"><input className="input" value={form.contact_person} onChange={set('contact_person')} /></Field>
        <Field label="Contact no."><input className="input" inputMode="tel" value={form.contact_no} onChange={set('contact_no')} /></Field>
        <Field label="Business address" className="sm:col-span-2"><input className="input" value={form.business_address} onChange={set('business_address')} /></Field>
      </div>
      <p className="text-2xs text-ink-4 mt-3">Dealers come from the TTA plan by BP code and cannot be added here. A sub-dealer follows its dealer if the dealer moves to another KAM.</p>
    </Modal>
  )
}
