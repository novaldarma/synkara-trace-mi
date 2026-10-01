export function time(value: string | null): string {
  if (!value) return 'Not assigned'
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(d) : 'Unavailable'
}
export const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
export function readSession<T>(key: string): T | null {
  try { const data = JSON.parse(sessionStorage.getItem(key) ?? 'null'); return data?.value && Date.now() - data.at < 86400000 ? data.value as T : null } catch { return null }
}
export function saveSession(key: string, value: unknown) { try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value })) } catch { /* Memory state still supports safe same-page retry. */ } }
export function clearSession(key: string) { try { sessionStorage.removeItem(key) } catch { /* Storage may be disabled. */ } }
export function errorText(e: unknown): string { return e instanceof Error ? e.message : 'The request could not be completed. Please retry.' }
