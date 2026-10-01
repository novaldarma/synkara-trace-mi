import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../services/supabase'
import WorkspaceNav from './WorkspaceNav'

type AccessState = 'checking' | 'allowed' | 'denied' | 'error'

export default function AuthGuard({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<AccessState>('checking')
  const location = useLocation()

  useEffect(() => {
    let active = true
    let checkVersion = 0

    async function checkAccess() {
      const version = ++checkVersion
      const { data: userResult, error: authError } = await supabase.auth.getUser()
      if (!active || version !== checkVersion) return
      if (authError) {
        setAccess(authError.name === 'AuthSessionMissingError' ? 'denied' : 'error')
        return
      }
      if (!userResult.user) {
        setAccess('denied')
        return
      }

      const { data: membership, error: membershipError } = await supabase
        .from('app_memberships')
        .select('is_active')
        .eq('user_id', userResult.user.id)
        .maybeSingle()

      if (!active || version !== checkVersion) return
      if (membershipError) {
        setAccess('error')
        return
      }
      setAccess(membership?.is_active ? 'allowed' : 'denied')
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (active && event === 'SIGNED_OUT') {
        checkVersion++
        setAccess('denied')
      }
    })

    void checkAccess()
    return () => {
      active = false
      checkVersion++
      listener.subscription.unsubscribe()
    }
  }, [])

  if (access === 'checking') return <p className="route-status" role="status">Checking access…</p>
  if (access === 'error') {
    return <p className="route-status" role="alert">Access could not be checked. Please reload.</p>
  }
  if (access === 'denied') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <><WorkspaceNav />{children}</>
}
