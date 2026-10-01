import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../services/supabase'

type Asset = { asset_id: string; asset_tag: string; plant_code: string }
type IncidentOption = { record_id:string; asset_tag_as_provided:string; plant_code:string; occurred_date:string }
type Evidence = Record<string, unknown>
type Answer = { answer: string; generated: boolean; mode: string; evidence: Evidence
  verifiedFacts?: string[]; citations: { label: string; table?: string; source_id: string; record_id: string; fields?: string[] }[]; limitation: string }

export default function AssistantPage() {
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'retrospective' | 'replay'>('retrospective')
  const [incidentId, setIncidentId] = useState(params.get('incident') ?? '')
  const [assets, setAssets] = useState<Asset[]>([])
  const [incidents, setIncidents] = useState<IncidentOption[]>([])
  const [assetId, setAssetId] = useState('')
  const [cutoff, setCutoff] = useState('2026-04-22')
  const [question, setQuestion] = useState('What does the supplied evidence show, and what should an engineer check?')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    void supabase.from('assets').select('asset_id,asset_tag,plant_code')
      .eq('detailed_observations_available',true).order('asset_tag').then(({data}) => {
        if (!live) return
        const rows = (data ?? []) as Asset[]; setAssets(rows)
        setAssetId(rows.find(r => r.asset_tag === 'KO-3201')?.asset_id ?? rows[0]?.asset_id ?? '')
      })
    void supabase.from('incident_records').select('record_id,asset_tag_as_provided,plant_code,occurred_date')
      .eq('dataset_id','caliber2026_case2').order('occurred_date',{ascending:false}).limit(50)
      .then(async ({data,error}) => {
        if (!live || error) return
        const rows = (data ?? []) as IncidentOption[]
        if (incidentId && !rows.some(row => row.record_id === incidentId)) {
          const selected = await supabase.from('incident_records').select('record_id,asset_tag_as_provided,plant_code,occurred_date')
            .eq('dataset_id','caliber2026_case2').eq('record_id',incidentId).maybeSingle()
          if (!live) return
          if (!selected.error && selected.data) rows.unshift(selected.data as IncidentOption)
        }
        setIncidents(rows)
        if (!incidentId) setIncidentId(rows[0]?.record_id ?? '')
      })
    return () => { live = false }
  }, [])

  async function ask(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setAnswer(null)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Your session expired. Sign in again.')
      const response = await fetch('/api/assistant', { method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body:JSON.stringify({ mode, question, incidentId:incidentId.trim(), assetId, cutoff }) })
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        throw new Error('Evidence assistant needs its server function. Restart npm run dev after configuring the project, or open the deployed URL.')
      }
      const value: unknown = await response.json().catch(() => {
        throw new Error('The assistant server returned an incomplete response. Try again or inspect the evidence in Investigate.')
      })
      if (!response.ok || !value || typeof value !== 'object' || !('answer' in value) ||
        typeof value.answer !== 'string') throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Assistant unavailable. Inspect the source records directly.')
      setAnswer(value as Answer)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Assistant unavailable.') }
    finally { setBusy(false) }
  }

  return <div className="app-shell"><a className="skip-link" href="#assistant-content">Skip to content</a>
    <header className="app-topbar"><Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
      <nav><Link className="secondary-link" to="/dashboard">← Overview</Link><span aria-current="page">Evidence assistant</span></nav></header>
    <main className="dashboard-content" id="assistant-content">
      <div className="dashboard-title"><p className="scope-label">CASE 2 · HUMAN REVIEW REQUIRED</p><h1>Evidence assistant</h1>
        <p>Ask about one accessible case or a historical asset cutoff. Every response shows its source and limits; proposed checks require an engineer’s judgment.</p></div>
      <section className="panel"><h2>Choose evidence and time</h2>
        <form onSubmit={e => { void ask(e) }}>
          <div className="filter-row"><label>Analysis mode<select value={mode} onChange={e => { setMode(e.target.value as typeof mode); setAnswer(null) }}><option value="retrospective">Incident investigation</option><option value="replay">Condition replay before incident</option></select></label>
            {mode === 'retrospective' ? <label>Recorded case<select required value={incidentId} onChange={e => setIncidentId(e.target.value)}><option value="">Select an incident</option>{incidents.map(i => <option key={i.record_id} value={i.record_id}>{i.asset_tag_as_provided} · {i.plant_code} · {i.occurred_date}</option>)}</select><small>Showing the latest 50 plus any case opened from Investigate. <Link to="/dashboard/problem-tank">Browse all cases ↗</Link></small></label> : <>
              <label>Detailed asset<select value={assetId} required onChange={e => setAssetId(e.target.value)}>{assets.map(a => <option key={a.asset_id} value={a.asset_id}>{a.asset_tag} · {a.plant_code}</option>)}</select></label>
              <label>End of observation date<input type="date" required value={cutoff} onChange={e => setCutoff(e.target.value)} /></label>
            </>}
          </div>
          <label className="assistant-question">Question<textarea required minLength={8} maxLength={800} value={question} onChange={e => setQuestion(e.target.value)} /></label>
          <button className="primary-link" type="submit" disabled={busy || (mode === 'replay' && !assetId)}>{busy ? 'Checking evidence…' : 'Analyze accessible evidence ↗'}</button>
        </form>
        <p className="source-note">Replay enforces its cutoff. Retrospective investigations use a configured server-side AI provider when available; otherwise TRACE-MI falls back to a source-bound summary. No source document is edited and no task is assigned automatically.</p>
      </section>
      {error && <p className="route-status" role="alert">{error} <Link to="/dashboard/problem-tank">Open Investigate →</Link></p>}
      {answer && <section className="panel assistant-result" aria-live="polite"><p className="scope-label">{answer.generated ? 'AI DRAFT · VERIFY BEFORE USE' : 'SOURCE-BOUND SUMMARY · NO MODEL GENERATED'}</p>
        <h2>What the available evidence supports</h2><p className="assistant-answer">{answer.answer}</p>
        <div className="analysis-grid"><div><h3>Verified source facts</h3><ul>{answer.verifiedFacts?.map((fact,index) => <li key={index}>{fact}</li>)}</ul>
          <h3>Open the exact record and column</h3>{answer.citations.length ? <ul>{answer.citations.map(c => <li key={c.record_id}>{c.label}{(c.fields?.length ? c.fields : ['']).map(field => {
              const query = c.table === 'equipment_observations'
                ? new URLSearchParams({source:c.source_id,observation:c.record_id,...(field?{field}:{})})
                : new URLSearchParams({record:c.record_id,...(field?{field}:{})})
              const url = c.table === 'equipment_observations' ? `/data/equipment?${query}#equipment-source-observation` : `/data/incidents?${query}#incident-source-record`
              return <span key={field}> · <a className="evidence-source-link" href={url} target="_blank" rel="noopener noreferrer">{field || 'Original row'} ↗</a></span>
            })}</li>)}</ul> : <p>No observation by the selected cutoff.</p>}</div>
          <div><h3>Important limit</h3><p>{answer.limitation}</p></div></div>
        {mode === 'retrospective' ? <Link className="secondary-link" to={`/dashboard/investigation/${encodeURIComponent(incidentId)}`}>Inspect incident and document links →</Link> : <Link className="secondary-link" to="/dashboard/problem-tank">Inspect the full cutoff replay →</Link>}
        <p className="source-note">Generated wording is a draft; the incident row or historical observation above is the cited evidence. The assistant cannot certify root cause or set safety priority.</p>
      </section>}
    </main></div>
}
