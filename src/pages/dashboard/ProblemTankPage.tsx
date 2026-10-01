import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import './investigate.css'

type Mode = 'historical' | 'replay'
type Status = 'idle' | 'loading' | 'ready' | 'error'
type SortKey = 'actual_loss_kusd' | 'downtime_hours'
type Filters = { plant: string; assetTag: string; from: string; through: string }
type Asset = { asset_id: string; asset_tag: string; plant_code: string }
type Incident = {
  record_id: string; source_id: string; source_row: number; occurred_date: string
  plant_code: string; asset_tag_as_provided: string
  actual_loss_kusd: number | string; potential_loss_kusd: number | string
  downtime_hours: number | string; overall_status_as_provided: string | null
  raw: Record<string, unknown>
}
type Measure = { parameter_label_raw: string; unit_as_provided: string; value: unknown }
type Condition = {
  observation_id: string; source_id: string; plant_code: string; asset_id: string
  observed_date: string; health_status_as_provided: string
  measurements: Measure[]; availability_assumption: string
}
type Signal = {
  production_record_id: string; source_id: string; plant_code: string; asset_id: string
  observed_at_naive: string; tag_name: string; numeric_value: number | string | null
  text_value: string | null; engineering_unit_as_provided: string | null
}

const PAGE_SIZE = 8
const demoCutoff = '2026-04-22'
const wrap: CSSProperties = { overflowX: 'auto', border: '1px solid #d7e1e3', borderRadius: 6 }
const table: CSSProperties = { width: '100%', minWidth: 780, borderCollapse: 'collapse', fontSize: '.875rem' }
const th: CSSProperties = { padding: 11, textAlign: 'left', whiteSpace: 'nowrap', background: '#eaf3f1', borderBottom: '1px solid #b9ceca' }
const td: CSSProperties = { padding: 11, verticalAlign: 'top', borderBottom: '1px solid #e2eaeb' }
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
const compactMoney = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const validDate = (date: string) => /^20\d{2}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
function dollars(value: number | string) {
  const usd = Number(value) * 1000
  return usd >= 1_000_000 ? `US$${compactMoney.format(usd / 1_000_000)}M` :
    usd >= 1000 ? `US$${compactMoney.format(usd / 1000)}K` : `US$${number.format(usd)}`
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function finite(value: unknown): value is number | string {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))
}
function display(value: unknown): string {
  return value === null || value === undefined || value === '' ? 'Unavailable' : String(value)
}
function fmt(value: number | string): string { return number.format(Number(value)) }
function isIncident(value: unknown): value is Incident {
  if (!object(value)) return false
  return typeof value['record_id'] === 'string' && typeof value['source_id'] === 'string' &&
    typeof value['source_row'] === 'number' && typeof value['occurred_date'] === 'string' &&
    typeof value['plant_code'] === 'string' && typeof value['asset_tag_as_provided'] === 'string' &&
    finite(value['actual_loss_kusd']) && finite(value['potential_loss_kusd']) &&
    finite(value['downtime_hours']) && object(value['raw']) &&
    (value['overall_status_as_provided'] === null || typeof value['overall_status_as_provided'] === 'string')
}
function isAsset(value: unknown): value is Asset {
  return object(value) && typeof value['asset_id'] === 'string' &&
    typeof value['asset_tag'] === 'string' && typeof value['plant_code'] === 'string'
}
function isCondition(value: unknown): value is Condition {
  if (!object(value)) return false
  return typeof value['observation_id'] === 'string' && typeof value['source_id'] === 'string' &&
    typeof value['plant_code'] === 'string' && typeof value['asset_id'] === 'string' &&
    typeof value['observed_date'] === 'string' && typeof value['health_status_as_provided'] === 'string' &&
    value['availability_assumption'] === 'end_of_observation_day_team_assumption' &&
    Array.isArray(value['measurements']) && value['measurements'].every((item: unknown) =>
      object(item) && typeof item['parameter_label_raw'] === 'string' &&
      typeof item['unit_as_provided'] === 'string' &&
      (finite(item['value']) || item['value'] === null))
}
function isSignal(value: unknown): value is Signal {
  if (!object(value)) return false
  return typeof value['production_record_id'] === 'string' && typeof value['source_id'] === 'string' &&
    typeof value['plant_code'] === 'string' && typeof value['asset_id'] === 'string' &&
    typeof value['observed_at_naive'] === 'string' && typeof value['tag_name'] === 'string' &&
    (value['numeric_value'] === null || finite(value['numeric_value'])) &&
    (value['text_value'] === null || typeof value['text_value'] === 'string') &&
    (value['engineering_unit_as_provided'] === null || typeof value['engineering_unit_as_provided'] === 'string')
}

export default function ProblemTankPage() {
  const [params] = useSearchParams()
  const initialFilters: Filters = {
    plant: params.get('plant') ?? '', assetTag: params.get('tag') ?? '',
    from: validDate(params.get('from') ?? '') ? params.get('from')! : '',
    through: validDate(params.get('through') ?? '') ? params.get('through')! : '',
  }
  const initialCutoff = validDate(params.get('cutoff') ?? '') ? params.get('cutoff')! : demoCutoff
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'replay' ? 'replay' : 'historical')
  const [plants, setPlants] = useState<string[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [catalogStatus, setCatalogStatus] = useState<Status>('loading')
  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [sort, setSort] = useState<SortKey>(params.get('sort') === 'downtime_hours' ? 'downtime_hours' : 'actual_loss_kusd')
  const [page, setPage] = useState(Math.min(47, Math.max(0, Number.parseInt(params.get('page') ?? '0', 10) || 0)))
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [incidentCount, setIncidentCount] = useState<number | null>(null)
  const [incidentStatus, setIncidentStatus] = useState<Status>('idle')
  const [assetId, setAssetId] = useState('')
  const [cutoffDraft, setCutoffDraft] = useState(initialCutoff)
  const [cutoff, setCutoff] = useState(initialCutoff)
  const [conditions, setConditions] = useState<Condition[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [replayStatus, setReplayStatus] = useState<Status>('idle')

  useEffect(() => {
    let active = true
    async function loadCatalog() {
      const [plantResult, assetResult] = await Promise.all([
        supabase.from('plants').select('plant_code').eq('dataset_id', 'caliber2026_case2').order('plant_code'),
        supabase.from('assets').select('asset_id,asset_tag,plant_code')
          .eq('dataset_id', 'caliber2026_case2').eq('detailed_observations_available', true).order('asset_tag'),
      ])
      if (!active) return
      const rawPlants = plantResult.data ?? []
      const rawAssets = assetResult.data ?? []
      if (plantResult.error || assetResult.error ||
        rawPlants.some((row) => typeof row.plant_code !== 'string') || rawAssets.some((row) => !isAsset(row))) {
        setCatalogStatus('error')
        return
      }
      const validAssets = rawAssets as Asset[]
      setPlants(rawPlants.map((row) => row.plant_code))
      setAssets(validAssets)
      const requested = validAssets.find((asset) => asset.asset_id === params.get('asset'))
      setAssetId(requested?.asset_id ?? validAssets.find((asset) => asset.asset_tag === 'KO-3201')?.asset_id ?? validAssets[0]?.asset_id ?? '')
      setCatalogStatus('ready')
    }
    void loadCatalog()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (mode !== 'historical' || catalogStatus !== 'ready') return
    let active = true
    setIncidents([])
    setIncidentCount(null)
    setIncidentStatus('loading')
    async function loadIncidents() {
      let query = supabase.from('incident_records')
        .select('record_id,source_id,source_row,occurred_date,plant_code,asset_tag_as_provided,actual_loss_kusd,potential_loss_kusd,downtime_hours,overall_status_as_provided,raw', { count: 'exact' })
        .eq('dataset_id', 'caliber2026_case2')
        .order(sort, { ascending: false }).order('record_id', { ascending: true })
      if (filters.plant) query = query.eq('plant_code', filters.plant)
      if (filters.assetTag) query = query.eq('asset_tag_as_provided', filters.assetTag)
      if (filters.from) query = query.gte('occurred_date', filters.from)
      if (filters.through) query = query.lte('occurred_date', filters.through)
      const { data, count, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (!active) return
      if (error || count === null || (data ?? []).some((row) => !isIncident(row))) {
        setIncidentStatus('error')
        return
      }
      setIncidents((data ?? []) as Incident[])
      setIncidentCount(count)
      setIncidentStatus('ready')
    }
    void loadIncidents()
    return () => { active = false }
  }, [mode, catalogStatus, filters, sort, page])

  useEffect(() => {
    if (mode !== 'replay' || catalogStatus !== 'ready' || !assetId) return
    let active = true
    setConditions([])
    setSignals([])
    setReplayStatus('loading')
    async function loadReplay() {
      const asOf = `${cutoff}T23:59:00`
      const [equipment, production] = await Promise.all([
        supabase.rpc('replay_equipment_condition', { p_asset_id: assetId, p_as_of: asOf })
          .order('observed_date', { ascending: false }).order('observation_id', { ascending: true }).limit(100),
        supabase.rpc('replay_production_signals', { p_asset_id: assetId, p_as_of: asOf })
          .order('observed_at_naive', { ascending: false }).order('production_record_id', { ascending: true })
          .order('tag_name', { ascending: true }).limit(168),
      ])
      if (!active) return
      const weekly = equipment.data ?? []
      const hourly = production.data ?? []
      const selected = assets.find((asset) => asset.asset_id === assetId)
      if (equipment.error || production.error || !selected || weekly.length === 100 ||
        weekly.some((row: unknown) => !isCondition(row) || row.asset_id !== assetId ||
          row.plant_code !== selected.plant_code || row.observed_date > cutoff) ||
        hourly.some((row: unknown) => !isSignal(row) || row.asset_id !== assetId ||
          row.plant_code !== selected.plant_code || row.observed_at_naive > asOf)) {
        setReplayStatus('error')
        return
      }
      setConditions(weekly as Condition[])
      setSignals(hourly as Signal[])
      setReplayStatus('ready')
    }
    void loadReplay()
    return () => { active = false }
  }, [mode, catalogStatus, assetId, cutoff, assets])

  function changeMode(next: Mode) {
    if (next === mode) return
    setMode(next)
    setIncidents([])
    setIncidentCount(null)
    setIncidentStatus('idle')
    setConditions([])
    setSignals([])
    setReplayStatus('idle')
  }
  function submitHistorical(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.from && draft.through && draft.from > draft.through) return
    setPage(0)
    setFilters({ ...draft, assetTag: draft.assetTag.trim().toUpperCase() })
  }
  function submitReplay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (cutoffDraft) setCutoff(cutoffDraft)
  }

  const selectedAsset = assets.find((asset) => asset.asset_id === assetId)
  const latestCondition = conditions[0]
  const earlierConditions = conditions.slice(1)
  const historyQuery = new URLSearchParams({ mode: 'historical', plant: filters.plant,
    tag: filters.assetTag, from: filters.from, through: filters.through, sort, page: String(page) })
  const backPath = `/dashboard/problem-tank?${historyQuery.toString()}`
  const hourlyGroups = useMemo(() => {
    const groups = new Map<string, Signal[]>()
    for (const signal of signals) {
      const group = groups.get(signal.observed_at_naive) ?? []
      group.push(signal)
      groups.set(signal.observed_at_naive, group)
    }
    return [...groups.entries()]
  }, [signals])
  const rangeError = Boolean(draft.from && draft.through && draft.from > draft.through)

  return <div className="app-shell investigate-page">
    <a className="skip-link" href="#problem-tank-content">Skip to content</a>
    <header className="app-topbar">
      <Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
      <nav aria-label="Dashboard navigation"><Link className="secondary-link" to="/dashboard">← Overview</Link><span aria-current="page">Problem Tank</span></nav>
    </header>
    <main className="dashboard-content" id="problem-tank-content">
      <div className="dashboard-title">
        <p className="scope-label">CASE 2 · ANALYSIS DASHBOARD</p>
        <h1>Investigate recorded issues</h1>
        <p>Review historical incidents or inspect the observations available by a chosen date. Each mode keeps its own evidence and time boundary.</p>
      </div>
      <section className="panel" aria-label="Choose analysis mode">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button className={mode === 'historical' ? 'primary-link' : 'secondary-action'} type="button" aria-pressed={mode === 'historical'} onClick={() => changeMode('historical')}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h11M4 18h7" /></svg>
            Review recorded incidents
          </button>
          <button className={mode === 'replay' ? 'primary-link' : 'secondary-action'} type="button" aria-pressed={mode === 'replay'} onClick={() => changeMode('replay')}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 7v5l3 2M12 3a9 9 0 1 0 9 9" /></svg>
            Rewind asset observations
          </button>
        </div>
      </section>
      {catalogStatus === 'loading' && <p className="route-status" role="status">Loading the Case 2 plant and asset catalog…</p>}
      {catalogStatus === 'error' && <p className="route-status" role="alert">The plant or asset catalog is unavailable. Check membership and source permissions.</p>}

      {mode === 'historical' && catalogStatus === 'ready' && <>
        <section className="panel" aria-labelledby="review-heading">
          <p className="scope-label">RETROSPECTIVE · SUPPLIED INCIDENT DATABASE</p>
          <div className="section-heading"><h2 id="review-heading">Incidents to review</h2><button className="text-link button-link" type="button" onClick={() => {
            const example = { plant: 'ZCU', assetTag: 'KO-3201', from: '2026-04-29', through: '2026-04-29' }
            setDraft(example); setFilters(example); setPage(0)
          }}>Try KO-3201 · 29 Apr ↗</button></div>
          <p className="source-note">This is a retrospective queue ordered by a recorded financial or downtime measure. It does not rank safety or current operational urgency.</p>
          <form onSubmit={submitHistorical}>
            <div className="filter-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
              <label>Plant label<select value={draft.plant} onChange={(event) => setDraft({ ...draft, plant: event.target.value })}>
                <option value="">All supplied plants</option>
                {plants.map((plant) => <option key={plant} value={plant}>{plant}</option>)}
              </select></label>
              <label>Exact asset tag<input type="search" value={draft.assetTag} onChange={(event) => setDraft({ ...draft, assetTag: event.target.value })} placeholder="e.g. KO-3201" /></label>
              <label>From occurrence date<input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
              <label>Through occurrence date<input type="date" value={draft.through} onChange={(event) => setDraft({ ...draft, through: event.target.value })} /></label>
            </div>
            {rangeError && <p role="alert">The starting date must not follow the ending date.</p>}
            <div className="investigate-filter-actions"><button className="secondary-action" type="submit" disabled={rangeError}>Apply filters →</button>
              <button className="investigate-clear" type="button" onClick={() => { const reset = { plant: '', assetTag: '', from: '', through: '' }; setDraft(reset); setFilters(reset); setPage(0) }}>Clear filters</button></div>
          </form>
          <label className="tariff-field">Rank by source measure
            <select value={sort} onChange={(event) => { setSort(event.target.value as SortKey); setPage(0) }}>
              <option value="actual_loss_kusd">Actual loss (US$), highest first</option>
              <option value="downtime_hours">Recorded downtime (hours), highest first</option>
            </select>
          </label>
          <p className="source-note">Tie breaker: internal source record ID ascending. Potential loss is displayed separately and does not affect either sort. Overall Status is a workbook snapshot, not its value at the event date.</p>
          {incidentStatus === 'loading' && <p role="status">Loading ranked incidents…</p>}
          {incidentStatus === 'error' && <p role="alert">The incident list could not be loaded or checked.</p>}
          {incidentStatus === 'ready' && <>
            <p role="status">{incidentCount === 0 ? 'No incidents match these filters.' : `${incidentCount?.toLocaleString('en-US')} matching incidents · page ${page + 1}`}</p>
            {incidents.length > 0 && <div className="incident-list">{incidents.map((item) => <article className="incident-card" key={item.record_id}>
              <div className="incident-identity"><span>{item.plant_code} · {item.occurred_date}</span><h3>{item.asset_tag_as_provided}</h3><small>Incident Database · row {item.source_row}</small></div>
              <div className="incident-values"><div><small>Actual loss</small><strong>{dollars(item.actual_loss_kusd)}</strong></div><div><small>Downtime</small><strong>{fmt(item.downtime_hours)} <small>h</small></strong></div></div>
              <Link className="secondary-link" to={`/dashboard/investigation/${encodeURIComponent(item.record_id)}?${new URLSearchParams({ back: backPath })}`}>Inspect evidence ↗</Link>
              <details className="inline-evidence"><summary>More source fields</summary><p>Potential loss: {dollars(item.potential_loss_kusd)} (source: {fmt(item.potential_loss_kusd)} thousand USD) · Risk Score: {display(item.raw['Risk Score'])} · Status snapshot: {display(item.overall_status_as_provided)} · Record ID: {item.record_id} · Source ID: {item.source_id}</p></details>
            </article>)}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
              <button className="secondary-action" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>← Previous page</button>
              <button className="secondary-action" type="button" disabled={incidentCount === null || (page + 1) * PAGE_SIZE >= incidentCount} onClick={() => setPage((value) => value + 1)}>Next page →</button>
            </div>
            <p className="source-note">Risk Score is copied from the original row; its scoring formula was not provided. Rows and rankings are retrospective and depend on the active plant and date filters.</p>
          </>}
        </section>
      </>}

      {mode === 'replay' && catalogStatus === 'ready' && <>
        <section className="panel" aria-labelledby="replay-heading">
          <p className="scope-label">HISTORICAL AS-OF VIEW · SOURCE CUTOFF</p>
          <h2 id="replay-heading">What had been recorded by this date?</h2>
          <p className="source-note">Weekly Equipment readings become available at the end of their date in this replay; Production uses its recorded hour. Source time zone is unverified.</p>
          <form onSubmit={submitReplay}>
            <div className="filter-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
              <label>Detailed asset<select value={assetId} onChange={(event) => { setAssetId(event.target.value); setReplayStatus('loading') }}>
                {assets.map((asset) => <option key={asset.asset_id} value={asset.asset_id}>{asset.asset_tag} · {asset.plant_code}</option>)}
              </select></label>
              <label>End of date (23:59)<input type="date" required value={cutoffDraft} onChange={(event) => setCutoffDraft(event.target.value)} /></label>
            </div>
            <button className="secondary-action" type="submit" style={{ marginTop: 14 }}>Apply historical cutoff →</button>
          </form>
          {selectedAsset && <p className="source-note">Showing {selectedAsset.asset_tag}, {selectedAsset.plant_code} through {cutoff} 23:59 (naive source time). This date may be before or after an incident; no incident conclusions are retrieved here.</p>}
          {assets.length === 0 && <p role="status">No detailed asset is available for replay.</p>}
          {replayStatus === 'loading' && <p role="status">Loading cutoff-limited observations…</p>}
          {replayStatus === 'error' && <p role="alert">Replay data could not be loaded or validated for this cutoff. No partial or future readings are shown.</p>}
        </section>

        {replayStatus === 'ready' && <>
          <section className="panel" aria-labelledby="weekly-heading">
            <p className="scope-label">EQUIPMENT · WEEKLY CONDITION HISTORY</p>
            <h2 id="weekly-heading">Latest condition available</h2>
            {!latestCondition ? <p role="status">No weekly Equipment observation is available by this cutoff. Condition is unknown.</p> : <>
              <div className="condition-highlight"><div><span>Source health status</span><strong>{latestCondition.health_status_as_provided}</strong><small>Observed {latestCondition.observed_date}</small></div>
                {latestCondition.measurements.filter(m => /vibration|water/i.test(m.parameter_label_raw)).slice(0, 2).map((m, i) => <div key={`${m.parameter_label_raw}-${i}`}><span>{m.parameter_label_raw}</span><strong>{finite(m.value) ? fmt(m.value) : display(m.value)} <small>{m.unit_as_provided}</small></strong><small>Weekly Equipment</small></div>)}
              </div>
              <div className="investigate-source-links"><Link className="text-link" to={`/data/equipment?${new URLSearchParams({ source: latestCondition.source_id, observation: latestCondition.observation_id })}#equipment-source-observation`}>Open this exact Condition History row ↗</Link></div>
              <details className="inline-evidence"><summary>View all Equipment measurements and source IDs</summary><div style={wrap}><table style={table}>
                <thead><tr><th style={th}>Measured parameter in Equipment</th><th style={th}>Recorded value</th><th style={th}>Source date</th></tr></thead>
                <tbody>{latestCondition.measurements.map((measure, index) => <tr key={`${measure.parameter_label_raw}-${index}`}>
                  <td style={td}>{measure.parameter_label_raw}</td>
                  <td style={td}>{finite(measure.value) ? fmt(measure.value) : display(measure.value)} {measure.unit_as_provided}</td>
                  <td style={td}>{latestCondition.observed_date}</td>
                </tr>)}</tbody>
              </table></div><p className="source-note">Observation {latestCondition.observation_id} · {latestCondition.source_id}</p></details>
              {conditions.length > 1 && <div className="investigate-weekly-preview" aria-label="Recent weekly source status history">{conditions.slice(0, 4).reverse().map(row =>
                <div key={row.observation_id}><time dateTime={row.observed_date}>{row.observed_date}</time><strong>{row.health_status_as_provided}</strong><small>{row.measurements.find(m => /vibration|water|temperature|pressure/i.test(m.parameter_label_raw))?.parameter_label_raw ?? 'Weekly observation'}</small></div>)}</div>}
              <details style={{ marginTop: 16 }}><summary>Earlier weekly observations available by cutoff ({earlierConditions.length})</summary>
                <div style={{ ...wrap, marginTop: 12 }}><table style={table}><thead><tr><th style={th}>Observed date</th><th style={th}>Source status</th><th style={th}>Values as provided</th><th style={th}>Source ID</th></tr></thead>
                  <tbody>{earlierConditions.map((row) => <tr key={row.observation_id}><td style={td}>{row.observed_date}</td><td style={td}>{row.health_status_as_provided}</td><td style={td}>{row.measurements.map((m) => `${m.parameter_label_raw}: ${finite(m.value) ? fmt(m.value) : display(m.value)} ${m.unit_as_provided}`).join(' · ')}</td><td style={td}>{row.observation_id}</td></tr>)}</tbody>
                </table></div>
              </details>
            </>}
            <p className="source-note">Weekly Equipment measurements retain the units in that source. Health Status is the provided label. The historical operating alarm configuration and time of availability have not been verified.</p>
          </section>
          <section className="panel" aria-labelledby="hourly-heading">
            <p className="scope-label">PRODUCTION · HOURLY SIGNALS · SEPARATE SOURCE</p>
            <h2 id="hourly-heading">Recent hourly observations by cutoff</h2>
            {signals.length === 0 ? <p role="status">No hourly Production observation is available by this cutoff. This does not imply that the asset was running normally.</p> : <>
              <p>{hourlyGroups.length} recent recorded hours available by the cutoff. These are source samples, not a continuous plant-wide operating history.</p>
              <div className="investigate-hourly-preview"><strong>Latest recorded hour · {hourlyGroups[0]?.[0]}</strong><p>{hourlyGroups[0]?.[1].slice(0, 3).map(signal => `${signal.tag_name}: ${signal.numeric_value !== null ? fmt(signal.numeric_value) : display(signal.text_value)} ${signal.engineering_unit_as_provided ?? ''}`).join(' · ')}</p></div>
              <details className="inline-evidence"><summary>Inspect hourly Production readings ({signals.length} tag rows)</summary><div style={wrap}><table style={table}>
                <thead><tr><th style={th}>Source hour</th><th style={th}>Production signal and value</th><th style={th}>Source record</th></tr></thead>
                <tbody>{hourlyGroups.map(([timestamp, group]) => <tr key={timestamp}>
                  <td style={td}>{timestamp}</td>
                  <td style={td}>{group.map((signal) => <div key={`${signal.production_record_id}-${signal.tag_name}`} style={{ marginBottom: 5 }}>
                    <strong>{signal.tag_name}</strong>: {signal.numeric_value !== null ? fmt(signal.numeric_value) : display(signal.text_value)} {signal.engineering_unit_as_provided ?? ''}
                  </div>)}</td>
                  <td style={td}>{group[0]?.production_record_id}<br /><small>{group[0]?.source_id}</small></td>
                </tr>)}</tbody>
              </table></div></details>
            </>}
            <p className="source-note">Production vibration (MM/S in the KO-3201 file) is a different measurement from Equipment vibration (micron). No unit conversion or unified trend is inferred. RUN_STATUS OFF is a recorded observation, not official incident downtime.</p>
          </section>
          {['ALARM', 'TRIP'].includes(latestCondition?.health_status_as_provided ?? '') && <section className="panel" aria-labelledby="next-step-heading">
            <h2 id="next-step-heading">Inspection candidate</h2>
            <p>Review the recorded {latestCondition?.health_status_as_provided} with an engineer. Verify the instrument, measurement point, and historical alarm configuration before choosing a check under the applicable procedure. The source label alone does not establish a cause or prove an incident was preventable.</p>
          </section>}
          <p className="replay-boundary">Only observations through {cutoff} are shown. Inspecting an incident or RCA opens a separate retrospective view; their conclusions were not available to this replay.</p>
        </>}
      </>}
    </main>
  </div>
}
