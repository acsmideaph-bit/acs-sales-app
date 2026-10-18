import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { canWrite, canFile, isGlobalReader } from '../lib/roles'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [hasReports, setHasReports] = useState(false)
  const [hasKamReports, setHasKamReports] = useState(false)
  const [holdsDealers, setHoldsDealers] = useState(false)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)
  // Two-step login: aal1 = password only, aal2 = password + authenticator code.
  // nextLevel is aal2 once an authenticator app is set up.
  const [aal, setAal] = useState({ currentLevel: null, nextLevel: null })

  // Reads the level from the session token itself (no network call).
  const loadAal = useCallback(async () => {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    setAal({ currentLevel: data?.currentLevel || null, nextLevel: data?.nextLevel || null })
  }, [])

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); setHasReports(false); setHasKamReports(false); setHoldsDealers(false); return }
    const [{ data: p }, { data: reports }, { data: holders }] = await Promise.all([
      supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('user_profiles').select('id, role').eq('supervisor_id', userId).eq('active', true),
      supabase.rpc('dealer_holder_ids'),
    ])
    // Non-KAMs the TTA plan assigns dealers to also file (e.g. an RSM covering
    // accounts until he assigns them); their superior then approves.
    const holderSet = new Set(holders || [])
    setProfile(p || null)
    setHasReports((reports || []).length > 0)
    setHasKamReports((reports || []).some((r) => r.role === 'kam' || holderSet.has(r.id)))
    setHoldsDealers(holderSet.has(userId))
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await Promise.all([loadProfile(data.session?.user?.id), loadAal()])
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
      // Defer: calling supabase inside this callback can deadlock auth.
      setTimeout(() => { loadProfile(s?.user?.id); loadAal() }, 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile, loadAal])

  // Admin rights count only after the authenticator code (the database
  // enforces the same rule: is_admin() needs aal2). Until then an admin sees
  // only the two-step screen.
  const adminRole = profile?.role === 'admin' && profile?.active
  const twoStepDone = aal.currentLevel === 'aal2'

  const value = {
    session,
    user: session?.user || null,
    profile,
    loading,
    // An "approver" has filers reporting directly to them: KAMs (so the
    // RSMs), or a dealer holder who is not a KAM (so his superior).
    isApprover: hasKamReports && canWrite(profile),
    hasTeam: hasReports || isGlobalReader(profile),
    canWrite: canWrite(profile),
    canFile: canFile(profile, holdsDealers),
    holdsDealers,
    isAdmin: adminRole && twoStepDone,
    needsTwoStep: Boolean(adminRole && !twoStepDone),
    twoStepOn: aal.nextLevel === 'aal2',
    refreshAal: loadAal,
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
