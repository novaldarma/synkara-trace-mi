import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import LoginPage from '../pages/LoginPage'
import { supabase, supabaseConfigurationError } from '../services/supabase'
import AuthGuard from './AuthGuard'

const ProductionPage = lazy(() => import('../pages/data/ProductionPage'))
const EquipmentPage = lazy(() => import('../pages/data/EquipmentPage'))
const IncidentsPage = lazy(() => import('../pages/data/IncidentsPage'))
const RCAPage = lazy(() => import('../pages/data/RCAPage'))
const EnergyPage = lazy(() => import('../pages/data/EnergyPage'))
const OverviewPage = lazy(() => import('../pages/dashboard/OverviewPage'))
const ProblemTankPage = lazy(() => import('../pages/dashboard/ProblemTankPage'))
const InvestigationPage = lazy(() => import('../pages/dashboard/InvestigationPage'))
const ActionsPage = lazy(() => import('../pages/dashboard/ActionsPage'))
const DomainDashboardPage = lazy(() => import('../pages/dashboard/DomainDashboardPage'))
const EnergyDashboardPage = lazy(() => import('../pages/dashboard/EnergyDashboardPage'))
const AssistantPage = lazy(() => import('../pages/dashboard/AssistantPage'))
const DataFoundationPage = lazy(() => import('../pages/dashboard/DataFoundationPage'))

const sourcePages = [
  { path: '/data/production', title: 'Production', scope: 'CASE 2 · FIVE ASSETS', description: 'PI Tag metadata and hourly Sheet2 source rows.' },
  { path: '/data/equipment', title: 'Equipment', scope: 'CASE 2 · FIVE ASSETS', description: 'Equipment Info, weekly Condition History, and provided summary.' },
  { path: '/data/incidents', title: 'Incidents', scope: 'CASE 2 · 12 PLANT LABELS', description: 'Incident Database rows and the original summary sheet.' },
  { path: '/data/rca', title: 'RCA', scope: 'CASE 2 · VISUAL REVIEW PENDING', description: 'Five historical decks, team PDF renditions, and slide extracts.' },
  { path: '/data/energy', title: 'EXTERNAL ENERGY', scope: 'UCI STEEL · 2018', description: 'Original external electricity CSV rows, kept separate from Case 2.' },
] as const

type LoadState = 'loading' | 'ready' | 'error'

function WorkspaceEntry() {
  const navigate = useNavigate()
  const [count, setCount] = useState<number | null>(null)
  const [status, setStatus] = useState<LoadState>('loading')
  const [signOutError, setSignOutError] = useState('')

  useEffect(() => {
    let active = true

    async function loadIncidentCount() {
      const { count: total, error } = await supabase
        .from('incident_records')
        .select('record_id', { count: 'exact', head: true })
        .eq('dataset_id', 'caliber2026_case2')

      if (!active) return
      if (error || total === null) {
        setStatus('error')
      } else {
        setCount(total)
        setStatus('ready')
      }
    }

    void loadIncidentCount()
    return () => { active = false }
  }, [])

  async function signOut() {
    setSignOutError('')
    const { error } = await supabase.auth.signOut()
    if (error) {
      setSignOutError('Could not sign out. Please try again.')
      return
    }
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#dashboard-content">Skip to content</a>
      <header className="app-topbar">
        <Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
        <nav aria-label="Workspace navigation">
          <Link className="secondary-link" to="/dashboard">← Overview</Link>
          <span aria-current="page">Source Data</span>
          <button className="secondary-action" type="button" onClick={() => { void signOut() }}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 17l5-5-5-5M15 12H3M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6" />
            </svg>
            Sign out
          </button>
        </nav>
      </header>

      <main id="dashboard-content" className="dashboard-content">
        <div className="dashboard-title">
          <p className="scope-label">EVIDENCE LIBRARY</p>
          <h1>Original records.</h1>
          <p>Browse read-only inputs behind the dashboard. External electricity stays separate.</p>
        </div>
        {signOutError && <p className="route-status" role="alert">{signOutError}</p>}
        {status === 'loading' && <p className="coverage-note" role="status">Checking available sources…</p>}
        {status === 'error' && <p className="route-status" role="alert">The Incident Database count could not be loaded. Check account membership and database access.</p>}
        {status === 'ready' && <p className="coverage-note"><strong>{count?.toLocaleString('en-US')}</strong> historical incident rows in the supplied Case 2 dataset.</p>}
        <section className="panel" aria-labelledby="source-data-heading">
          <h2 id="source-data-heading">Choose a source</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 245px), 1fr))', gap: 14, marginTop: 16 }}>
            {sourcePages.map((item) => <article className="demo-card" key={item.path}>
              <p className="scope-label">{item.scope}</p>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <Link className="secondary-link" to={item.path}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
                Open {item.title}
              </Link>
            </article>)}
          </div>
        </section>
      </main>
    </div>
  )
}

export default function AppRouter() {
  if (supabaseConfigurationError) return <div className="landing-page config-page"><main className="panel" role="alert">
    <p className="scope-label">SETUP REQUIRED</p><h1>Project connection is incomplete.</h1>
    <p>Check the Supabase Project URL and publishable key in the environment for this site. Run <code>npm run check:config</code> locally. No secret key is needed in the browser.</p>
  </main></div>
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading Overview…</p>}><OverviewPage /></Suspense></AuthGuard>
      } />
      <Route path="/dashboard/problem-tank" element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading Problem Tank…</p>}><ProblemTankPage /></Suspense></AuthGuard>
      } />
      <Route path="/dashboard/investigation/:incidentId" element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading Investigation…</p>}><InvestigationPage /></Suspense></AuthGuard>
      } />
      <Route path="/dashboard/actions" element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading Actions…</p>}><ActionsPage /></Suspense></AuthGuard>
      } />
      {(['production','equipment','incidents','rca'] as const).map(domain => <Route key={domain} path={`/dashboard/${domain}`} element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading insights…</p>}><DomainDashboardPage domain={domain} /></Suspense></AuthGuard>
      } />)}
      <Route path="/dashboard/energy" element={<AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading energy analysis…</p>}><EnergyDashboardPage /></Suspense></AuthGuard>} />
      <Route path="/dashboard/assistant" element={<AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading assistant…</p>}><AssistantPage /></Suspense></AuthGuard>} />
      <Route path="/dashboard/foundation" element={<AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading governance map…</p>}><DataFoundationPage /></Suspense></AuthGuard>} />
      <Route path="/sources" element={<AuthGuard><WorkspaceEntry /></AuthGuard>} />
      <Route path="/data/production" element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading Production page…</p>}><ProductionPage /></Suspense></AuthGuard>
      } />
      <Route path="/data/equipment" element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading Equipment page…</p>}><EquipmentPage /></Suspense></AuthGuard>
      } />
      <Route path="/data/incidents" element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading Incidents page…</p>}><IncidentsPage /></Suspense></AuthGuard>
      } />
      <Route path="/data/rca" element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading RCA page…</p>}><RCAPage /></Suspense></AuthGuard>
      } />
      <Route path="/data/energy" element={
        <AuthGuard><Suspense fallback={<p className="route-status" role="status">Loading Energy page…</p>}><EnergyPage /></Suspense></AuthGuard>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
