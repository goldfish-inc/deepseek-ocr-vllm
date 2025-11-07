import { createClient } from '@supabase/supabase-js'
import { env } from './env'

// Optional second Supabase client targeting the vessels dataset project
const vesselsUrl = env.vesselsSupabase.url
const vesselsAnonKey = env.vesselsSupabase.publishableKey

export const supabaseVessels = (() => {
  if (!vesselsUrl || !vesselsAnonKey) {
    console.warn('Vessels Supabase env not set (VITE_VESSELS_SUPABASE_URL/PUBLISHABLE_KEY)')
    return null as unknown as ReturnType<typeof createClient<any>>
  }
  return createClient<any>(vesselsUrl, vesselsAnonKey)
})()
