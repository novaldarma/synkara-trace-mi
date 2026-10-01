import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../services/supabase'

type Domain = 'production' | 'equipment' | 'incidents' | 'rca'
type Asset = { asset_id: string; asset_tag: string; plant_code: string }
type Signal = { production_record_id:string; source_id:string; observed_at_naive: string; tag_name: string; numeric_value: number | null; text_value: string | null; engineering_unit_as_provided: string | null }
type Condition = { observation_id:string; source_id:string; observed_date: string; health_status_as_provided: string; measurements: { parameter_label_raw: string; value: number | string; unit_as_provided: string }[] }
type Incident = { record_id: string; occurred_date: string; plant_code: string; asset_tag_as_provided: string; downtime_hours: number | string; actual_loss_kusd: number | string }
type Rca = { document_id: string; source_file: string; plant_code: string; asset_id: string; linked_incident_record_id: string; visual_review_status: string; slide_count: number }
const n = (v: unknown) => Number(v)
const fmt = (v: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v)
const names: Record<Domain, string> = { production: 'Production', equipment: 'Equipment', incidents: 'Incidents', rca: 'RCA' }
const descriptions: Record<Domain, string> = {
  production: 'Hourly readings for five detailed assets. Compare signals only within their own source and unit.',
  equipment: 'Weekly condition observations on the five detailed assets, with source health labels.',
  incidents: 'Recorded impact across the 12 supplied plant labels. These are historical events.',
  rca: 'Five historical RCA documents linked to incidents; extracted slide interpretation is awaiting visual review.',
}

function Bars({ points, label, unit }: { points: { key: string; value: number; url?: string }[]; label: string; unit: string }) {
  const max = Math.max(1, ...points.map(p => p.value))
  return <div className="chart-card"><h3>{label}</h3><div className="bar-list" role="img" aria-label={`${label}, ${unit}`}>
    {points.map(p => <div className="bar-row" key={p.key}><span title={p.key}>{p.key}</span><div className="bar-track"><span style={{ width: `${Math.max(1, p.value / max * 100)}%` }} /></div><strong>{fmt(p.value)} {unit}</strong></div>)}
  </div>{points.at(-1)?.url && <Link className="secondary-link" to={points.at(-1)!.url!}>Inspect latest plotted source row and column ↗</Link>}</div>
}

export default function DomainDashboardPage({ domain }: { domain: Domain }) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [assetId, setAssetId] = useState('')
  const [signals, setSignals] = useState<Signal[]>([])
  const [conditions, setConditions] = useState<Condition[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [documents, setDocuments] = useState<Rca[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (domain !== 'production' && domain !== 'equipment') return
    let live = true
    void supabase.from('assets').select('asset_id,asset_tag,plant_code').eq('detailed_observations_available', true)
      .order('asset_tag').then(({ data, error }) => {
        if (!live) return
        if (error) setStatus('error')
        else { const rows = (data ?? []) as Asset[]; setAssets(rows); setAssetId(rows.find(r => r.asset_tag === 'KO-3201')?.asset_id ?? rows[0]?.asset_id ?? '') }
      })
    return () => { live = false }
  }, [domain])

  useEffect(() => {
    if ((domain === 'production' || domain === 'equipment') && !assetId) return
    let live = true
    setStatus('loading'); setSignals([]); setConditions([]); setIncidents([]); setDocuments([])
    async function load() {
      if (domain === 'production') {
        const { data, error } = await supabase.from('dashboard_production_signals')
          .select('production_record_id,source_id,observed_at_naive,tag_name,numeric_value,text_value,engineering_unit_as_provided')
          .eq('asset_id', assetId).order('observed_at_naive', { ascending: false }).limit(168)
        if (live) { if (error) setStatus('error'); else { setSignals((data ?? []) as Signal[]); setStatus('ready') } }
      } else if (domain === 'equipment') {
        const { data, error } = await supabase.from('dashboard_equipment_conditions')
          .select('observation_id,source_id,observed_date,health_status_as_provided,measurements').eq('asset_id',assetId)
          .order('observed_date', { ascending: false }).limit(26)
        if (live) { if (error) setStatus('error'); else { setConditions((data ?? []) as Condition[]); setStatus('ready') } }
      } else if (domain === 'incidents') {
        const { data, count, error } = await supabase.from('incident_records')
          .select('record_id,occurred_date,plant_code,asset_tag_as_provided,downtime_hours,actual_loss_kusd', { count: 'exact' })
          .eq('dataset_id', 'caliber2026_case2').order('occurred_date', { ascending: false }).range(0, 999)
        if (live) { if (error || count !== data?.length) setStatus('error'); else { setIncidents((data ?? []) as Incident[]); setStatus('ready') } }
      } else {
        const { data, error } = await supabase.from('rca_documents')
          .select('document_id,source_file,plant_code,asset_id,linked_incident_record_id,visual_review_status,slide_count')
          .eq('dataset_id','caliber2026_case2').order('document_id').limit(6)
        if (live) { if (error || data?.length !== 5) setStatus('error'); else { setDocuments(data as Rca[]); setStatus('ready') } }
      }
    }
    void load()
    return () => { live = false }
  }, [domain, assetId])

  const asset = assets.find(a => a.asset_id === assetId)
  const last = conditions[0]
  const series = useMemo(() => {
    const byTag = new Map<string, { unit: string; points: { key: string; value: number; url: string }[] }>()
    for (const s of [...signals].reverse()) {
      if (s.numeric_value === null || !Number.isFinite(n(s.numeric_value))) continue
      const item = byTag.get(s.tag_name) ?? { unit: s.engineering_unit_as_provided ?? 'source unit', points: [] }
      item.points.push({ key: s.observed_at_naive.slice(5,16), value: n(s.numeric_value),
        url:`/data/production?${new URLSearchParams({source:s.source_id,record:s.production_record_id,field:s.tag_name})}#production-source-record` }); byTag.set(s.tag_name, item)
    }
    return [...byTag.entries()].filter(([key]) => /RATE|VIB|AMP/i.test(key)).slice(0,3)
  }, [signals])
  const byPlant = useMemo(() => [...new Set(incidents.map(i => i.plant_code))].sort().map(key => ({ key,
    value: incidents.filter(i => i.plant_code === key).length })), [incidents])
  const totalHours = incidents.reduce((sum, row) => sum + n(row.downtime_hours), 0)
  const actualLoss = incidents.reduce((sum, row) => sum + n(row.actual_loss_kusd), 0)

  return <div className="app-shell"><a className="skip-link" href="#domain-content">Skip to content</a>
    <header className="app-topbar"><Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
      <nav><Link className="secondary-link" to="/dashboard">← Overview</Link><span aria-current="page">{names[domain]} analysis</span></nav></header>
    <main className="dashboard-content" id="domain-content">
      <div className="dashboard-title"><p className="scope-label">CASE 2 · RETROSPECTIVE ANALYSIS</p><h1>{names[domain]} dashboard</h1><p>{descriptions[domain]}</p></div>
      {(domain === 'equipment' || domain === 'production') && <section className="panel"><h2>Select a detailed asset</h2><label className="tariff-field">Asset / plant<select value={assetId} onChange={e => setAssetId(e.target.value)}>{assets.map(a => <option key={a.asset_id} value={a.asset_id}>{a.asset_tag} · {a.plant_code}</option>)}</select></label><p className="source-note">Five assets have detailed Production and Equipment sources. The 12-plant incident portfolio has wider coverage.</p></section>}
      {status === 'loading' && <p className="route-status" role="status">Loading {names[domain]} analysis…</p>}
      {status === 'error' && <p className="route-status" role="alert">Source data could not be verified. Analytical figures are unavailable.</p>}
      {status === 'ready' && <>
        {domain === 'production' && <section className="panel"><h2>Recent readings · {asset?.asset_tag}</h2>
          {signals.length === 0 ? <p>No Production observation for this asset.</p> : <><p>Displaying {new Set(signals.map(s => s.observed_at_naive)).size} recent source timestamps. Each chart retains its own source unit.</p>
            <div className="analysis-grid">{series.map(([tag, s]) => <Bars key={tag} label={tag} points={s.points.slice(-12)} unit={s.unit} />)}</div>
            <p className="source-note">RUN_STATUS OFF is an observation, not an incident downtime duration. Generic tags and equivalent T/H are not aggregated across files.</p></>}
          <Link className="secondary-link" to="/data/production">Inspect original PI Tag and Sheet2 records →</Link></section>}
        {domain === 'equipment' && <><section className="metrics-grid"><article className="metric-card"><span>Weekly observations</span><strong>{conditions.length}</strong><small>Condition History for this asset.</small></article><article className="metric-card"><span>Latest recorded status</span><strong>{last?.health_status_as_provided ?? 'No observation'}</strong><small>Source label, {last?.observed_date ?? 'date unavailable'}.</small></article></section>
          <section className="panel"><h2>Weekly condition · {asset?.asset_tag}</h2>{last?.measurements?.length ? <div className="analysis-grid">{last.measurements.map((m,i) => <div className="metric-card" key={i}><span>{m.parameter_label_raw}</span><strong>{Number.isFinite(n(m.value)) ? fmt(n(m.value)) : String(m.value)} {m.unit_as_provided}</strong><small>Observation {last.observed_date}</small></div>)}</div> : <p>No weekly readings available.</p>}
            <p className="source-note">Equipment measurements and Production signals differ in grain and may differ in units. The full-period Performance Summary is a retrospective source value.</p>
            {last && <Link className="secondary-link" to={`/data/equipment?${new URLSearchParams({source:last.source_id,observation:last.observation_id,field:'Health Status'})}#equipment-source-observation`}>Inspect this dated Condition History row · Health Status →</Link>}</section></>}
        {domain === 'incidents' && <><section className="metrics-grid"><article className="metric-card"><span>Recorded events</span><strong>{fmt(incidents.length)}</strong><small>Source incident rows.</small></article><article className="metric-card"><span>Recorded downtime</span><strong>{fmt(totalHours)} h</strong><small>Incident Database, not Production OFF.</small></article><article className="metric-card"><span>Actual loss</span><strong>US${fmt(actualLoss/1000)}M</strong><small>Source totals in thousands of US dollars. Potential loss remains separate.</small></article></section>
          <section className="panel"><h2>Incidents by plant label</h2><Bars label="Historical events" unit="events" points={byPlant} /><p className="source-note">Counts describe the supplied dataset, not all company events. Open Problem Tank for sortable impact and individual cases.</p><Link className="primary-link" to="/dashboard/problem-tank">Review incidents in Problem Tank ↗</Link></section></>}
        {domain === 'rca' && <section className="panel"><h2>Documents in competition baseline</h2><div className="analysis-grid">{documents.map(d => <article className="demo-card" key={d.document_id}><p className="scope-label">{d.plant_code} · {d.slide_count} SLIDES</p><h3>{d.source_file}</h3><p>Visual review: {d.visual_review_status}. Text extracted for inspection, not a verified interpretation of diagrams.</p><Link className="secondary-link" to={`/dashboard/investigation/${encodeURIComponent(d.linked_incident_record_id)}`}>Open linked investigation →</Link><br /><Link className="secondary-link" to={`/data/rca?document=${encodeURIComponent(d.document_id)}#rca-source-document`}>Inspect RCA record and PDF rendition ↗</Link></article>)}</div><p className="source-note">Five links are verified against incident identity; slide contents still require individual visual inspection. Other incidents may have RCA outside the provided baseline.</p></section>}
      </>}
    </main></div>
}
