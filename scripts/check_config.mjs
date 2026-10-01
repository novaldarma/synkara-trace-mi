import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const path = resolve('.env.local')
if (!existsSync(path)) {
  console.error('Missing .env.local in the folder that contains package.json.')
  process.exitCode = 1
} else {
  const entries = Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/)
    .filter(line => line.trim() && !line.trimStart().startsWith('#') && line.includes('='))
    .map(line => { const index = line.indexOf('='); return [line.slice(0,index).trim(), line.slice(index+1).trim()] }))
  const url = entries.VITE_PUBLIC_SUPABASE_URL ?? ''
  const key = entries.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    console.error('Invalid VITE_PUBLIC_SUPABASE_URL. Copy the exact Project URL from Supabase settings.')
    process.exitCode = 1
  }
  if (!key || key.includes('YOUR_')) {
    console.error('Missing VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Use the browser-safe publishable key.')
    process.exitCode = 1
  }
  if (!process.exitCode) console.log('Public Supabase configuration format looks valid. Live access is not checked.')
}
