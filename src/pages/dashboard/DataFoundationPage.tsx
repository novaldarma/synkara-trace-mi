import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { FX_SOURCE, PRICE_SOURCE } from '../../services/energyBenchmark'

type Source = { source_id: string; source_kind: string; relative_path: string; source_scope: string; granularity_label: string; source_sha256: string; record_count: number | null }
type Mapping = { field_map_id: string; source_id: string; source_sheet: string | null; field_path_as_provided: string; unit_as_provided: string | null; observation_grain: string; kpi_code: string | null; caveat: string | null }
type Kpi = { kpi_code: string; display_name: string; definition_status: string; definition_version: number; unit_label: string | null; observation_grain: string | null; formula_text: string | null; filter_basis: string | null; limitations: string }
type Issue = { issue_id: string; title: string; severity: string; evidence_status: string; impact_and_handling: string }

export default function DataFoundationPage() {
  const [sources, setSources] = useState<Source[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [kpis, setKpis] = useState<Kpi[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading')
  useEffect(() => {
    let live = true
    async function load() {
      const [a,b,c,d] = await Promise.all([
        supabase.from('source_catalog').select('source_id,source_kind,relative_path,source_scope,granularity_label,source_sha256,record_count').order('source_kind'),
        supabase.from('source_field_map').select('field_map_id,source_id,source_sheet,field_path_as_provided,unit_as_provided,observation_grain,kpi_code,caveat').order('field_path_as_provided'),
        supabase.from('kpi_definitions').select('kpi_code,display_name,definition_status,definition_version,unit_label,observation_grain,formula_text,filter_basis,limitations').order('kpi_code'),
        supabase.from('data_quality_issues').select('issue_id,title,severity,evidence_status,impact_and_handling').eq('issue_status','open').limit(50),
      ])
      if (!live) return
      if ([a,b,c,d].some(r=>r.error)) setStatus('error')
      else { setSources((a.data ?? []) as Source[]); setMappings((b.data ?? []) as Mapping[]);
        setKpis((c.data ?? []) as Kpi[]); setIssues((d.data ?? []) as Issue[]); setStatus('ready') }
    }
    void load(); return () => { live = false }
  }, [])

  const sourceName = (id: string) => sources.find(s => s.source_id === id)?.relative_path.split('/').at(-1) ?? id
  const scope = (code: string) => code.startsWith('case2.') ? 'CASE 2' : 'EXTERNAL / TEAM DEFINED'
  function sourceUrl(m: Mapping) {
    const source = sources.find(s=>s.source_id===m.source_id)
    if (source?.source_kind === 'incident') return `/data/incidents?field=${encodeURIComponent(m.field_path_as_provided)}#source-rows-heading`
    if (source?.source_kind === 'equipment') return `/data/equipment?source=${encodeURIComponent(m.source_id)}&summaryField=${encodeURIComponent(m.field_path_as_provided)}#equipment-summary-heading`
    if (source?.source_kind === 'external_electricity_history') return `/data/energy?field=${encodeURIComponent(m.field_path_as_provided)}#electricity-rows-heading`
    return '/sources'
  }

  return <div className="app-shell"><a className="skip-link" href="#foundation-content">Skip to content</a>
    <header className="app-topbar"><Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link><nav><Link className="secondary-link" to="/dashboard">← Overview</Link></nav></header>
    <main className="dashboard-content" id="foundation-content">
      <div className="dashboard-title"><p className="scope-label">CASE 2 / GOVERNED FOUNDATION</p><h1>Know where the number comes from.</h1><p>Every KPI has a definition, source field, observation frequency, and known limit.</p></div>
      {status === 'loading' && <p className="route-status" role="status">Loading source registry…</p>}
      {status === 'error' && <p className="route-status" role="alert">The source register could not be read for this account. Ask the workspace owner to check access and database deployment.</p>}
      {status === 'ready' && <>
        <section className="metrics-grid" aria-label="Foundation coverage">
          <article className="metric-card"><span>Registered files</span><strong>{sources.length}</strong><small>Including external energy if imported.</small></article>
          <article className="metric-card"><span>Mapped fields</span><strong>{mappings.length}</strong><small>Traceable source columns.</small></article>
          <article className="metric-card"><span>KPI definitions</span><strong>{kpis.length}</strong><small>Definitions and version labels.</small></article>
          <article className="metric-card"><span>Open findings shown</span><strong>{issues.length}</strong><small>Up to 50 visible issues.</small></article>
        </section>
        <section className="panel" aria-labelledby="map-heading"><h2 id="map-heading">Source → KPI map</h2>
          <p className="source-note">Case 2 calculations remain separate from the external 2018 energy example.</p>
          {kpis.some(k=>k.kpi_code==='external_uci.variable_cost_scenario_rp') && <p role="alert">This database still contains a superseded Rp scenario definition. The Energy page uses a cited historical US$ benchmark. Ask the workspace owner to compare this project's live KPI rows and migration history with the local 012 definition before presenting the map as current; do not rerun an already applied migration blindly.</p>}
          {!mappings.length && <p role="alert">Database source-to-KPI mapping has not been registered. The KPI definitions below remain readable, but their field-level provenance must be checked before submission. Workspace owner: verify migration 010 against this project's migration history and imported sources.</p>}
          <div className="foundation-list">{kpis.map(k => {
            const fields = mappings.filter(m => m.kpi_code === k.kpi_code)
            const unavailable = k.definition_status === 'unavailable'
            const benchmark = k.kpi_code === 'external_uci.variable_cost_benchmark_usd'
            return <details className="foundation-row" key={k.kpi_code}>
              <summary><span><small>{scope(k.kpi_code)} · {k.definition_status} / v{k.definition_version}</small><strong>{k.display_name}</strong></span>
                <span className="foundation-source">{fields.length ? [...new Set(fields.map(m => sourceName(m.source_id)))].join(', ') : unavailable ? 'No company meter provided' : benchmark ? 'Derived from UCI + published averages' : 'Mapping pending'}<small>{k.unit_label ?? 'unit not provided'}</small></span></summary>
              <div className="foundation-detail"><p><strong>Observation frequency:</strong> {k.observation_grain ?? 'Not available'} · <strong>Filter:</strong> {k.filter_basis ?? 'Not applicable'}</p>
                {k.formula_text && <p><strong>Definition:</strong> {k.formula_text}</p>}<p><strong>Known limit:</strong> {k.limitations}</p>
                {fields.length ? <><p>A field mapping applies to the named source column across the file. Open an individual incident or reading for a specific row's value.</p><ul>{fields.map(m => <li key={m.field_map_id}><a className="evidence-source-link" href={sourceUrl(m)}>{sourceName(m.source_id)} · {m.source_sheet ?? 'CSV'} · original column “{m.field_path_as_provided}” ↗</a><small> · {m.unit_as_provided ?? 'unit unavailable'} · {m.observation_grain}{m.caveat ? ` · ${m.caveat}` : ''}</small></li>)}</ul></> : unavailable ? <p>No company source column exists for this metric in the supplied Case 2 files.</p> : benchmark ? <p>Calculated from original UCI <a href="/data/energy">Usage_kWh records</a> and two published 2018 national averages: <a href={PRICE_SOURCE} target="_blank" rel="noopener noreferrer">industrial sale price</a> and <a href={FX_SOURCE} target="_blank" rel="noopener noreferrer">KRW/US$ exchange rate</a>. These external tables are outside the imported UCI CSV.</p> : <p>No database field mapping was returned. Do not present this definition as source-verified yet.</p>}</div>
            </details>
          })}</div>
        </section>
        <details className="panel explore-panel"><summary>Source file registry <span>{sources.length} files</span></summary>
          <div className="analysis-grid">{sources.map(s => <article className="demo-card" key={s.source_id}><p className="scope-label">{s.source_scope}</p><h3>{s.relative_path.split('/').at(-1)}</h3><p>{s.granularity_label} · {s.record_count ?? '—'} rows listed<br /><small>SHA256 {s.source_sha256.slice(0,12)}…</small></p></article>)}</div>
        </details>
        <details className="panel explore-panel"><summary>Open data quality findings <span>{issues.length} shown</span></summary>
          {issues.length ? <div className="analysis-grid">{issues.map(i => <article className="demo-card" key={i.issue_id}><p className="scope-label">{i.severity} · {i.evidence_status}</p><h3>{i.title}</h3><p>{i.impact_and_handling}</p></article>)}</div> : <p>No open issues returned for this account.</p>}
        </details>
      </>}
    </main>
  </div>
}
