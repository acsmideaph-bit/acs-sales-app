import { createClient } from '@supabase/supabase-js'

// The anon key is public by design (RLS protects the data). The service role
// key and the Gmail App Password must never appear in this repo.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

export const supabase = createClient(url || 'https://not-configured.supabase.co', anonKey || 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true },
})

// supabase-js turns any non-2xx Edge Function response into a generic
// "non-2xx status code" error and leaves the real reason in error.context.
// Surface the function's own { error } message instead.
export async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let message = error.message
    try {
      const j = await error.context?.clone?.().json?.()
      if (j?.error) message = j.error
    } catch { /* body not JSON */ }
    throw new Error(message)
  }
  return data
}

// Postgres RPC errors carry the RAISE text in .message -- show that.
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}
