import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuth } from './context/AuthContext'
import { isConfigured } from './lib/supabase'
import { Layout } from './components/Layout'
import { DialogHost, Spinner } from './components/ui'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { AccountList } from './pages/accounts/AccountList'
import { AccountForm } from './pages/accounts/AccountForm'
import { AccountDetail } from './pages/accounts/AccountDetail'
import { PlanList } from './pages/mcp/PlanList'
import { PlanForm } from './pages/mcp/PlanForm'
import { PlanApprovals } from './pages/mcp/PlanApprovals'
import { McpActual } from './pages/mcp/McpActual'
import { McpArchive } from './pages/mcp/McpArchive'
import { FCRList } from './pages/fcr/FCRList'
import { FCRForm } from './pages/fcr/FCRForm'
import { FCRApprovals } from './pages/fcr/FCRApprovals'
import { Acknowledge } from './pages/Acknowledge'
import { WeeklyReport } from './pages/reports/WeeklyReport'
import { Census } from './pages/reports/Census'
import { ExportCenter } from './pages/reports/ExportCenter'
import { EmailLog } from './pages/reports/EmailLog'
import { Users } from './pages/admin/Users'
import { Targets } from './pages/admin/Targets'

function Guard({ children, when = true }) {
  const { user, profile, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Spinner />
  // Remember where they were going (e.g. the FCR photo step opened by QR).
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  if (profile && !profile.active) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="panel max-w-md p-6 text-center">
          <h1 className="text-[17px]">Your account is not set up yet</h1>
          <p className="text-[13px] text-ink-3 mt-2">You signed in as {user.email}, which is not on the ACS org roster. Ask the ACS admin to add you; nothing is visible until then.</p>
        </div>
      </div>
    )
  }
  if (!when) return <Navigate to="/dashboard" replace />
  return children
}

function LoginRoute() {
  const { user, loading } = useAuth()
  const { state } = useLocation()
  if (loading) return <Spinner />
  if (user) return <Navigate to={state?.from && state.from !== '/login' ? state.from : '/dashboard'} replace />
  return <Login />
}

export default function App() {
  const { user, loading, isApprover, hasTeam, isAdmin } = useAuth()

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="panel max-w-lg p-6">
          <h1 className="text-[17px]">Supabase is not configured</h1>
          <p className="text-[13px] text-ink-3 mt-2">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (in .env.local for development, or as GitHub Actions secrets for the deployed site). See docs/SETUP.md.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Toaster position="top-right" closeButton toastOptions={{ style: { fontFamily: 'Inter, sans-serif', fontSize: 13 } }} />
      <DialogHost />
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        {/* Public, no login: the customer's acknowledgement page */}
        <Route path="/acknowledge/:token" element={<Acknowledge />} />

        <Route element={<Guard><Layout /></Guard>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/accounts" element={<AccountList />} />
          <Route path="/accounts/new" element={<AccountForm />} />
          <Route path="/accounts/:id" element={<AccountDetail />} />
          <Route path="/accounts/:id/edit" element={<AccountForm />} />

          <Route path="/mcp/plan" element={<PlanList />} />
          <Route path="/mcp/plan/new" element={<PlanForm />} />
          <Route path="/mcp/plan/:id" element={<PlanForm />} />
          <Route path="/mcp/approvals" element={<Guard when={isApprover}><PlanApprovals /></Guard>} />
          <Route path="/mcp/actual" element={<McpActual />} />
          <Route path="/mcp/archive" element={<McpArchive />} />

          <Route path="/fcr" element={<FCRList />} />
          <Route path="/fcr/new" element={<FCRForm />} />
          <Route path="/fcr/approvals" element={<Guard when={isApprover}><FCRApprovals /></Guard>} />
          <Route path="/fcr/:id" element={<FCRForm />} />

          <Route path="/reports/weekly" element={<Guard when={hasTeam}><WeeklyReport /></Guard>} />
          <Route path="/reports/census" element={<Guard when={hasTeam}><Census /></Guard>} />
          <Route path="/reports/export" element={<Guard when={hasTeam}><ExportCenter /></Guard>} />
          <Route path="/reports/email-log" element={<EmailLog />} />
          <Route path="/admin/users" element={<Guard when={isAdmin}><Users /></Guard>} />
          <Route path="/admin/targets" element={<Guard when={isAdmin}><Targets /></Guard>} />
        </Route>
        <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </>
  )
}
