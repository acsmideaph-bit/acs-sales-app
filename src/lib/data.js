import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

// Small shared data helpers. All reads are RLS-scoped by the database.

export async function fetchProfiles() {
  const { data, error } = await supabase.from('user_profiles')
    .select('id, full_name, email, position, role, team, area, supervisor_id, notify_email, read_only, active')
    .order('full_name')
  if (error) throw error
  return data || []
}

// Members of the caller's branch (everyone below them; all for admin/viewer).
export async function fetchBranch() {
  const { data, error } = await supabase.rpc('my_branch')
  if (error) throw error
  return data || []
}

// Team members who file: KAMs plus non-KAM dealer holders (TTA plan).
export async function fetchFilers() {
  const [branch, { data: holders }] = await Promise.all([fetchBranch(), supabase.rpc('dealer_holder_ids')])
  const h = new Set(holders || [])
  return branch.filter((b) => b.role === 'kam' || h.has(b.id))
}

export function useProfiles() {
  const [profiles, setProfiles] = useState([])
  useEffect(() => { fetchProfiles().then(setProfiles).catch(() => setProfiles([])) }, [])
  // Memoized: pages use byId as an effect dependency.
  const byId = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles])
  return { profiles, byId }
}

export async function fetchAccounts({ activeOnly = true } = {}) {
  let q = supabase.from('accounts').select('*').order('company_name')
  if (activeOnly) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Acknowledged FCRs in a date range, with owner/reviewer names attached.
export async function fetchReportFcrs({ from, to, ownerIds, approvedOnly = false, byId }) {
  let q = supabase.from('fcrs').select('*, photo:fcr_photos(*)')
    .eq('ack_status', 'acknowledged')
    .gte('visit_date', from).lte('visit_date', to)
    .order('visit_date').order('created_at')
  if (approvedOnly) q = q.eq('status', 'approved')
  if (ownerIds?.length) q = q.in('owner_id', ownerIds)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((f) => ({
    ...f,
    owner_name: byId[f.owner_id]?.full_name || '—',
    owner_position: byId[f.owner_id]?.position || '',
    team: byId[f.owner_id]?.team || '',
    reviewer_name: byId[f.reviewed_by]?.full_name || '',
  }))
}

export async function fetchArchives({ from, to, ownerIds }) {
  let q = supabase.from('mcp_archive').select('*').gte('month', from.slice(0, 8) + '01').lte('month', to).order('month').order('created_at', { ascending: false })
  if (ownerIds?.length) q = q.in('owner_id', ownerIds)
  const { data, error } = await q
  if (error) throw error
  // Latest snapshot per owner+month
  const seen = new Set()
  return (data || []).filter((a) => { const k = `${a.owner_id}|${a.month}`; if (seen.has(k)) return false; seen.add(k); return true })
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
