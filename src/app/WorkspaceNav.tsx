import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const explore = [
  ['/dashboard/production', 'Production analysis'],
  ['/dashboard/equipment', 'Equipment analysis'],
  ['/dashboard/incidents', 'Incident analysis'],
  ['/dashboard/rca', 'RCA analysis'],
  ['/dashboard/assistant', 'Evidence assistant'],
  ['/dashboard/foundation', 'Data & KPI definitions'],
  ['/sources', 'Original source records'],
] as const
const guides = {
  walkthrough: { label:'Judge walkthrough', next:'/dashboard', hint:'Follow the three steps: see the portfolio, investigate one case, then inspect a reviewed action.' },
  decision: { label:'Management decisions', next:'/dashboard', hint:'Start with filtered impact and a source-linked reason before choosing a case.' },
  evidence: { label:'Engineering evidence', next:'/dashboard/problem-tank', hint:'Check original observations and limitations before proposing a follow-up.' },
  followup: { label:'Follow-up coordination', next:'/dashboard/actions', hint:'Review ownership, deadlines, supporting records and saved history.' },
} as const
type Guide = keyof typeof guides

export default function WorkspaceNav() {
  const { pathname } = useLocation()
  const [guide,setGuide] = useState<Guide>(() => {
    try { const saved = window.localStorage.getItem('synkara-view-guide'); return saved && saved in guides ? saved as Guide : 'walkthrough' }
    catch { return 'walkthrough' }
  })
  const more = useRef<HTMLDetailsElement>(null)
  useEffect(() => { more.current?.removeAttribute('open') }, [pathname])
  const exploring = explore.some(([href]) => pathname === href || pathname.startsWith(`${href}/`)) || pathname.startsWith('/data/')
  return <nav className="workspace-nav" aria-label="Main workspace">
    <div className="workspace-nav-inner">
      <NavLink to="/dashboard" end>Overview</NavLink>
      <NavLink to="/dashboard/problem-tank" className={({ isActive }) => isActive || pathname.startsWith('/dashboard/investigation/') ? 'active' : ''}>Investigate</NavLink>
      <NavLink to="/dashboard/actions">Actions</NavLink>
      <NavLink to="/dashboard/energy">Energy forecast <small>external</small></NavLink>
      <details ref={more} className={`workspace-more${exploring ? ' active' : ''}`}>
        <summary>Explore <span aria-hidden="true">▾</span></summary>
        <div className="workspace-more-menu">
          <p>ANALYSIS & EVIDENCE</p>
          {explore.map(([href, label]) => <NavLink key={href} to={href}>{label}</NavLink>)}
        </div>
      </details>
      <label className="workspace-guide">View guide
        <select value={guide} onChange={event => { const next=event.target.value as Guide; setGuide(next); try { window.localStorage.setItem('synkara-view-guide',next) } catch { /* Guidance still works without storage. */ } }}>
          {Object.entries(guides).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}
        </select>
      </label>
    </div>
    {guide !== 'walkthrough' && <p className="workspace-guide-hint">{guides[guide].hint} <NavLink to={guides[guide].next}>Open suggested page ↗</NavLink> · Viewing guide only; account permissions and data stay the same.</p>}
  </nav>
}
