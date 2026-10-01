import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../services/supabase'

const PAGE_SIZE = 25

type Source = { source_id: string; relative_path: string; source_sha256: string }
type Plant = { plant_code: string }
type Incident = {
  record_id: string
  source_row: number
  source_id: string
  occurred_date_raw: string
  plant_code: string
  asset_tag_as_provided: string
  ar_no: string | null
  mto_no: string | null
  overall_status_as_provided: string | null
  downtime_hours: number | string
  actual_loss_kusd: number | string
  potential_loss_kusd: number | string
  raw: Record<string, unknown>
  raw_number_formats: Record<string, unknown>
}
type SourceDashboardRow = { record_id: string; source_row: number; raw: Record<string, unknown> }
type Status = 'loading' | 'ready' | 'error'
type Filters = { plant: string; from: string; through: string; assetTag: string; ar: string }

const tableWrap: CSSProperties = { overflowX: 'auto', border: '1px solid #d7e1e3', borderRadius: 6 }
const table: CSSProperties = { width: '100%', minWidth: 1020, borderCollapse: 'collapse', fontSize: '.875rem' }
const header: CSSProperties = { padding: '11px', borderBottom: '1px solid #b9ceca', background: '#eaf3f1', textAlign: 'left', whiteSpace: 'nowrap' }
const cell: CSSProperties = { padding: '11px', borderBottom: '1px solid #e2eaeb', verticalAlign: 'top' }
const input: CSSProperties = { width: '100%', minHeight: 44, padding: '9px 12px', border: '1px solid #a9bdc3', borderRadius: 5, background: '#fff', color: '#132b36' }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numeric(value: unknown): value is number | string {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))
}

function isIncident(value: unknown): value is Incident {
  if (!isObject(value)) return false
  return typeof value['record_id'] === 'string' && typeof value['source_row'] === 'number' &&
    typeof value['source_id'] === 'string' && typeof value['occurred_date_raw'] === 'string' &&
    typeof value['plant_code'] === 'string' && typeof value['asset_tag_as_provided'] === 'string' &&
    (value['ar_no'] === null || typeof value['ar_no'] === 'string') &&
    (value['mto_no'] === null || typeof value['mto_no'] === 'string') &&
    (value['overall_status_as_provided'] === null || typeof value['overall_status_as_provided'] === 'string') &&
    numeric(value['downtime_hours']) && numeric(value['actual_loss_kusd']) && numeric(value['potential_loss_kusd']) &&
    isObject(value['raw']) && isObject(value['raw_number_formats'])
}

function isSource(value: unknown): value is Source {
  return isObject(value) && typeof value['source_id'] === 'string' &&
    typeof value['relative_path'] === 'string' && typeof value['source_sha256'] === 'string'
}

function isDashboardRow(value: unknown): value is SourceDashboardRow {
  return isObject(value) && typeof value['record_id'] === 'string' &&
    typeof value['source_row'] === 'number' && isObject(value['raw'])
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function numberAsProvided(value: number | string): string {
  // Numeric columns are normalized; the complete original cell is in raw.
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 })
}

export default function IncidentsPage() {
  const [params] = useSearchParams()
  const requestedRecordId = params.get('record')
  const requestedField = params.get('field')
  const [source, setSource] = useState<Source | null>(null)
  const [plants, setPlants] = useState<Plant[]>([])
  const [catalogStatus, setCatalogStatus] = useState<Status>('loading')
  const [draft, setDraft] = useState<Filters>({ plant: '', from: '', through: '', assetTag: '', ar: '' })
  const [filters, setFilters] = useState<Filters>(draft)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Incident[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [rowStatus, setRowStatus] = useState<Status>('loading')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [directRecord, setDirectRecord] = useState<Incident | null>(null)
  const [directStatus, setDirectStatus] = useState<Status>('loading')
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [dashboardRows, setDashboardRows] = useState<SourceDashboardRow[]>([])
  const [dashboardStatus, setDashboardStatus] = useState<Status>('loading')

  useEffect(() => {
    let active = true
    async function loadCatalog() {
      const [sourceResult, plantResult] = await Promise.all([
        supabase.from('source_catalog').select('source_id,relative_path,source_sha256')
          .eq('dataset_id', 'caliber2026_case2').eq('source_kind', 'incident').maybeSingle(),
        supabase.from('plants').select('plant_code').eq('dataset_id', 'caliber2026_case2').order('plant_code'),
      ])
      if (!active) return
      if (sourceResult.error || plantResult.error || !isSource(sourceResult.data) ||
        (plantResult.data ?? []).some((plant) => !isObject(plant) || typeof plant['plant_code'] !== 'string')) {
        setCatalogStatus('error')
        return
      }
      setSource(sourceResult.data)
      setPlants((plantResult.data ?? []) as Plant[])
      setCatalogStatus('ready')
    }
    void loadCatalog()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!source) return
    const sourceId = source.source_id
    let active = true
    setRows([])
    setExpandedId(null)
    setRowStatus('loading')

    async function loadIncidents() {
      let query = supabase.from('incident_records')
        .select('record_id,source_row,source_id,occurred_date_raw,plant_code,asset_tag_as_provided,ar_no,mto_no,overall_status_as_provided,downtime_hours,actual_loss_kusd,potential_loss_kusd,raw,raw_number_formats', { count: 'exact' })
        .eq('source_id', sourceId)
        .order('occurred_date', { ascending: false })
        .order('source_row', { ascending: true })

      if (filters.plant) query = query.eq('plant_code', filters.plant)
      if (filters.from) query = query.gte('occurred_date', filters.from)
      if (filters.through) query = query.lte('occurred_date', filters.through)
      if (filters.assetTag) query = query.eq('asset_tag_as_provided', filters.assetTag)
      if (filters.ar) query = query.eq('ar_no', filters.ar)

      const { data, count, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (!active) return
      if (error || count === null || (data ?? []).some((item) => !isIncident(item))) {
        setRowStatus('error')
        setTotal(null)
        return
      }
      setRows((data ?? []) as Incident[])
      setTotal(count)
      setRowStatus('ready')
    }
    void loadIncidents()
    return () => { active = false }
  }, [source, filters, page])

  useEffect(() => {
    if (!source || !requestedRecordId) return
    let active = true
    setDirectRecord(null)
    setDirectStatus('loading')
    if (requestedRecordId.length > 150) { setDirectStatus('error'); return () => { active = false } }
    async function loadExactRecord() {
      try {
        const { data, error } = await supabase.from('incident_records')
          .select('record_id,source_row,source_id,occurred_date_raw,plant_code,asset_tag_as_provided,ar_no,mto_no,overall_status_as_provided,downtime_hours,actual_loss_kusd,potential_loss_kusd,raw,raw_number_formats')
          .eq('dataset_id', 'caliber2026_case2').eq('source_id', source!.source_id)
          .eq('record_id', requestedRecordId).maybeSingle()
        if (!active) return
        if (error || !isIncident(data) || data.record_id !== requestedRecordId) { setDirectStatus('error'); return }
        setDirectRecord(data)
        setDirectStatus('ready')
      } catch { if (active) setDirectStatus('error') }
    }
    void loadExactRecord()
    return () => { active = false }
  }, [source, requestedRecordId])

  useEffect(() => {
    if (directStatus === 'ready' && directRecord && window.location.hash === '#incident-source-record') {
      document.getElementById('incident-source-record')?.scrollIntoView({ block: 'start' })
    }
  }, [directStatus, directRecord])

  useEffect(() => {
    if (!dashboardOpen || !source) return
    const sourceId = source.source_id
    let active = true
    setDashboardStatus('loading')
    async function loadOriginalDashboard() {
      const { data, error } = await supabase.from('incident_source_summary')
        .select('record_id,source_row,raw').eq('source_id', sourceId).order('source_row')
      if (!active) return
      if (error || (data ?? []).some((item) => !isDashboardRow(item))) {
        setDashboardStatus('error')
        return
      }
      setDashboardRows((data ?? []) as SourceDashboardRow[])
      setDashboardStatus('ready')
    }
    void loadOriginalDashboard()
    return () => { active = false }
  }, [dashboardOpen, source])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.from && draft.through && draft.from > draft.through) return
    setPage(0)
    setTotal(null)
    setRows([])
    setRowStatus('loading')
    setFilters({ ...draft, assetTag: draft.assetTag.trim(), ar: draft.ar.trim() })
  }

  function clearFilters() {
    const clear = { plant: '', from: '', through: '', assetTag: '', ar: '' }
    setDraft(clear)
    setFilters(clear)
    setPage(0)
    setTotal(null)
    setRows([])
    setRowStatus('loading')
  }

  const invalidRange = Boolean(draft.from && draft.through && draft.from > draft.through)
  const lastPage = total === null ? 0 : Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  const selectedRecord = rows.find((row) => row.record_id === expandedId)

  return <div className="app-shell">
    <a className="skip-link" href="#source-content">Skip to source data</a>
    <header className="app-topbar">
      <Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
      <nav aria-label="Source navigation"><Link className="secondary-link" to="/dashboard">← Case 2 workspace</Link></nav>
    </header>
    <main className="dashboard-content" id="source-content">
      <div className="dashboard-title">
        <p className="scope-label">SOURCE DATA · CASE 2 · INCIDENTS</p>
        <h1>Incident Database</h1>
        <p>Original competition dataset, one source row per recorded incident. Status is the workbook snapshot; date of a status change is unavailable.</p>
      </div>

      {catalogStatus === 'loading' && <p className="route-status" role="status">Loading the source catalog…</p>}
      {catalogStatus === 'error' && <p className="route-status" role="alert">The incident source or plant catalog could not be loaded.</p>}
      {catalogStatus === 'ready' && source && <>
        {requestedRecordId && <section className="panel" id="incident-source-record" aria-labelledby="direct-record-heading">
          <h2 id="direct-record-heading">Original incident row</h2>
          {directStatus === 'loading' && <p role="status">Loading the exact source row…</p>}
          {directStatus === 'error' && <p role="alert">This incident row is not available in the supplied source. Check the case link.</p>}
          {directStatus === 'ready' && directRecord && <>
            <p><strong>{directRecord.asset_tag_as_provided} · {directRecord.plant_code}</strong> · Incident Database, Excel row {directRecord.source_row} · original date {directRecord.occurred_date_raw}.</p>
            <p>Recorded downtime: {numberAsProvided(directRecord.downtime_hours)} h · actual loss: {numberAsProvided(directRecord.actual_loss_kusd)} thousand USD · potential loss: {numberAsProvided(directRecord.potential_loss_kusd)} thousand USD.</p>
            {requestedField && !Object.hasOwn(directRecord.raw, requestedField) && <p role="alert">The requested source column is absent from this row. No value is inferred.</p>}
            <div style={tableWrap}><table style={table}><thead><tr><th scope="col" style={header}>Original source field</th><th scope="col" style={header}>Value as supplied</th></tr></thead>
              <tbody>{Object.entries(directRecord.raw).map(([field, value]) => <tr key={field} className={field === requestedField ? 'source-field-highlight' : undefined}><th scope="row" style={cell}>{field}</th><td style={cell}>{display(value)}</td></tr>)}</tbody></table></div>
            <p className="source-note">Source: {source.relative_path} · SHA-256: {source.source_sha256}. AR and MTO are not unique incident identifiers.</p>
            <Link className="text-link" to={`/dashboard/investigation/${encodeURIComponent(directRecord.record_id)}`}>Return to case interpretation ↗</Link>
          </>}
        </section>}
        <section className="panel" aria-labelledby="filter-heading">
          <h2 id="filter-heading">Find source records</h2>
          <form onSubmit={applyFilters}>
            <div className="filter-row">
              <label>Plant
                <select value={draft.plant} onChange={(event) => setDraft({ ...draft, plant: event.target.value })}>
                  <option value="">All supplied plants</option>
                  {plants.map((plant) => <option key={plant.plant_code} value={plant.plant_code}>{plant.plant_code}</option>)}
                </select>
              </label>
              <label>From occurrence date
                <input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
              </label>
              <label>Through occurrence date
                <input type="date" value={draft.through} onChange={(event) => setDraft({ ...draft, through: event.target.value })} />
              </label>
              <label>Asset tag (exact)
                <input style={input} value={draft.assetTag} onChange={(event) => setDraft({ ...draft, assetTag: event.target.value })} placeholder="e.g. KO-3201" />
              </label>
              <label>AR number (exact)
                <input style={input} value={draft.ar} onChange={(event) => setDraft({ ...draft, ar: event.target.value })} placeholder="Optional" />
              </label>
            </div>
            {invalidRange && <p role="alert">The starting date must not be after the ending date.</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
              <button className="primary-link" type="submit" disabled={invalidRange}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
                Apply source filters
              </button>
              <button className="secondary-action" type="button" onClick={clearFilters}>Clear filters</button>
            </div>
          </form>
          <p className="source-note">File: {source.relative_path} · Source sheet: Incident Database · Dates are as supplied without a verified timezone. AR and MTO are references, not unique incident IDs.</p>
        </section>

        <section className="panel" aria-labelledby="source-rows-heading">
          <h2 id="source-rows-heading">Source rows</h2>
          {requestedField && !requestedRecordId && <p className="source-note">Mapped source column: <strong>{requestedField}</strong>. This mapping applies to the entire Incident Database sheet; the table highlights this column. Open a specific row to inspect its original cell value.</p>}
          {rowStatus === 'loading' && <p role="status">Loading incident records…</p>}
          {rowStatus === 'error' && <p role="alert">Incident records could not be loaded or validated.</p>}
          {rowStatus === 'ready' && total === 0 && <p role="status">No incident source rows match these filters.</p>}
          {rowStatus === 'ready' && total !== null && total > 0 && <>
            <p className="source-note">{total.toLocaleString('en-US')} matching source rows · page {page + 1} of {lastPage + 1} · 25 per page. Loss values are in thousands of US dollars (kUSD).</p>
            <div style={tableWrap}><table style={table}>
              <thead><tr>
                <th style={header} scope="col">Excel row</th><th style={header} className={requestedField === 'Serial No' ? 'source-field-highlight' : undefined} scope="col">Serial No in source</th><th style={header} scope="col">Occurred</th>
                <th style={header} scope="col">Plant</th><th style={header} scope="col">Asset tag</th>
                <th style={header} scope="col">AR reference</th><th style={header} scope="col">Risk score</th>
                <th style={header} scope="col">Status snapshot</th><th style={header} className={requestedField === 'Downtime (hrs)' ? 'source-field-highlight' : undefined} scope="col">Downtime (h)</th>
                <th style={header} className={requestedField === 'Act. Loss (k US$)' ? 'source-field-highlight' : undefined} scope="col">Actual loss (kUSD)</th><th style={header} className={requestedField === 'Pot. Loss (k US$)' ? 'source-field-highlight' : undefined} scope="col">Potential loss (kUSD)</th>
                <th style={header} scope="col">All fields</th>
              </tr></thead>
              <tbody>{rows.map((row) => <tr key={row.record_id}>
                <td style={cell}>{row.source_row}</td><td style={cell} className={requestedField === 'Serial No' ? 'source-field-highlight' : undefined}>{display(row.raw['Serial No'])}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{row.occurred_date_raw}</td>
                <td style={cell}>{row.plant_code}</td><th style={cell} scope="row">{row.asset_tag_as_provided}</th>
                <td style={cell}>{display(row.ar_no)}</td><td style={cell}>{display(row.raw['Risk Score'])}</td>
                <td style={cell}>{display(row.overall_status_as_provided)}</td>
                <td style={cell} className={requestedField === 'Downtime (hrs)' ? 'source-field-highlight' : undefined}>{numberAsProvided(row.downtime_hours)}</td>
                <td style={cell} className={requestedField === 'Act. Loss (k US$)' ? 'source-field-highlight' : undefined}>{numberAsProvided(row.actual_loss_kusd)}</td>
                <td style={cell} className={requestedField === 'Pot. Loss (k US$)' ? 'source-field-highlight' : undefined}>{numberAsProvided(row.potential_loss_kusd)}</td>
                <td style={cell}><button className="secondary-action" type="button" aria-expanded={expandedId === row.record_id} onClick={() => setExpandedId(expandedId === row.record_id ? null : row.record_id)}>{expandedId === row.record_id ? '− Hide fields' : '+ View fields'}</button></td>
              </tr>)}</tbody>
            </table></div>
            {selectedRecord && <section className="panel" aria-labelledby="incident-detail-heading">
                <h3 id="incident-detail-heading">Incident record · Excel row {selectedRecord.source_row}</h3>
                <p className="source-note">File: {source.relative_path} · Sheet: Incident Database · Internal record ID: {selectedRecord.record_id} · Source SHA-256: {source.source_sha256}</p>
                <div style={{ ...tableWrap, maxHeight: 420 }}><table style={{ ...table, minWidth: 520 }}>
                  <thead><tr><th style={header} scope="col">Original source column</th><th style={header} scope="col">Value as supplied</th></tr></thead>
                  <tbody>{Object.entries(selectedRecord.raw).map(([field, value]) => <tr key={field}><th style={cell} scope="row">{field}</th><td style={cell}>{display(value)}</td></tr>)}</tbody>
                </table></div>
                <p className="source-note">MTO: {display(selectedRecord.mto_no)} · Original number formats: {JSON.stringify(selectedRecord.raw_number_formats)}. A missing RCA due date is not proof that a review is overdue.</p>
              </section>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
              <button className="secondary-action" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous 25 rows</button>
              <button className="secondary-action" type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next 25 rows →</button>
            </div>
          </>}
          <p className="source-note">Actual and potential loss are separate source fields. The source sheet's Total Loss includes both and is not an achieved saving.</p>
        </section>

        <section className="panel" aria-labelledby="source-dashboard-heading">
          <h2 id="source-dashboard-heading">Original workbook Dashboard sheet</h2>
          <p>The workbook's own summary is provided only for cross-checking. These rows must not be counted as additional incidents.</p>
          <details onToggle={(event) => setDashboardOpen(event.currentTarget.open)}>
            <summary>View original summary rows</summary>
            {dashboardOpen && dashboardStatus === 'loading' && <p role="status">Loading the original summary…</p>}
            {dashboardOpen && dashboardStatus === 'error' && <p role="alert">The original Dashboard sheet could not be loaded.</p>}
            {dashboardOpen && dashboardStatus === 'ready' && dashboardRows.length === 0 && <p>No source summary rows are available.</p>}
            {dashboardOpen && dashboardStatus === 'ready' && dashboardRows.length > 0 && <div style={tableWrap}><table style={{ ...table, minWidth: 580 }}>
              <thead><tr><th style={header} scope="col">Excel row</th><th style={header} scope="col">Original Dashboard fields</th></tr></thead>
              <tbody>{dashboardRows.map((row) => <tr key={row.record_id}><th style={cell} scope="row">{row.source_row}</th><td style={cell}><pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(row.raw, null, 2)}</pre></td></tr>)}</tbody>
            </table></div>}
          </details>
        </section>
      </>}
    </main>
  </div>
}
