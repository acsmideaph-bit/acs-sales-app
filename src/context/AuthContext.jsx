import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { canWrite, canFile, isGlobalReader } from '../lib/roles'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [hasReports, setHasReports] = useState(false)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); setHasReports(false); return }
    const [{ data: p }, { count }] = await Promise.all([
      supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('supervisor_id', userId).eq('active', true),
    ])
    setProfile(p || null)
    setHasReports((count || 0) > 0)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session?.user?.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
      // Defer: calling supabase inside this callback can deadlock auth.
      setTimeout(() => loadProfile(s?.user?.id), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const value = {
    session,
    user: session?.user || null,
    profile,
    loading,
    // An "approver" is anyone with direct reports in the org chart.
    isApprover: hasReports && canWrite(profile),
    hasTeam: hasReports || isGlobalReader(profile),
    canWrite: canWrite(profile),
    canFile: canFile(profile),
    isAdmin: profile?.role === 'admin' && profile?.active,
    recovery,
    endRecovery: () => setRecovery(false),
    refreshProfile: () => loadProfile(session?.user?.id),
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signOut: async () => { await supabase.auth.signOut(); setProfile(null) },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
