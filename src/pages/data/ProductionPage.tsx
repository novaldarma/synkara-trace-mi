import { Fragment, useEffect, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../services/supabase'

const PAGE_SIZE = 25

type Source = {
  source_id: string
  relative_path: string
  source_sha256: string
  source_scope: string
}

type Tag = {
  record_id: string
  source_row: number
  asset_id: string
  tag_name: string
  engineering_unit_as_provided: string | null
  instrument_tag_as_provided: string | null
  raw: Record<string, unknown>
}

type Reading = {
  record_id: string
  source_row: number
  observed_at_raw: string
  raw: Record<string, unknown>
  raw_number_formats: Record<string, unknown>
}

type RequestStatus = 'loading' | 'ready' | 'error'

const scrollStyle: CSSProperties = { overflowX: 'auto', border: '1px solid #d7e1e3', borderRadius: 6 }
const tableStyle: CSSProperties = { width: '100%', minWidth: 840, borderCollapse: 'collapse', fontSize: '.875rem' }
const headStyle: CSSProperties = { padding: '12px', textAlign: 'left', background: '#eaf3f1', borderBottom: '1px solid #b9ceca', whiteSpace: 'nowrap' }
const cellStyle: CSSProperties = { padding: '11px 12px', borderBottom: '1px solid #e2eaeb', verticalAlign: 'top' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSource(value: unknown): value is Source {
  return isRecord(value) && typeof value['source_id'] === 'string' &&
    typeof value['relative_path'] === 'string' &&
    typeof value['source_sha256'] === 'string' &&
    typeof value['source_scope'] === 'string'
}

function isTag(value: unknown): value is Tag {
  return isRecord(value) && typeof value['record_id'] === 'string' &&
    typeof value['source_row'] === 'number' &&
    typeof value['asset_id'] === 'string' &&
    typeof value['tag_name'] === 'string' &&
    (value['engineering_unit_as_provided'] === null || typeof value['engineering_unit_as_provided'] === 'string') &&
    (value['instrument_tag_as_provided'] === null || typeof value['instrument_tag_as_provided'] === 'string') &&
    isRecord(value['raw'])
}

function isReading(value: unknown): value is Reading {
  return isRecord(value) && typeof value['record_id'] === 'string' &&
    typeof value['source_row'] === 'number' &&
    typeof value['observed_at_raw'] === 'string' &&
    isRecord(value['raw']) && isRecord(value['raw_number_formats'])
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export default function ProductionPage() {
  const [params] = useSearchParams()
  const requestedSource = params.get('source')
  const requestedRecord = params.get('record')
  const requestedField = params.get('field')
  const [sources, setSources] = useState<Source[]>([])
  const [sourceStatus, setSourceStatus] = useState<RequestStatus>('loading')
  const [sourceId, setSourceId] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [tagStatus, setTagStatus] = useState<RequestStatus>('loading')
  const [readings, setReadings] = useState<Reading[]>([])
  const [readingStatus, setReadingStatus] = useState<RequestStatus>('loading')
  const [total, setTotal] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [tagName, setTagName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [directReading, setDirectReading] = useState<Reading | null>(null)
  const [directStatus, setDirectStatus] = useState<RequestStatus>('loading')

  useEffect(() => {
    let active = true

    async function loadSources() {
      const { data, error } = await supabase.from('source_catalog')
        .select('source_id,relative_path,source_sha256,source_scope')
        .eq('dataset_id', 'caliber2026_case2')
        .eq('source_kind', 'production')
        .order('relative_path')

      if (!active) return
      if (error || (data ?? []).some((row) => !isSource(row))) {
        setSourceStatus('error')
        return
      }
      const validated = (data ?? []) as Source[]
      setSources(validated)
      setSourceId(validated.find(s=>s.source_id===requestedSource)?.source_id ?? validated[0]?.source_id ?? '')
      setSourceStatus('ready')
    }

    void loadSources()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!requestedRecord || !sourceId || sourceId !== requestedSource) return
    let active=true
    setDirectStatus('loading')
    void supabase.from('production_records').select('record_id,source_row,observed_at_raw,raw,raw_number_formats')
      .eq('source_id',sourceId).eq('record_id',requestedRecord).maybeSingle()
      .then(({data,error}) => {
        if (!active) return
        if (error || !isReading(data)) setDirectStatus('error')
        else { setDirectReading(data); setDirectStatus('ready'); if (window.location.hash==='#production-source-record') requestAnimationFrame(()=>document.getElementById('production-source-record')?.scrollIntoView({block:'start'})) }
      })
    return () => { active=false }
  },[sourceId,requestedSource,requestedRecord])

  useEffect(() => {
    if (!sourceId) return
    let active = true
    setTags([])
    setTagStatus('loading')

    async function loadTags() {
      const { data, error } = await supabase.from('production_tag_catalog')
        .select('record_id,source_row,asset_id,tag_name,engineering_unit_as_provided,instrument_tag_as_provided,raw')
        .eq('source_id', sourceId)
        .order('source_row')

      if (!active) return
      if (error || (data ?? []).some((row) => !isTag(row)) || (data ?? []).length !== 7) {
        setTagStatus('error')
        return
      }
      setTags((data ?? []) as Tag[])
      setTagStatus('ready')
    }

    void loadTags()
    return () => { active = false }
  }, [sourceId])

  const invalidRange = Boolean(fromDate && toDate && fromDate > toDate)

  useEffect(() => {
    if (!sourceId || invalidRange) return
    let active = true
    setReadings([])
    setExpandedId(null)
    setReadingStatus('loading')

    async function loadReadings() {
      let query = supabase.from('production_records')
        .select('record_id,source_row,observed_at_raw,raw,raw_number_formats', { count: 'exact' })
        .eq('source_id', sourceId)
        .order('observed_at_naive', { ascending: true })
        .order('source_row', { ascending: true })

      // The source has no verified timezone; compare naive timestamps as stored.
      if (fromDate) query = query.gte('observed_at_naive', `${fromDate}T00:00:00`)
      if (toDate) query = query.lte('observed_at_naive', `${toDate}T23:59:59`)

      const { data, count, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (!active) return
      if (error || count === null || (data ?? []).some((row) => !isReading(row))) {
        setReadingStatus('error')
        setTotal(null)
        return
      }
      setReadings((data ?? []) as Reading[])
      setTotal(count)
      setReadingStatus('ready')
    }

    void loadReadings()
    return () => { active = false }
  }, [sourceId, fromDate, toDate, page, invalidRange])

  const selectedSource = sources.find((source) => source.source_id === sourceId)
  const shownTags = tagName ? tags.filter((tag) => tag.tag_name === tagName) : tags
  const lastPage = total === null ? 0 : Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  function changeSource(value: string) {
    setSourceId(value)
    setTagName('')
    setTags([])
    setTagStatus('loading')
    setPage(0)
    setTotal(null)
    setReadings([])
    setReadingStatus('loading')
  }

  function changeDate(kind: 'from' | 'to', value: string) {
    if (kind === 'from') setFromDate(value)
    else setToDate(value)
    setPage(0)
    setTotal(null)
    setReadings([])
    setReadingStatus('loading')
  }

  return (
    <div className="app-shell production-source-page">
      <a className="skip-link" href="#source-content">Skip to source data</a>
      <header className="app-topbar">
        <Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
        <nav aria-label="Source navigation"><Link className="secondary-link" to="/dashboard">← Case 2 workspace</Link></nav>
      </header>
      <main className="dashboard-content" id="source-content">
        <div className="dashboard-title">
          <p className="scope-label">SOURCE DATA · CASE 2 · PRODUCTION</p>
          <h1>Production records</h1>
          <p>Read-only PI Tag and hourly Sheet2 records from the five supplied workbooks. Values and units belong to the selected file; they are not a cross-plant total.</p>
        </div>

        {sourceStatus === 'loading' && <p className="route-status" role="status">Loading source files…</p>}
        {sourceStatus === 'error' && <p className="route-status" role="alert">Production source files could not be loaded.</p>}
        {sourceStatus === 'ready' && sources.length === 0 && <p className="route-status" role="status">No Production source files are available to this account.</p>}

        {sourceStatus === 'ready' && sources.length > 0 && <>
          {requestedRecord && <section className="panel" id="production-source-record" aria-labelledby="production-direct-heading"><h2 id="production-direct-heading">Exact hourly source record</h2>
            {sourceId !== requestedSource && <p role="alert">This record's requested source file is not available to this account.</p>}
            {sourceId === requestedSource && directStatus === 'loading' && <p role="status">Checking the original Sheet2 row…</p>}
            {sourceId === requestedSource && directStatus === 'error' && <p role="alert">No original row matched this record and source file.</p>}
            {sourceId === requestedSource && directStatus === 'ready' && directReading && <><p>Sheet2 · Excel row {directReading.source_row} · original timestamp {directReading.observed_at_raw} · {selectedSource?.relative_path}.</p>
              {requestedField && !Object.hasOwn(directReading.raw,requestedField) && <p role="alert">The requested source column is absent from this row.</p>}
              <div style={scrollStyle}><table style={{...tableStyle,minWidth:520}}><thead><tr><th scope="col" style={headStyle}>Original column</th><th scope="col" style={headStyle}>Value as supplied</th></tr></thead><tbody>{Object.entries(directReading.raw).map(([field,value])=><tr key={field} className={field===requestedField?'source-field-highlight':undefined}><th scope="row" style={cellStyle}>{field}</th><td style={cellStyle}>{show(value)}</td></tr>)}</tbody></table></div>
              <p className="source-note">Source SHA-256: {selectedSource?.source_sha256}. An hourly observation is not an incident downtime duration.</p></>}
          </section>}
          <section className="panel" aria-labelledby="production-filters">
            <h2 id="production-filters">Select source</h2>
            <div className="filter-row">
              <label>Workbook
                <select value={sourceId} onChange={(event) => changeSource(event.target.value)}>
                  {sources.map((source) => <option key={source.source_id} value={source.source_id}>{fileName(source.relative_path)}</option>)}
                </select>
              </label>
              <label>From source date
                <input type="date" value={fromDate} onChange={(event) => changeDate('from', event.target.value)} />
              </label>
              <label>Through source date
                <input type="date" value={toDate} onChange={(event) => changeDate('to', event.target.value)} />
              </label>
            </div>
            {invalidRange && <p role="alert">The starting date must not be after the ending date.</p>}
            {selectedSource && <p className="source-note">File: {selectedSource.relative_path} · Asset: {tagStatus === 'ready' ? tags[0]?.asset_id : 'loading'} · Scope: {selectedSource.source_scope} · Timestamps as supplied, timezone not established.</p>}
          </section>

          <section className="panel" aria-labelledby="pi-tag-heading">
            <h2 id="pi-tag-heading">PI Tag · source metadata</h2>
            {tagStatus === 'loading' && <p role="status">Loading the selected PI Tag sheet…</p>}
            {tagStatus === 'error' && <p role="alert">PI Tag metadata is unavailable or incomplete for this workbook.</p>}
            {tagStatus === 'ready' && <>
              <label className="tariff-field">Show tag in hourly table
                <select value={tagName} onChange={(event) => { setTagName(event.target.value); setExpandedId(null) }}>
                  <option value="">All seven source tags</option>
                  {tags.map((tag) => <option key={tag.record_id} value={tag.tag_name}>{tag.tag_name} ({tag.engineering_unit_as_provided ?? 'unit unavailable'})</option>)}
                </select>
              </label>
              <div style={{ ...scrollStyle, marginTop: 14 }}>
                <table style={tableStyle}>
                  <thead><tr><th scope="col" style={headStyle}>Excel row</th><th scope="col" style={headStyle}>Tag name</th><th scope="col" style={headStyle}>Unit from file</th><th scope="col" style={headStyle}>Instrument tag</th><th scope="col" style={headStyle}>Source metadata</th></tr></thead>
                  <tbody>{tags.map((tag) => <tr key={tag.record_id}>
                    <td style={cellStyle}>{tag.source_row}</td>
                    <th scope="row" style={cellStyle}>{tag.tag_name}</th>
                    <td style={cellStyle}>{show(tag.engineering_unit_as_provided)}</td>
                    <td style={cellStyle}>{show(tag.instrument_tag_as_provided)}</td>
                    <td style={cellStyle}><details><summary>View PI Tag fields</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(tag.raw, null, 2)}</pre></details></td>
                  </tr>)}</tbody>
                </table>
              </div>
              <p className="source-note">PI Tag span and typical value are metadata from this file, not verified operating alarm limits.</p>
            </>}
          </section>

          <section className="panel" aria-labelledby="sheet2-heading">
            <h2 id="sheet2-heading">Sheet2 · hourly source observations</h2>
            {invalidRange && <p role="status">Choose a valid date range to load source rows.</p>}
            {!invalidRange && readingStatus === 'loading' && <p role="status">Loading source rows…</p>}
            {!invalidRange && readingStatus === 'error' && <p role="alert">Hourly records could not be loaded or validated.</p>}
            {!invalidRange && readingStatus === 'ready' && total === 0 && <p role="status">No source rows match the selected dates.</p>}
            {!invalidRange && readingStatus === 'ready' && total !== null && total > 0 && <>
              <p className="source-note">{total.toLocaleString('en-US')} matching source rows · page {page + 1} of {lastPage + 1} · 25 per page.</p>
              {tagStatus === 'ready' && <div style={scrollStyle}>
                <table style={tableStyle}>
                  <thead><tr>
                    <th scope="col" style={headStyle}>Excel row</th>
                    <th scope="col" style={headStyle}>Timestamp from file</th>
                    {shownTags.map((tag) => <th key={tag.record_id} scope="col" style={headStyle}>{tag.tag_name}<br /><small>{tag.engineering_unit_as_provided ?? 'unit unavailable'}</small></th>)}
                    <th scope="col" style={headStyle}>Origin</th>
                  </tr></thead>
                  <tbody>{readings.map((row) => <Fragment key={row.record_id}>
                    <tr>
                      <td style={cellStyle}>{row.source_row}</td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{row.observed_at_raw}</td>
                      {shownTags.map((tag) => <td key={tag.record_id} style={cellStyle}>{show(row.raw[tag.tag_name])}</td>)}
                      <td style={cellStyle}><button className="secondary-action" type="button" aria-expanded={expandedId === row.record_id} onClick={() => setExpandedId(expandedId === row.record_id ? null : row.record_id)}>{expandedId === row.record_id ? '− Hide row' : '+ View row'}</button></td>
                    </tr>
                    {expandedId === row.record_id && <tr><td colSpan={shownTags.length + 3} style={{ ...cellStyle, background: '#f5f7f8' }}>
                      <strong>File:</strong> {selectedSource?.relative_path} · <strong>Sheet:</strong> Sheet2 · <strong>Excel row:</strong> {row.source_row}<br />
                      <strong>Source ID:</strong> {sourceId} · <strong>Row ID:</strong> {row.record_id}<br />
                      <strong>SHA-256:</strong> {selectedSource?.source_sha256}
                      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ source_fields: row.raw, source_number_formats: row.raw_number_formats }, null, 2)}</pre>
                    </td></tr>}
                  </Fragment>)}</tbody>
                </table>
              </div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
                <button className="secondary-action" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous 25 rows</button>
                <button className="secondary-action" type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next 25 rows →</button>
              </div>
            </>}
            <p className="source-note">RUN_STATUS = OFF is an hourly observation, not an incident downtime duration. PLANT_RATE belongs to this workbook and cannot be summed across plants.</p>
          </section>
        </>}
      </main>
    </div>
  )
}
