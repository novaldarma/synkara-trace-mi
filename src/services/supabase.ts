import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL as string | undefined
const supabasePublishableKey = import.meta.env
  .VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabaseConfigurationError = !supabaseUrl ||
  !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl) ||
  !supabasePublishableKey || supabasePublishableKey.includes('YOUR_')

// Keep the app renderable so a missing browser-safe setting has a useful page.
// This placeholder has no credentials or real database access.
const clientUrl = supabaseConfigurationError ? 'https://configuration.invalid' : supabaseUrl!
const clientKey = supabaseConfigurationError ? 'invalid-public-configuration' : supabasePublishableKey!

export const supabase = createClient(clientUrl, clientKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
