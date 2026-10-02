import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import OverviewCaseEvidence from './OverviewCaseEvidence'
import './overview.css'

type DailyIncident = {
  occurred_date: string
  plant_code: string
  incident_count: number
  recorded_incident_downtime_hours: number
  actual_loss_kusd: number
  potential_loss_kusd: number
}

type FeaturedIncident = {
  record_id: string
  source_id: string
  source_row: number
  occurred_date: string
  plant_code: string
  asset_tag_as_provided: string
  downtime_hours: number
  actual_loss_kusd: number
  title: string | null
}

type Issue = { issue_id: string; title: string; impact_and_handling: string }
type KpiDefinition = {
  kpi_code: string
  formula_text: string | null
  filter_basis: string | null
  limitations: string
}
type Status = 'loading' | 'ready' | 'empty' | 'error'

const kpiCodes = [
  'case2.incident_count', 'case2.recorded_downtime_hours',
  'case2.actual_loss_kusd', 'case2.potential_loss_kusd',
] as const
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compactMoney = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const exactMoney = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const dateLabel = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function dailyRow(value: unknown): DailyIncident | null {
  if (!object(value) || typeof value['occurred_date'] !== 'string' ||
    !/^20\d{2}-\d{2}-\d{2}$/.test(value['occurred_date']) ||
    typeof value['plant_code'] !== 'string') return null
  const count = finite(value['incident_count'])
  const downtime = finite(value['recorded_incident_downtime_hours'])
  const actual = finite(value['actual_loss_kusd'])
  const potential = finite(value['potential_loss_kusd'])
  if (count === null || !Number.isInteger(count) || count < 0 ||
    downtime === null || downtime < 0 || actual === null || actual < 0 ||
    potential === null || potential < 0) return null
  return {
    occurred_date: value['occurred_date'], plant_code: value['plant_code'],
    incident_count: count, recorded_incident_downtime_hours: downtime,
    actual_loss_kusd: actual, potential_loss_kusd: potential,
  }
}

function featuredRow(value: unknown): FeaturedIncident | null {
  if (!object(value) || typeof value['record_id'] !== 'string' ||
    typeof value['source_id'] !== 'string' ||
    typeof value['asset_tag_as_provided'] !== 'string' ||
    typeof value['occurred_date'] !== 'string' ||
    !/^20\d{2}-\d{2}-\d{2}$/.test(value['occurred_date']) ||
    typeof value['plant_code'] !== 'string') return null
  const sourceRow = finite(value['source_row'])
  const downtime = finite(value['downtime_hours'])
  const loss = finite(value['actual_loss_kusd'])
  if (sourceRow === null || !Number.isInteger(sourceRow) || sourceRow < 1 ||
    downtime === null || downtime < 0 || loss === null || loss < 0) return null
  const raw = object(value['raw']) ? value['raw'] : null
  return {
    record_id: value['record_id'], source_id: value['source_id'],
    source_row: sourceRow, occurred_date: value['occurred_date'],
    plant_code: value['plant_code'], asset_tag_as_provided: value['asset_tag_as_provided'],
    downtime_hours: downtime, actual_loss_kusd: loss,
    title: typeof raw?.['Risk Case Title'] === 'string' ? raw['Risk Case Title'] : null,
  }
}

function readableDate(date: string) {
  return dateLabel.format(new Date(`${date}T12:00:00Z`))
}

function readableMonth(month: string) {
  return monthLabel.format(new Date(`${month}-01T12:00:00Z`))
}

// Source stores loss in thousands of USD. Short display is rounded; expanded evidence retains the exact amount.
function money(kusd: number) {
  const dollars = kusd * 1000
  if (dollars === 0) return 'US$0'
  if (dollars >= 1_000_000) return `US$${compactMoney.format(dollars / 1_000_000)}M`
  if (dollars >= 1_000) return `US$${compactMoney.format(dollars / 1_000)}K`
  return `US$${exactMoney.format(dollars)}`
}

function exactUsd(kusd: number) {
  return `US$${exactMoney.format(kusd * 1000)}`
}

function percent(part: number, total: number) {
  if (total === 0) return '0%'
  const share = part / total * 100
  return share > 0 && share < 0.1 ? '<0.1%' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(share)}%`
}

export default function OverviewPage() {
  const navigate = useNavigate()
  const [daily, setDaily] = useState<DailyIncident[]>([])
  const [incidentStatus, setIncidentStatus] = useState<Status>('loading')
  const [featured, setFeatured] = useState<{ scope: string; incident: FeaturedIncident } | null>(null)
  const [featureStatus, setFeatureStatus] = useState<Status>('loading')
  const [qualityIssues, setQualityIssues] = useState<Issue[]>([])
  const [qualityCount, setQualityCount] = useState<number | null>(null)
  const [qualityStatus, setQualityStatus] = useState<Status>('loading')
  const [definitionByCode, setDefinitionByCode] = useState<Map<string, KpiDefinition>>(new Map())
  const [assetCount, setAssetCount] = useState<number | null>(null)
  const [detailedPlantCodes, setDetailedPlantCodes] = useState<string[]>([])
  const [assetStatus, setAssetStatus] = useState<Status>('loading')
  const [rcaCount, setRcaCount] = useState<number | null>(null)
  const [rcaStatus, setRcaStatus] = useState<Status>('loading')
  const [plant, setPlant] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [signOutError, setSignOutError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [incidentResult, qualityResult, definitionResult, assetResult, rcaResult] = await Promise.all([
          supabase.from('dashboard_incident_daily')
            .select('occurred_date,plant_code,incident_count,recorded_incident_downtime_hours,actual_loss_kusd,potential_loss_kusd', { count: 'exact' })
            .order('occurred_date', { ascending: true }).order('plant_code', { ascending: true }).range(0, 999),
          supabase.from('data_quality_issues')
            .select('issue_id,title,impact_and_handling', { count: 'exact' })
            .eq('dataset_id', 'caliber2026_case2').eq('issue_status', 'open').eq('severity', 'P0')
            .order('issue_id').limit(3),
          supabase.from('kpi_definitions')
            .select('kpi_code,formula_text,filter_basis,limitations').in('kpi_code', kpiCodes),
          supabase.from('assets')
            .select('plant_code', { count: 'exact' })
            .eq('dataset_id', 'caliber2026_case2')
            .eq('detailed_observations_available', true).range(0, 999),
          supabase.from('rca_documents')
            .select('document_id', { count: 'exact', head: true })
            .eq('dataset_id', 'caliber2026_case2'),
        ])
        if (!active) return
        const raw = incidentResult.data ?? []
        const parsed = raw.map(dailyRow)
        if (incidentResult.error || incidentResult.count === null ||
          incidentResult.count !== raw.length || parsed.some(row => row === null)) {
          setIncidentStatus('error')
        } else {
          setDaily(parsed as DailyIncident[])
          setIncidentStatus(raw.length === 0 ? 'empty' : 'ready')
        }
        const validIssues = (qualityResult.data ?? []).filter((issue): issue is Issue =>
          typeof issue.issue_id === 'string' && typeof issue.title === 'string' &&
          typeof issue.impact_and_handling === 'string')
        if (qualityResult.error || qualityResult.count === null ||
          validIssues.length !== (qualityResult.data ?? []).length) {
          setQualityStatus('error')
        } else {
          setQualityIssues(validIssues)
          setQualityCount(qualityResult.count)
          setQualityStatus('ready')
        }
        if (!definitionResult.error) {
          const definitions = new Map<string, KpiDefinition>()
          for (const item of definitionResult.data ?? []) {
            if (typeof item.kpi_code === 'string' && typeof item.limitations === 'string') {
              definitions.set(item.kpi_code, item as KpiDefinition)
            }
          }
          setDefinitionByCode(definitions)
        }
        const assetRows = assetResult.data ?? []
        if (assetResult.error || assetResult.count === null ||
          assetResult.count !== assetRows.length ||
          assetRows.some(row => typeof row.plant_code !== 'string')) {
          setAssetStatus('error')
        } else {
          setAssetCount(assetResult.count)
          setDetailedPlantCodes([...new Set(assetRows.map(row => row.plant_code))].sort())
          setAssetStatus('ready')
        }
        if (rcaResult.error || rcaResult.count === null) {
          setRcaStatus('error')
        } else {
          setRcaCount(rcaResult.count)
          setRcaStatus('ready')
        }
      } catch {
        if (active) {
          setIncidentStatus('error')
          setQualityStatus('error')
          setAssetStatus('error')
          setRcaStatus('error')
        }
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const plantLabels = useMemo(() => [...new Set(daily.map(row => row.plant_code))].sort(), [daily])
  const selected = useMemo(() => daily.filter(row =>
    (!plant || row.plant_code === plant) &&
    (!fromDate || row.occurred_date >= fromDate) &&
    (!toDate || row.occurred_date <= toDate),
  ), [daily, plant, fromDate, toDate])
  const totals = useMemo(() => selected.reduce((sum, row) => ({
    count: sum.count + row.incident_count,
    downtime: sum.downtime + row.recorded_incident_downtime_hours,
    actual: sum.actual + row.actual_loss_kusd,
    potential: sum.potential + row.potential_loss_kusd,
  }), { count: 0, downtime: 0, actual: 0, potential: 0 }), [selected])
  const selectedPlantCount = new Set(selected.map(row => row.plant_code)).size
  const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate)
  const scopeKey = `${plant}|${fromDate}|${toDate}`
  const currentIncident = featured?.scope === scopeKey ? featured.incident : null
  const incidentListParams = new URLSearchParams()
  if (plant) incidentListParams.set('plant', plant)
  if (fromDate) incidentListParams.set('from', fromDate)
  if (toDate) incidentListParams.set('through', toDate)
  const incidentListUrl = `/dashboard/problem-tank${incidentListParams.size ? `?${incidentListParams}` : ''}`

  // Select from the same source rows and active filters as the KPIs; do not equate loss rank with safety priority.
  useEffect(() => {
    if (incidentStatus !== 'ready' || invalidDateRange || !selected.length) {
      setFeatured(null)
      setFeatureStatus('empty')
      return
    }
    let active = true
    setFeatured(null)
    setFeatureStatus('loading')
    async function loadFeatured() {
      try {
        let query = supabase.from('incident_records')
          .select('record_id,source_id,source_row,occurred_date,plant_code,asset_tag_as_provided,downtime_hours,actual_loss_kusd,raw')
          .eq('dataset_id', 'caliber2026_case2')
        if (plant) query = query.eq('plant_code', plant)
        if (fromDate) query = query.gte('occurred_date', fromDate)
        if (toDate) query = query.lte('occurred_date', toDate)
        const { data, error } = await query.order('actual_loss_kusd', { ascending: false })
          .order('record_id', { ascending: true }).limit(1)
        if (!active) return
        const item = featuredRow(data?.[0])
        if (error || !item || (plant && item.plant_code !== plant) ||
          (fromDate && item.occurred_date < fromDate) ||
          (toDate && item.occurred_date > toDate)) {
          setFeatureStatus('error')
        } else {
          setFeatured({ scope: scopeKey, incident: item })
          setFeatureStatus('ready')
        }
      } catch {
        if (active) setFeatureStatus('error')
      }
    }
    void loadFeatured()
    return () => { active = false }
  }, [incidentStatus, invalidDateRange, selected.length, scopeKey, plant, fromDate, toDate])

  const trend = useMemo(() => {
    if (!selected.length) return [] as [string, number][]
    const byMonth = new Map<string, number>()
    for (const row of selected) {
      const month = row.occurred_date.slice(0, 7)
      byMonth.set(month, (byMonth.get(month) ?? 0) + row.incident_count)
    }
    const last = selected.at(-1)!.occurred_date
    const lastMonth = Number(last.slice(0, 4)) * 12 + Number(last.slice(5, 7)) - 1
    return Array.from({ length: 12 }, (_, index): [string, number] => {
      const monthIndex = lastMonth - 11 + index
      const key = `${Math.floor(monthIndex / 12)}-${String(monthIndex % 12 + 1).padStart(2, '0')}`
      return [key, byMonth.get(key) ?? 0]
    })
  }, [selected])
  const plantImpact = useMemo(() => {
    const byPlant = new Map<string, number>()
    for (const row of selected) byPlant.set(row.plant_code, (byPlant.get(row.plant_code) ?? 0) + row.recorded_incident_downtime_hours)
    return [...byPlant].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
  }, [selected])
  const trendCount = trend.reduce((sum, [, count]) => sum + count, 0)
  const indicators = [
    { code: kpiCodes[0], label: 'Recorded incidents', value: whole.format(totals.count), detail: 'Source incident rows' },
    { code: kpiCodes[1], label: 'Recorded downtime', value: `${decimal.format(totals.downtime)} h`, detail: 'Hours in Incident Database' },
    { code: kpiCodes[2], label: 'Actual loss in records', value: money(totals.actual), detail: `Exact: ${exactUsd(totals.actual)}` },
    { code: kpiCodes[3], label: 'Potential loss in records', value: money(totals.potential), detail: `Exact: ${exactUsd(totals.potential)}` },
  ]

  async function signOut() {
    setSignOutError('')
    const { error } = await supabase.auth.signOut()
    if (error) { setSignOutError('Could not sign out. Please try again.'); return }
    navigate('/login', { replace: true })
  }

  return <div className="app-shell overview-page">
    <a className="skip-link" href="#dashboard-content">Skip to content</a>
    <header className="app-topbar">
      <Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
      <nav aria-label="Main navigation">
        <span aria-current="page">Overview</span>
        <Link className="secondary-link" to="/sources">Browse source data</Link>
        <button className="secondary-action" type="button" onClick={() => { void signOut() }}>Sign out</button>
      </nav>
    </header>
    <main className="dashboard-content" id="dashboard-content">
      <div className="dashboard-title overview-title">
        <p className="scope-label">SYNKARA · CALIBER 2026 · CASE 2</p>
        <h1>See the impact. Trace the decision.</h1>
        <p>A historical view of recorded incidents, with a clear path to evidence and a reviewed follow-up.</p>
        <p className="overview-dataset-scope">Historical Case 2 competition data · Not live plant telemetry</p>
      </div>
      {signOutError && <p className="route-status" role="alert">{signOutError}</p>}

      <section className="panel overview-portfolio" aria-labelledby="overview-scope-heading">
        <div className="section-heading">
          <div><p className="scope-label">01 / PORTFOLIO</p><h2 id="overview-scope-heading">What was recorded?</h2></div>
          <Link className="text-link" to="/dashboard/foundation">KPI definitions ↗</Link>
        </div>
        <div className="filter-row overview-filter">
          <label>Plant
            <select value={plant} onChange={event => setPlant(event.target.value)}>
              <option value="">All supplied plants</option>
              {plantLabels.map(code => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label>From date <input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
          <label>Through date <input type="date" value={toDate} onChange={event => setToDate(event.target.value)} /></label>
          {(plant || fromDate || toDate) && <button type="button" className="overview-clear" onClick={() => { setPlant(''); setFromDate(''); setToDate('') }}>Clear filters</button>}
        </div>
        {incidentStatus === 'loading' && <p role="status" className="overview-state">Loading the incident portfolio…</p>}
        {incidentStatus === 'error' && <p role="alert" className="overview-state">The complete incident portfolio could not be verified. No totals are shown.</p>}
        {incidentStatus === 'empty' && <p role="status" className="overview-state">No Case 2 incident records are available to this account.</p>}
        {incidentStatus === 'ready' && (invalidDateRange ?
          <p role="alert" className="overview-state">The starting date must not be after the ending date.</p> :
          selected.length === 0 ? <p role="status" className="overview-state">No incidents match these filters. Change the plant or date range.</p> : <>
            <p className="overview-period">Incident Database · Recorded event dates: {readableDate(selected[0]!.occurred_date)} – {readableDate(selected.at(-1)!.occurred_date)} · {selectedPlantCount} plant label{selectedPlantCount === 1 ? '' : 's'}</p>
            {(fromDate || toDate) && <p className="overview-filter-scope">Requested occurrence dates: {fromDate ? readableDate(fromDate) : 'all earlier dates'} – {toDate ? readableDate(toDate) : 'all later dates'}</p>}
            <div className="overview-kpis" aria-label="Recorded incident indicators">
              {indicators.map(indicator => <article className="overview-kpi" key={indicator.code}>
                <span>{indicator.label}</span><strong>{indicator.value}</strong><small>{indicator.detail}</small>
              </article>)}
            </div>
            <details className="overview-method">
              <summary>How these numbers were calculated</summary>
              <p>One Incident Database row counts as one event. Downtime is the recorded incident duration, not Production OFF time. Actual loss is separate from potential loss; both amounts are in US dollars. The short card values are rounded, while the exact values appear beneath them.</p>
              {indicators.some(indicator => definitionByCode.has(indicator.code)) && <ul>{indicators.map(indicator => {
                const definition = definitionByCode.get(indicator.code)
                return definition && <li key={indicator.code}><strong>{indicator.label}:</strong> {definition.formula_text} · {definition.filter_basis}. {definition.limitations}</li>
              })}</ul>}
              <Link to="/data/incidents">Inspect original incident rows →</Link>
            </details>
          </>)}
      </section>

      {incidentStatus === 'ready' && !invalidDateRange && selected.length > 0 && <section className="overview-decision" aria-labelledby="overview-decision-heading">
        <div className="overview-decision-top"><p className="scope-label">02 / DECISION BRIEF</p><span>Historical · highest recorded actual loss</span></div>
        <h2 id="overview-decision-heading">Where should the review start?</h2>
        {(!currentIncident || featureStatus === 'loading') && featureStatus !== 'error' && <p role="status">Finding the highest recorded actual loss in this selection…</p>}
        {featureStatus === 'error' && <p role="alert">An individual source row could not be verified. <Link to={incidentListUrl}>Browse incidents manually →</Link></p>}
        {currentIncident && <div className="overview-decision-grid">
          <div>
            <p className="overview-case-label">{currentIncident.plant_code} · {readableDate(currentIncident.occurred_date)}</p>
            <h3>{currentIncident.asset_tag_as_provided}</h3>
            <p className="overview-case-title">{currentIncident.title ?? 'Recorded incident'}</p>
            <div className="overview-case-facts">
              <div><span>Actual loss</span><strong>{money(currentIncident.actual_loss_kusd)}</strong></div>
              <div><span>Recorded downtime</span><strong>{decimal.format(currentIncident.downtime_hours)} h</strong></div>
            </div>
            <Link className="primary-link" to={`/dashboard/investigation/${encodeURIComponent(currentIncident.record_id)}`}>Open case evidence <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="overview-reason">
            <h3>Why this case?</h3>
            <p>It has the highest <strong>recorded actual loss</strong> among incidents matching these filters: {exactUsd(currentIncident.actual_loss_kusd)}, or {percent(currentIncident.actual_loss_kusd, totals.actual)} of the selected total.</p>
            <h3>Recommended next check</h3>
            <p>Have an engineer verify the incident classification and inspect the linked observations or RCA, if available, before proposing an owned action.</p>
            <p className="overview-caution">Financial review cue only. An RCA may not be supplied for this case; check any linked rendition against the supplied presentation. No safety rank or physical root cause is independently certified by TRACE-MI.</p>
            <details className="overview-proof"><summary>View source of this recommendation</summary>
              <p>Incident Database · row {currentIncident.source_row}. The case link opens the original incident facts and any verified document links. Selection rule: highest actual_loss_kusd; ties by source record ID. Current plant and occurrence-date filters apply.</p>
              <Link to={`/dashboard/investigation/${encodeURIComponent(currentIncident.record_id)}`}>Check row {currentIncident.source_row} and linked evidence →</Link>
            </details>
            <Link className="overview-analysis-link" to={`/dashboard/investigation/${encodeURIComponent(currentIncident.record_id)}`}>Open investigation and TRACE AI ↗</Link>
          </div>
        </div>}
      </section>}

      {currentIncident && incidentStatus === 'ready' && !invalidDateRange && selected.length > 0 &&
        <OverviewCaseEvidence key={currentIncident.record_id} incident={currentIncident} />}

      <section className="panel overview-coverage" aria-labelledby="overview-coverage-heading">
        <div className="section-heading"><div><p className="scope-label">{currentIncident ? '04' : '02'} / SOURCE COVERAGE</p><h2 id="overview-coverage-heading">What evidence is available?</h2></div><Link className="text-link" to="/dashboard/foundation">View source map ↗</Link></div>
        <p className="overview-coverage-intro">These are all-file coverage counts, independent of the incident date filter above. Follow each source for its own time span and units.</p>
        <div className="overview-coverage-grid">
          <div><strong>Incidents</strong><span>{incidentStatus === 'ready' ? `${plantLabels.length} plant labels` : incidentStatus === 'loading' ? 'Checking source coverage…' : 'Coverage unavailable'}</span><Link to={incidentListUrl}>Inspect incidents ↗</Link></div>
          <div><strong>Production + Equipment</strong><span>{assetStatus === 'ready' ? `${assetCount} detailed assets · ${detailedPlantCodes.length} plants` : assetStatus === 'loading' ? 'Checking source coverage…' : 'Coverage unavailable'}</span><span className="overview-coverage-links"><Link to="/dashboard/production">Production ↗</Link><Link to="/dashboard/equipment">Equipment ↗</Link></span></div>
          <div><strong>Root cause reports</strong><span>{rcaStatus === 'ready' ? `${rcaCount} supplied RCA documents` : rcaStatus === 'loading' ? 'Checking source coverage…' : 'Coverage unavailable'}</span><Link to="/dashboard/rca">Inspect RCA ↗</Link></div>
        </div>
        {plant && assetStatus === 'ready' && !detailedPlantCodes.includes(plant) &&
          <p className="overview-coverage-note">No detailed Production or Equipment observations were supplied for {plant}. Its incident records remain available.</p>}
        <p className="overview-coverage-note">Company electricity, tariff and emissions data were not supplied; no company energy or emissions KPI is inferred.</p>
      </section>

      {incidentStatus === 'ready' && !invalidDateRange && selected.length > 0 && <section className="panel overview-patterns" aria-labelledby="overview-pattern-heading">
        <div className="section-heading"><div><p className="scope-label">05 / CONTEXT</p><h2 id="overview-pattern-heading">Patterns behind the totals</h2></div><Link className="text-link" to={incidentListUrl}>Explore selected incidents ↗</Link></div>
        <div className="analysis-grid" aria-label="Filtered incident distribution">
          <div className="chart-card"><h3>Incidents · latest 12 calendar months</h3><p className="overview-chart-scope">{whole.format(trendCount)} of {whole.format(totals.count)} incidents in selected scope · {readableMonth(trend[0]![0])} – {readableMonth(trend.at(-1)![0])}</p><div className="bar-list">{trend.map(([month, value]) =>
            <div className="bar-row" key={month}><span>{month}</span><div className="bar-track"><span style={{ width: `${value === 0 ? 0 : Math.max(2, value / Math.max(...trend.map(item => item[1]), 1) * 100)}%` }} /></div><strong>{value}</strong></div>)}</div></div>
          <div className="chart-card"><h3>{plant ? 'Selected plant · recorded downtime' : 'Top plant labels · recorded downtime'}</h3><div className="bar-list">{plantImpact.map(([code, hours]) =>
            <div className="bar-row" key={code}><span>{code}</span><div className="bar-track"><span style={{ width: `${hours === 0 ? 0 : Math.max(2, hours / Math.max(...plantImpact.map(item => item[1]), 1) * 100)}%` }} /></div><strong>{decimal.format(hours)} h</strong></div>)}</div></div>
        </div>
        <p className="overview-footnote">Both views follow the filters above. Plant order reflects recorded downtime, not operational or safety priority.</p>
      </section>}

      <section className="overview-next" aria-label="Next steps">
        <div><p className="scope-label">GO DEEPER</p><h2>Continue from evidence to action.</h2><p>Explore other incidents, then record a human-reviewed follow-up in the demo workflow.</p></div>
        <div className="overview-next-links"><Link to={incidentListUrl}>Investigate incidents ↗</Link><Link to="/dashboard/actions">Review follow-up actions ↗</Link></div>
      </section>

      <div className="overview-support">
        <section aria-labelledby="overview-energy-heading"><p className="scope-label">SEPARATE EXTERNAL EXAMPLE</p><h2 id="overview-energy-heading">Electricity forecasting</h2>
          <p>Explore four 15-minute kWh predictions from a South Korean steel dataset. Case 2 company electricity readings and tariffs are unavailable.</p>
          <Link to="/dashboard/energy">Open external forecast ↗</Link>
        </section>
        <section aria-labelledby="overview-data-heading"><p className="scope-label">AUDIT THE INPUTS</p><h2 id="overview-data-heading">Evidence and data quality</h2>
          <p>Production and Equipment are separate monitoring sources with different observation frequencies. Historical source coverage is shown above.</p>
          <Link to="/dashboard/foundation">Review data definitions ↗</Link>
          {qualityStatus === 'loading' && <p role="status">Checking source notes…</p>}
          {qualityStatus === 'error' && <p role="alert">Data quality status is unavailable.</p>}
          {qualityStatus === 'ready' && qualityCount === 0 && <p>No open P0 source notes in the catalog.</p>}
          {qualityStatus === 'ready' && qualityIssues.length > 0 && <details><summary>{qualityIssues.length} of {qualityCount} open P0 source notes shown</summary><ul>{qualityIssues.map(issue =>
            <li key={issue.issue_id}><strong>{issue.title}:</strong> {issue.impact_and_handling}</li>)}</ul></details>}
        </section>
      </div>
    </main>
  </div>
}
