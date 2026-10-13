import { useEffect, useState, useCallback } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Building2, CalendarRange, ClipboardList, CalendarCheck2, Archive,
  CheckSquare, CalendarClock, FileDown, BarChart3, FileSpreadsheet, Mail, Users, Menu, X, LogOut, Info, UserCog,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { ROLE_LABELS } from '../lib/roles'
import { Modal } from './ui'
import { AccountSettings } from './AccountSettings'
import { ErrorBoundary } from './ErrorBoundary'

// Pending-approval counts for the signed-in superior's DIRECT reports. Badges
// mean approvals never depend on email arriving (MBT lesson 1).
export function usePendingCounts(enabled) {
  const { user } = useAuth()
  const [counts, setCounts] = useState({ fcr: 0, plan: 0 })
  const load = useCallback(async () => {
    if (!enabled || !user) return
    const { data: reports } = await supabase.from('user_profiles').select('id').eq('supervisor_id', user.id)
    const ids = (reports || []).map((r) => r.id)
    if (!ids.length) return setCounts({ fcr: 0, plan: 0 })
    const [{ count: fcr }, { count: plan }] = await Promise.all([
      supabase.from('fcrs').select('id', { count: 'exact', head: true }).in('owner_id', ids).eq('status', 'pending_approval'),
      supabase.from('itineraries').select('id', { count: 'exact', head: true }).in('owner_id', ids).eq('status', 'pending_approval'),
    ])
    setCounts({ fcr: fcr || 0, plan: plan || 0 })
  }, [enabled, user])
  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    window.addEventListener('acs:pending-changed', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); window.removeEventListener('acs:pending-changed', onFocus) }
  }, [load])
  return counts
}

export const notifyPendingChanged = () => window.dispatchEvent(new Event('acs:pending-changed'))

function NavItem({ to, icon: Icon, label, badge, end }) {
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) => `flex items-center gap-2.5 h-8 px-2.5 rounded text-[13px] transition-colors ${isActive ? 'bg-accent-soft text-accent font-medium' : 'text-ink-2 hover:bg-black/[0.04] hover:text-ink'}`}>
      <Icon size={16} strokeWidth={1.75} />
      <span className="truncate">{label}</span>
      {badge > 0 && <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[11px] font-semibold flex items-center justify-center tabular-nums">{badge}</span>}
    </NavLink>
  )
}

const Group = ({ label, children }) => (
  <div className="mt-5">
    <p className="px-2.5 mb-1 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-4">{label}</p>
    <div className="space-y-0.5">{children}</div>
  </div>
)

export function Layout() {
  const { profile, isApprover, hasTeam, isAdmin, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [about, setAbout] = useState(false)
  const [settings, setSettings] = useState(false)
  const location = useLocation()
  const pending = usePendingCounts(isApprover)
  useEffect(() => setOpen(false), [location.pathname])

  const nav = (
    <nav className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-line flex-shrink-0">
        <div className="w-7 h-7 rounded bg-accent text-white text-[10px] font-bold flex items-center justify-center tracking-wide">ACS</div>
        <div className="leading-tight min-w-0">
          <p className="text-[13px] font-semibold">ACS Sales Operations</p>
          <p className="text-2xs text-ink-4">Concepcion Midea Inc.</p>
        </div>
        <button className="btn-ghost w-7 px-0 ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-0.5">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
          <NavItem to="/accounts" icon={Building2} label="Accounts" />
        </div>
        <Group label="Field work">
          <NavItem to="/mcp/plan" icon={CalendarRange} label="MCP Plan" />
          <NavItem to="/fcr" icon={ClipboardList} label="Field Contact Reports" end />
          <NavItem to="/mcp/actual" icon={CalendarCheck2} label="MCP Actual" />
          <NavItem to="/mcp/archive" icon={Archive} label="MCP Archive" />
        </Group>
        {isApprover && (
          <Group label="Approvals">
            <NavItem to="/fcr/approvals" icon={CheckSquare} label="FCR approvals" badge={pending.fcr} />
            <NavItem to="/mcp/approvals" icon={CalendarClock} label="MCP Plan approvals" badge={pending.plan} />
          </Group>
        )}
        <Group label="Reports">
          {hasTeam && <NavItem to="/reports/weekly" icon={FileDown} label="Weekly report" />}
          {hasTeam && <NavItem to="/reports/census" icon={BarChart3} label="Visitation census" />}
          {hasTeam && <NavItem to="/reports/export" icon={FileSpreadsheet} label="Export center" />}
          <NavItem to="/reports/email-log" icon={Mail} label="Email log" />
        </Group>
        {isAdmin && (
          <Group label="Admin">
            <NavItem to="/admin/users" icon={Users} label="Users and org chart" />
          </Group>
        )}
      </div>
      <div className="border-t border-line p-3 flex-shrink-0">
        <div className="px-1">
          <p className="text-[13px] font-medium truncate">{profile?.full_name}</p>
          <p className="text-2xs text-ink-3 truncate">{ROLE_LABELS[profile?.role]}{profile?.team ? ` · ${profile.team}` : ''}{profile?.read_only ? ' · read-only' : ''}</p>
        </div>
        <div className="flex items-center gap-0.5 mt-2">
          <button className="btn-ghost h-7 px-2 text-[12px]" onClick={() => setSettings(true)}><UserCog size={14} /> Account</button>
          <button className="btn-ghost h-7 w-7 px-0" onClick={() => setAbout(true)} title="About" aria-label="About"><Info size={14} /></button>
          <button className="btn-ghost h-7 px-2 text-[12px] ml-auto" onClick={signOut}><LogOut size={14} /> Sign out</button>
        </div>
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 bg-white border-r border-line print:hidden">{nav}</aside>
      <div className={`lg:hidden fixed inset-0 z-40 transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
        <aside className={`absolute inset-y-0 left-0 w-64 bg-white shadow-pop transition-transform duration-200 ease-out-strong ${open ? 'translate-x-0' : '-translate-x-full'}`}>{nav}</aside>
      </div>
      <div className="lg:pl-60">
        <header className="lg:hidden sticky top-0 z-30 h-12 bg-white/95 backdrop-blur border-b border-line flex items-center px-3 gap-2 print:hidden">
          <button className="btn-ghost w-8 px-0" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <span className="text-[13px] font-semibold">ACS Sales Operations</span>
          {(pending.fcr + pending.plan) > 0 && <span className="ml-auto chip-rejected">{pending.fcr + pending.plan} pending</span>}
        </header>
        <main className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7 max-w-[1400px]">
          <ErrorBoundary resetKey={location.pathname}><Outlet /></ErrorBoundary>
        </main>
      </div>
      <AccountSettings open={settings} onClose={() => setSettings(false)} />
      <Modal open={about} onClose={() => setAbout(false)} title="About ACS Sales Operations">
        <div className="text-[13px] text-ink-2 space-y-2 leading-relaxed">
          <p>Monthly call planning, Field Contact Reports with customer e-acknowledgement, approvals by direct superiors, and weekly and monthly visibility for the AC Specialist team.</p>
          <p>Approval routing follows the ACS org chart: each KAM's FCRs and MCP Plans go to their direct superior (RSM). Channel Head and Director see their whole branch.</p>
          <p className="text-ink-3">Built by RonApps for Concepcion Midea Inc. Philippines. Version 1.0.</p>
        </div>
      </Modal>
    </div>
  )
}
