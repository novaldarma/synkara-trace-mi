import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../services/supabase'

const PAGE_SIZE = 25
const EXTERNAL_DATASET = 'uci_steel_industry_2018_external'

type Source = { source_id: string; relative_path: string; source_sha256: string; source_scope: string }
type Reading = {
  record_id: string; source_csv_row: number; sequence_index: number
  source_time_label_raw: string; source_date_label: string
  timestamp_derived_naive: string; time_derivation: string
  timestamp_derivation_is_inference: boolean
  usage_kwh: number | string; unit_usage: string
  source_fields_raw: Record<string, unknown>
}
type Status = 'loading' | 'ready' | 'error'

const frame: CSSProperties = { overflowX: 'auto', border: '1px solid #d7e1e3', borderRadius: 6 }
const table: CSSProperties = { width: '100%', minWidth: 940, borderCollapse: 'collapse', fontSize: '.875rem' }
const header: CSSProperties = { textAlign: 'left', padding: 11, whiteSpace: 'nowrap', background: '#eaf3f1', borderBottom: '1px solid #b9ceca' }
const cell: CSSProperties = { padding: 11, verticalAlign: 'top', borderBottom: '1px solid #e2eaeb' }

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSource(value: unknown): value is Source {
  return object(value) && typeof value['source_id'] === 'string' &&
    typeof value['relative_path'] === 'string' && typeof value['source_sha256'] === 'string' &&
    value['source_scope'] === 'external_steel_industry_south_korea_2018'
}

function isReading(value: unknown): value is Reading {
  return object(value) && typeof value['record_id'] === 'string' &&
    typeof value['source_csv_row'] === 'number' && typeof value['sequence_index'] === 'number' &&
    typeof value['source_time_label_raw'] === 'string' && typeof value['source_date_label'] === 'string' &&
    typeof value['timestamp_derived_naive'] === 'string' && typeof value['time_derivation'] === 'string' &&
    typeof value['timestamp_derivation_is_inference'] === 'boolean' &&
    value['unit_usage'] === 'kWh' &&
    (typeof value['usage_kwh'] === 'number' || typeof value['usage_kwh'] === 'string') &&
    Number.isFinite(Number(value['usage_kwh'])) && object(value['source_fields_raw'])
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export default function EnergyPage() {
  const [params] = useSearchParams()
  const requestedSequence = Number(params.get('sequence'))
  const requestedField = params.get('field')
  const hasSequence = Number.isInteger(requestedSequence) && requestedSequence >= 1 && requestedSequence <= 35040 && params.has('sequence')
  const [source, setSource] = useState<Source | null>(null)
  const [sourceStatus, setSourceStatus] = useState<Status>('loading')
  const [dateDraft, setDateDraft] = useState('')
  const [sourceDate, setSourceDate] = useState('')
  const [page, setPage] = useState(0)
  const [readings, setReadings] = useState<Reading[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [readingStatus, setReadingStatus] = useState<Status>('loading')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [directReading, setDirectReading] = useState<Reading | null>(null)
  const [directStatus, setDirectStatus] = useState<Status>('loading')

  useEffect(() => {
    let active = true
    async function loadSource() {
      const { data, error } = await supabase.from('source_catalog')
        .select('source_id,relative_path,source_sha256,source_scope')
        .eq('dataset_id', EXTERNAL_DATASET)
        .eq('source_kind', 'external_electricity_history')
        .maybeSingle()
      if (!active) return
      if (error || !isSource(data)) {
        setSourceStatus('error')
        return
      }
      setSource(data)
      setSourceStatus('ready')
    }
    void loadSource()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!source || !hasSequence) return
    let active = true
    setDirectStatus('loading')
    void supabase.from('energy_readings')
      .select('record_id,source_csv_row,sequence_index,source_time_label_raw,source_date_label,timestamp_derived_naive,time_derivation,timestamp_derivation_is_inference,usage_kwh,unit_usage,source_fields_raw')
      .eq('source_id',source.source_id).eq('sequence_index',requestedSequence).maybeSingle()
      .then(({data,error}) => {
        if (!active) return
        if (error || !isReading(data) || data.sequence_index !== requestedSequence) setDirectStatus('error')
        else { setDirectReading(data); setDirectStatus('ready'); if (window.location.hash === '#energy-source-record') requestAnimationFrame(() => document.getElementById('energy-source-record')?.scrollIntoView({block:'start'})) }
      })
    return () => { active = false }
  }, [source, hasSequence, requestedSequence])

  useEffect(() => {
    if (!source) return
    const sourceId = source.source_id
    let active = true
    setReadings([])
    setExpandedId(null)
    setReadingStatus('loading')
    async function loadPage() {
      let query = supabase.from('energy_readings')
        .select('record_id,source_csv_row,sequence_index,source_time_label_raw,source_date_label,timestamp_derived_naive,time_derivation,timestamp_derivation_is_inference,usage_kwh,unit_usage,source_fields_raw', { count: 'exact' })
        .eq('dataset_id', EXTERNAL_DATASET)
        .eq('source_id', sourceId)
        .order('sequence_index', { ascending: true })
      if (sourceDate) query = query.eq('source_date_label', sourceDate)

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
    void loadPage()
    return () => { active = false }
  }, [source, sourceDate, page])

  const lastPage = total === null ? 0 : Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  const expandedRow = readings.find((row) => row.record_id === expandedId)

  function applyDate() {
    setReadings([])
    setTotal(null)
    setPage(0)
    setReadingStatus('loading')
    setSourceDate(dateDraft)
  }

  return <div className="app-shell">
    <a className="skip-link" href="#energy-source-content">Skip to source data</a>
    <header className="app-topbar">
      <Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
      <nav aria-label="Source navigation"><Link className="secondary-link" to="/dashboard">← Case 2 workspace</Link></nav>
    </header>
    <main id="energy-source-content" className="dashboard-content">
      <div className="dashboard-title">
        <p className="scope-label">EXTERNAL SOURCE DATA · UCI · SOUTH KOREAN STEEL INDUSTRY · 2018</p>
        <h1>Electricity history</h1>
        <p>Read-only 15-minute CSV records for the external forecasting example. These are not Chandra Asri electricity readings, tariffs, bills, or emissions.</p>
      </div>
      <p className="route-status" role="status">Source date labels and original CSV order are preserved. A 00:00 label at the end of a source day is displayed with a separately inferred next-day timestamp; its original label is never replaced.</p>
      {sourceStatus === 'loading' && <p role="status" className="route-status">Loading external source metadata…</p>}
      {sourceStatus === 'error' && <p role="alert" className="route-status">The external electricity source is not available to this account.</p>}
      {sourceStatus === 'ready' && source && <>
        {params.has('sequence') && <section className="panel" id="energy-source-record" aria-labelledby="energy-exact-heading">
          <h2 id="energy-exact-heading">Original CSV reading · requested sequence {params.get('sequence')}</h2>
          {!hasSequence && <p role="alert">The requested CSV sequence is invalid.</p>}
          {hasSequence && directStatus === 'loading' && <p role="status">Checking the original source row…</p>}
          {hasSequence && directStatus === 'error' && <p role="alert">This sequence was not found in the authorized original file.</p>}
          {hasSequence && directStatus === 'ready' && directReading && <><p>CSV row {directReading.source_csv_row} · source sequence {directReading.sequence_index} · original time label {directReading.source_time_label_raw}. Source file: {source.relative_path}.</p>
            {requestedField && !Object.hasOwn(directReading.source_fields_raw,requestedField) && <p role="alert">Requested column is absent from this original row. No value is inferred.</p>}
            <div style={frame}><table style={{...table,minWidth:520}}><thead><tr><th scope="col" style={header}>CSV column</th><th scope="col" style={header}>Original value</th></tr></thead><tbody>{Object.entries(directReading.source_fields_raw).map(([field,value]) => <tr key={field} className={field === requestedField ? 'source-field-highlight' : undefined}><th scope="row" style={cell}>{field}</th><td style={cell}>{display(value)}</td></tr>)}</tbody></table></div>
            <p className="source-note">SHA-256 {source.source_sha256}. The original CSV order is retained; a derived timestamp is an inference.</p></>}
        </section>}
        <section className="panel" aria-labelledby="energy-source-heading">
          <h2 id="energy-source-heading">Original CSV source</h2>
          <p className="source-note">File: {source.relative_path} · Scope: {source.source_scope} · Source SHA-256: {source.source_sha256}</p>
          <form onSubmit={(event) => { event.preventDefault(); applyDate() }}>
            <label className="tariff-field">Filter by original source date label
              <input type="date" min="2018-01-01" max="2018-12-31" value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} />
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
              <button className="primary-link" type="submit">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
                Apply date filter
              </button>
              <button className="secondary-action" type="button" onClick={() => { setDateDraft(''); setSourceDate(''); setPage(0) }}>Show all source rows</button>
            </div>
          </form>
          <p className="source-note">The filter uses the CSV's date label, not the inferred next-day timestamp. Chronology always follows the original sequence index.</p>
        </section>

        <section className="panel" aria-labelledby="electricity-rows-heading">
          <h2 id="electricity-rows-heading">15-minute source records</h2>
          {requestedField && !hasSequence && <p className="source-note">Mapped source column: <strong>{requestedField}</strong>. This mapping applies to the whole external CSV; the table highlights the visible values. Open a specific sequence for its original cell.</p>}
          {readingStatus === 'loading' && <p role="status">Loading external CSV rows…</p>}
          {readingStatus === 'error' && <p role="alert">External CSV records could not be loaded or validated.</p>}
          {readingStatus === 'ready' && total === 0 && <p role="status">No rows match this source date label.</p>}
          {readingStatus === 'ready' && total !== null && total > 0 && <>
            <p className="source-note">{total.toLocaleString('en-US')} matching source rows · page {page + 1} of {lastPage + 1} · 25 per page.</p>
            <div style={frame}><table style={table}>
              <thead><tr><th scope="col" style={header}>CSV row</th><th scope="col" style={header}>Original order</th><th scope="col" style={header}>Raw date/time label</th>
                <th scope="col" style={header}>Derived time (inference)</th><th scope="col" style={header} className={requestedField === 'Usage_kWh' ? 'source-field-highlight' : undefined}>Usage_kWh in CSV</th>
                <th scope="col" style={header}>Load_Type in CSV</th><th scope="col" style={header}>Date rule</th><th scope="col" style={header}>All source fields</th></tr></thead>
              <tbody>{readings.map((row) => <tr key={row.record_id}>
                <td style={cell}>{row.source_csv_row}</td><td style={cell}>{row.sequence_index}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{row.source_time_label_raw}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{row.timestamp_derived_naive}</td>
                <td style={cell} className={requestedField === 'Usage_kWh' ? 'source-field-highlight' : undefined}>{display(row.source_fields_raw['Usage_kWh'])} {row.unit_usage}</td>
                <td style={cell}>{display(row.source_fields_raw['Load_Type'])}</td>
                <td style={cell}>{row.timestamp_derivation_is_inference ? '00:00 shifted to next day (team inference)' : 'Source label unchanged'}</td>
                <td style={cell}><button className="secondary-action" type="button" aria-expanded={expandedId === row.record_id} onClick={() => setExpandedId(expandedId === row.record_id ? null : row.record_id)}>{expandedId === row.record_id ? '− Hide row' : '+ View row'}</button></td>
              </tr>)}</tbody>
            </table></div>
            {expandedRow && <section className="panel" aria-labelledby="energy-row-detail-heading">
              <h3 id="energy-row-detail-heading">CSV source row {expandedRow.source_csv_row}</h3>
              <p className="source-note">Record ID: {expandedRow.record_id} · Original index: {expandedRow.sequence_index} · Date label: {expandedRow.source_date_label} · Time derivation: {expandedRow.time_derivation}.</p>
              <div style={{ ...frame, maxHeight: 440 }}><table style={{ ...table, minWidth: 520 }}>
                <thead><tr><th scope="col" style={header}>CSV column</th><th scope="col" style={header}>Original value</th></tr></thead>
                <tbody>{Object.entries(expandedRow.source_fields_raw).map(([name, value]) => <tr key={name}><th scope="row" style={cell}>{name}</th><td style={cell}>{display(value)}</td></tr>)}</tbody>
              </table></div>
              <p className="source-note">Normalized Usage: {display(expandedRow.usage_kwh)} kWh. Other columns, including CO₂ and load classification, remain attributes of this external CSV only.</p>
            </section>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
              <button className="secondary-action" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous 25 rows</button>
              <button className="secondary-action" type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next 25 rows →</button>
            </div>
          </>}
          <p className="source-note">This source page shows recorded history, not a forecast. Prediction, the cited 2018 industrial price benchmark, and test accuracy belong to the separate Energy Dashboard.</p>
        </section>
      </>}
    </main>
  </div>
}
