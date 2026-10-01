import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../services/supabase'

type Source = { source_id: string; relative_path: string; source_sha256: string }
type Reference = {
  record_id: string; source_row: number; reference_kind: string
  raw: Record<string, unknown> | null
  field_name_as_provided: string | null; field_value_as_provided: unknown
  post_event_context: boolean
  parameter_name_as_provided: string | null; parameter_label_raw: string | null
  unit_as_provided: string | null; alarm_trip_raw: string | null
  historical_valid_from: string | null
}
type Measure = { parameter_label_raw: string; unit_as_provided: string; value: unknown }
type Observation = {
  record_id: string; source_row: number; observed_date_raw: string
  week_as_provided: number | null; health_status_as_provided: string
  measurements: Measure[]; raw: Record<string, unknown>
}
type Summary = {
  record_id: string; source_row: number; kpi_name_as_provided: string
  value_as_provided: unknown; basis_as_provided: string | null; raw: Record<string, unknown>
}
type Status = 'loading' | 'ready' | 'error'

const frame: CSSProperties = { overflowX: 'auto', border: '1px solid #d7e1e3', borderRadius: 6 }
const table: CSSProperties = { width: '100%', minWidth: 700, borderCollapse: 'collapse', fontSize: '.875rem' }
const heading: CSSProperties = { textAlign: 'left', whiteSpace: 'nowrap', padding: 11, background: '#eaf3f1', borderBottom: '1px solid #b9ceca' }
const cell: CSSProperties = { padding: 11, verticalAlign: 'top', borderBottom: '1px solid #e2eaeb' }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sourceRow(value: unknown): value is Source {
  return object(value) && typeof value['source_id'] === 'string' &&
    typeof value['relative_path'] === 'string' && typeof value['source_sha256'] === 'string'
}

function referenceRow(value: unknown): value is Reference {
  if (!object(value)) return false
  const kind = value['reference_kind']
  return typeof value['record_id'] === 'string' && typeof value['source_row'] === 'number' &&
    (kind === 'source_row' || kind === 'metadata' || kind === 'threshold') &&
    (value['raw'] === null || object(value['raw'])) &&
    (value['field_name_as_provided'] === null || typeof value['field_name_as_provided'] === 'string') &&
    typeof value['post_event_context'] === 'boolean' &&
    (value['parameter_name_as_provided'] === null || typeof value['parameter_name_as_provided'] === 'string')
}

function observationRow(value: unknown): value is Observation {
  return object(value) && typeof value['record_id'] === 'string' &&
    typeof value['source_row'] === 'number' && typeof value['observed_date_raw'] === 'string' &&
    (value['week_as_provided'] === null || typeof value['week_as_provided'] === 'number') &&
    typeof value['health_status_as_provided'] === 'string' && object(value['raw']) &&
    Array.isArray(value['measurements']) && value['measurements'].length === 4 &&
    value['measurements'].every((m: unknown) => object(m) &&
      typeof m['parameter_label_raw'] === 'string' && typeof m['unit_as_provided'] === 'string')
}

function summaryRow(value: unknown): value is Summary {
  return object(value) && typeof value['record_id'] === 'string' &&
    typeof value['source_row'] === 'number' && typeof value['kpi_name_as_provided'] === 'string' &&
    (value['basis_as_provided'] === null || typeof value['basis_as_provided'] === 'string') &&
    object(value['raw'])
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function fileName(path: string): string { return path.split(/[\\/]/).pop() ?? path }

export default function EquipmentPage() {
  const [params, setParams] = useSearchParams()
  const requestedSourceId = params.get('source')
  const requestedObservationId = params.get('observation')
  const requestedField = params.get('field')
  const requestedSummaryField = params.get('summaryField')
  const [sources, setSources] = useState<Source[]>([])
  const [catalogStatus, setCatalogStatus] = useState<Status>('loading')
  const [sourceId, setSourceId] = useState('')
  const [references, setReferences] = useState<Reference[]>([])
  const [observations, setObservations] = useState<Observation[]>([])
  const [summary, setSummary] = useState<Summary[]>([])
  const [dataStatus, setDataStatus] = useState<Status>('loading')

  useEffect(() => {
    let active = true
    async function loadSources() {
      const { data, error } = await supabase.from('source_catalog')
        .select('source_id,relative_path,source_sha256')
        .eq('dataset_id', 'caliber2026_case2').eq('source_kind', 'equipment')
        .order('relative_path')
      if (!active) return
      if (error || (data ?? []).some((row) => !sourceRow(row))) {
        setCatalogStatus('error')
        return
      }
      const valid = (data ?? []) as Source[]
      setSources(valid)
      setSourceId(valid.find((item) => item.source_id === requestedSourceId)?.source_id ?? valid[0]?.source_id ?? '')
      setCatalogStatus('ready')
    }
    void loadSources()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!sourceId) return
    let active = true
    setDataStatus('loading')
    setReferences([])
    setObservations([])
    setSummary([])

    async function loadWorkbook() {
      const [info, condition, performance] = await Promise.all([
        supabase.from('equipment_reference')
          .select('record_id,source_row,reference_kind,raw,field_name_as_provided,field_value_as_provided,post_event_context,parameter_name_as_provided,parameter_label_raw,unit_as_provided,alarm_trip_raw,historical_valid_from')
          .eq('source_id', sourceId).order('source_row'),
        supabase.from('equipment_observations')
          .select('record_id,source_row,observed_date_raw,week_as_provided,health_status_as_provided,measurements,raw')
          .eq('source_id', sourceId).order('observed_date'),
        supabase.from('equipment_summary_values')
          .select('record_id,source_row,kpi_name_as_provided,value_as_provided,basis_as_provided,raw')
          .eq('source_id', sourceId).order('source_row'),
      ])
      if (!active) return
      const refs = info.data ?? []
      const weekly = condition.data ?? []
      const kpis = performance.data ?? []
      if (info.error || condition.error || performance.error ||
        refs.some((item) => !referenceRow(item)) || weekly.some((item) => !observationRow(item)) ||
        kpis.some((item) => !summaryRow(item)) ||
        refs.filter((item) => item.reference_kind === 'source_row').length !== 14 ||
        refs.filter((item) => item.reference_kind === 'metadata').length !== 12 ||
        refs.filter((item) => item.reference_kind === 'threshold').length !== 4 ||
        weekly.length !== 26 || kpis.length !== 13) {
        setDataStatus('error')
        return
      }
      setReferences(refs as Reference[])
      setObservations(weekly as Observation[])
      setSummary(kpis as Summary[])
      setDataStatus('ready')
    }

    void loadWorkbook()
    return () => { active = false }
  }, [sourceId])

  useEffect(() => {
    if (dataStatus === 'ready' && requestedObservationId &&
      observations.some((row) => row.record_id === requestedObservationId) &&
      window.location.hash === '#equipment-source-observation') {
      document.getElementById('equipment-source-observation')?.scrollIntoView({ block: 'center' })
    }
  }, [dataStatus, observations, requestedObservationId])

  const current = sources.find((item) => item.source_id === sourceId)
  const originalInfo = references.filter((item) => item.reference_kind === 'source_row')
  const metadata = references.filter((item) => item.reference_kind === 'metadata')
  const thresholds = references.filter((item) => item.reference_kind === 'threshold')
  const labels = observations[0]?.measurements.map((measure) => measure.parameter_label_raw) ?? []

  return <div className="app-shell">
    <a className="skip-link" href="#equipment-content">Skip to source data</a>
    <header className="app-topbar">
      <Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
      <nav aria-label="Source navigation"><Link className="secondary-link" to="/dashboard">← Case 2 workspace</Link></nav>
    </header>
    <main id="equipment-content" className="dashboard-content">
      <div className="dashboard-title">
        <p className="scope-label">SOURCE DATA · CASE 2 · EQUIPMENT</p>
        <h1>Equipment Performance</h1>
        <p>Three historical sheets per supplied asset: Equipment Info, weekly Condition History, and the provided Performance Summary.</p>
      </div>
      <p className="route-status">Retrospective source access: this page contains information documented after incidents and full-period summaries. It is not a pre-incident replay.</p>
      {catalogStatus === 'loading' && <p role="status" className="route-status">Loading equipment workbooks…</p>}
      {catalogStatus === 'error' && <p role="alert" className="route-status">The equipment source catalog could not be loaded.</p>}
      {catalogStatus === 'ready' && sources.length === 0 && <p role="status" className="route-status">No equipment workbooks are available.</p>}
      {catalogStatus === 'ready' && sources.length > 0 && <>
        <section className="panel" aria-labelledby="equipment-file-heading">
          <h2 id="equipment-file-heading">Select source workbook</h2>
          <label className="tariff-field">Workbook
            <select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setDataStatus('loading'); setParams({ source: event.target.value }) }}>
              {sources.map((item) => <option key={item.source_id} value={item.source_id}>{fileName(item.relative_path)}</option>)}
            </select>
          </label>
          {current && <p className="source-note">File: {current.relative_path} · Source SHA-256: {current.source_sha256}. Five detailed assets are supplied; this does not represent all company equipment.</p>}
        </section>
        {dataStatus === 'loading' && <p role="status" className="route-status">Loading the selected workbook's three sheets…</p>}
        {dataStatus === 'error' && <p role="alert" className="route-status">A source sheet is missing, incomplete, or could not be validated for this workbook.</p>}
        {dataStatus === 'ready' && <>
          <section className="panel" aria-labelledby="equipment-info-heading">
            <h2 id="equipment-info-heading">Equipment Info · supplied metadata</h2>
            <div style={frame}><table style={table}>
              <thead><tr><th scope="col" style={heading}>Excel row</th><th scope="col" style={heading}>Field</th><th scope="col" style={heading}>Value as provided</th><th scope="col" style={heading}>Context</th></tr></thead>
              <tbody>{metadata.map((item) => <tr key={item.record_id}>
                <td style={cell}>{item.source_row}</td>
                <th scope="row" style={cell}>{display(item.field_name_as_provided)}</th>
                <td style={cell}>{display(item.field_value_as_provided)}</td>
                <td style={cell}>{item.post_event_context ? 'Post-incident metadata; retrospective only' : 'Source metadata'}</td>
              </tr>)}</tbody>
            </table></div>
            <h3>Alarm / Trip text as provided</h3>
            <div style={frame}><table style={table}>
              <thead><tr><th scope="col" style={heading}>Excel row</th><th scope="col" style={heading}>Parameter (original label)</th><th scope="col" style={heading}>Alarm / Trip from file</th><th scope="col" style={heading}>Historical validity</th></tr></thead>
              <tbody>{thresholds.map((item) => <tr key={item.record_id}>
                <td style={cell}>{item.source_row}</td><th scope="row" style={cell}>{display(item.parameter_label_raw ?? item.parameter_name_as_provided)}</th>
                <td style={cell}>{display(item.alarm_trip_raw)} {display(item.unit_as_provided)}</td>
                <td style={cell}>{item.historical_valid_from ?? 'Unknown; reference value only'}</td>
              </tr>)}</tbody>
            </table></div>
            <details style={{ marginTop: 15 }}><summary>View all 14 original Equipment Info rows</summary>
              <div style={{ ...frame, marginTop: 12 }}><table style={table}>
                <thead><tr><th scope="col" style={heading}>Excel row</th><th scope="col" style={heading}>Column A</th><th scope="col" style={heading}>Column B</th><th scope="col" style={heading}>Column C</th><th scope="col" style={heading}>Column D</th></tr></thead>
                <tbody>{originalInfo.map((item) => <tr key={item.record_id}>
                  <th scope="row" style={cell}>{item.source_row}</th>{['A', 'B', 'C', 'D'].map((column) => <td style={cell} key={column}>{display(item.raw?.[column])}</td>)}
                </tr>)}</tbody>
              </table></div>
            </details>
            <p className="source-note">The KO-3201 micron references here and Production vibration in MM/S are different measurements. Threshold direction and the date each setting became valid are not verified.</p>
          </section>

          <section className="panel" aria-labelledby="condition-heading">
            <h2 id="condition-heading">Condition History · weekly observations</h2>
            <p className="source-note">26 source observations for this asset. Dates have no supplied observation time; do not interpret this table as hourly Production data.</p>
            {requestedObservationId && !observations.some((row) => row.record_id === requestedObservationId) && <p role="alert">The linked observation is not present in this workbook. Check the source selection.</p>}
            {requestedObservationId && observations.some((row) => row.record_id === requestedObservationId) && <p role="status">The linked source row is highlighted below; open its “Source row” details to inspect the original cell values.</p>}
            <div style={frame}><table style={{ ...table, minWidth: 1050 }}>
              <thead><tr><th scope="col" style={heading}>Excel row</th><th scope="col" style={heading}>Week</th><th scope="col" style={heading}>Source date</th>
                {labels.map((label) => <th key={label} scope="col" style={heading}>{label}</th>)}
                <th scope="col" style={heading}>Health Status</th><th scope="col" style={heading}>Remark</th><th scope="col" style={heading}>Origin</th></tr></thead>
              <tbody>{observations.map((row) => <tr key={row.record_id} id={row.record_id === requestedObservationId ? 'equipment-source-observation' : undefined} style={row.record_id === requestedObservationId ? { background: '#e8f4f1', outline: '2px solid #2b6867', outlineOffset: -2 } : undefined}>
                <td style={cell}>{row.source_row}</td><td style={cell}>{display(row.week_as_provided)}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{row.observed_date_raw}</td>
                {row.measurements.map((measure) => <td style={cell} className={row.record_id === requestedObservationId && measure.parameter_label_raw === requestedField ? 'source-field-highlight' : undefined} key={measure.parameter_label_raw}>{display(measure.value)} {measure.unit_as_provided}</td>)}
                <td style={cell} className={row.record_id === requestedObservationId && requestedField === 'Health Status' ? 'source-field-highlight' : undefined}>{row.health_status_as_provided}</td><td style={cell}>{display(row.raw['Remark'])}</td>
                <td style={cell}><details><summary>Source row</summary><p>Condition History, Excel row {row.source_row}. Internal record ID: {row.record_id}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(row.raw, null, 2)}</pre></details></td>
              </tr>)}</tbody>
            </table></div>
            <p className="source-note">Health Status is copied from the workbook. A historical alarm configuration cannot be inferred from these observations alone.</p>
          </section>

          <section className="panel" aria-labelledby="equipment-summary-heading">
            <h2 id="equipment-summary-heading">Performance Summary · provided full-period values</h2>
            {requestedSummaryField && !summary.some(item => item.kpi_name_as_provided === requestedSummaryField || Object.hasOwn(item.raw,requestedSummaryField)) && <p role="alert">No original summary row or field matches the requested KPI label.</p>}
            <div style={frame}><table style={table}>
              <thead><tr><th scope="col" style={heading}>Excel row</th><th scope="col" style={heading}>KPI label in source</th><th scope="col" style={heading}>Value</th><th scope="col" style={heading}>Basis / Formula in source</th></tr></thead>
              <tbody>{summary.map((item) => <tr key={item.record_id} className={requestedSummaryField && (item.kpi_name_as_provided === requestedSummaryField || Object.hasOwn(item.raw,requestedSummaryField)) ? 'source-field-highlight' : undefined}>
                <td style={cell}>{item.source_row}</td><th scope="row" style={cell}>{item.kpi_name_as_provided}</th>
                <td style={cell}>{display(item.value_as_provided)}</td><td style={cell}>{display(item.basis_as_provided)}</td>
              </tr>)}</tbody>
            </table></div>
            <p className="source-note">These 13 KPIs belong to the workbook's full period. Period Hours is a provided value; Estimated Loss can duplicate incident loss and must not be added to an incident total.</p>
          </section>
        </>}
      </>}
    </main>
  </div>
}
