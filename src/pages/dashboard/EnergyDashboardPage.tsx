import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { FX_2018_KRW_PER_USD, FX_SOURCE, INDUSTRIAL_BENCHMARK_USD_PER_KWH, INDUSTRIAL_PRICE_2018_KRW_PER_KWH, PRICE_SOURCE, indicativeUsd } from '../../services/energyBenchmark'
import preparedSummary from '../../../imports/prepared/energy_forecast/forecast_summary.json'

type Forecast = {
  forecast_id: string; cutoff_sequence_index: number; cutoff_timestamp_derived_naive: string
  model_run_id: string; selected_baseline: string; test_cutoff_count: number
  predicted_kwh_by_horizon: (number | string)[]; predicted_hour_kwh_as_provided: number | string
  horizon_minutes: number[]; source_scope: string; interval_semantics_status: string
}
type Evaluation = { forecast_id: string; cutoff_sequence_index: number
  actual_kwh_by_horizon: (number | string)[]; actual_hour_kwh_as_provided: number | string
  absolute_hour_total_error_kwh: number | string }
type Model = { model_run_id: string; validation_baselines: Record<string, Record<string, number>>
  test_baselines: Record<string, Record<string, number>>; model_version: string; selected_baseline: string
  source_id: string; prepared_readings_sha256: string; test_cutoff_count: number }
const scope = 'external_steel_industry_south_korea_2018'
const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
const number = (n: unknown) => n !== '' && n !== null && Number.isFinite(Number(n)) ? Number(n) : NaN

export default function EnergyDashboardPage() {
  const [params, setParams] = useSearchParams()
  const [index, setIndex] = useState(params.get('cutoff') ?? '35036')
  const cutoff = params.get('cutoff') ?? '35036'
  const revealGeneration = useRef(0)
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [model, setModel] = useState<Model | null>(null)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [revealStatus, setRevealStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [revealError, setRevealError] = useState('')
  const [samples, setSamples] = useState<{cutoff_sequence_index:number;cutoff_timestamp_derived_naive:string}[]>([])

  useEffect(() => { setIndex(cutoff) }, [cutoff])

  useEffect(() => {
    let alive = true
    void supabase.from('dashboard_energy_forecasts')
      .select('cutoff_sequence_index,cutoff_timestamp_derived_naive')
      .eq('source_scope',scope).in('cutoff_sequence_index',[29760,32100,35036])
      .order('cutoff_sequence_index').then(({data,error}) => {
        if (alive && !error) setSamples((data ?? []).filter(row => typeof row.cutoff_sequence_index === 'number' && typeof row.cutoff_timestamp_derived_naive === 'string'))
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    revealGeneration.current += 1
    setForecast(null); setModel(null); setEvaluation(null); setRevealError(''); setRevealStatus('idle'); setStatus('loading')
    async function load() {
      const result = await supabase.from('dashboard_energy_forecasts')
        .select('forecast_id,cutoff_sequence_index,cutoff_timestamp_derived_naive,model_run_id,selected_baseline,test_cutoff_count,predicted_kwh_by_horizon,predicted_hour_kwh_as_provided,horizon_minutes,source_scope,interval_semantics_status')
        .eq('source_scope', scope).eq('cutoff_sequence_index', Number(cutoff)).maybeSingle()
      if (!alive) return
      if (result.error) { setStatus('error'); return }
      if (!result.data) { setStatus('missing'); return }
      const row = result.data as Forecast
      const values = Array.isArray(row.predicted_kwh_by_horizon) ? row.predicted_kwh_by_horizon.map(number) : []
      if (row.source_scope !== scope || row.cutoff_sequence_index !== Number(cutoff) ||
        values?.length !== 4 || values.some(v => !Number.isFinite(v) || v < 0) ||
        !Number.isFinite(number(row.predicted_hour_kwh_as_provided)) ||
        row.horizon_minutes?.join(',') !== '15,30,45,60' ||
        Math.abs(values.reduce((s, n) => s + n, 0) - number(row.predicted_hour_kwh_as_provided)) > 0.01) {
        setStatus('error'); return
      }
      setForecast(row); setStatus('ready')
      const metrics = await supabase.from('energy_model_runs')
        .select('model_run_id,validation_baselines,test_baselines,model_version,selected_baseline,source_id,prepared_readings_sha256,test_cutoff_count').eq('model_run_id', row.model_run_id).maybeSingle()
      if (alive && !metrics.error && metrics.data?.model_run_id === row.model_run_id) setModel(metrics.data as Model)
    }
    if (!/^\d{5}$/.test(cutoff) || Number(cutoff) < 29760 || Number(cutoff) > 35036) setStatus('missing')
    else void load()
    return () => { alive = false }
  }, [cutoff])

  async function reveal() {
    if (!visibleForecast || revealStatus === 'loading') return
    const request = ++revealGeneration.current
    const selected = visibleForecast
    setRevealError(''); setRevealStatus('loading')
    const { data, error } = await supabase.rpc('reveal_energy_forecast', { p_forecast_id: selected.forecast_id })
    if (request !== revealGeneration.current) return
    const row = (data as Evaluation[] | null)?.[0]
    const actualValues = Array.isArray(row?.actual_kwh_by_horizon) ? row.actual_kwh_by_horizon.map(number) : []
    if (error || !row || data?.length !== 1 || row.forecast_id !== selected.forecast_id ||
      row.cutoff_sequence_index !== selected.cutoff_sequence_index ||
      actualValues.length !== 4 || actualValues.some(v => !Number.isFinite(v) || v < 0) ||
      !Number.isFinite(number(row.actual_hour_kwh_as_provided)) ||
      Math.abs(actualValues.reduce((sum,v)=>sum+v,0)-number(row.actual_hour_kwh_as_provided)) > 0.01 ||
      !Number.isFinite(number(row.absolute_hour_total_error_kwh)) ||
      Math.abs(Math.abs(number(row.actual_hour_kwh_as_provided)-number(selected.predicted_hour_kwh_as_provided))-number(row.absolute_hour_total_error_kwh)) > 0.01) {
      setRevealError(error?.code === 'PGRST202' || error?.code === '42883'
        ? 'The evaluation function is unavailable. Check the database deployment and account access.'
        : 'The historical evaluation could not be verified for this account. The observed result is withheld; check access and imported evaluation rows.')
      setRevealStatus('error'); return
    }
    setEvaluation(row); setRevealStatus('idle')
  }

  const visibleForecast = status === 'ready' && forecast?.cutoff_sequence_index === Number(cutoff) ? forecast : null
  const visibleEvaluation = visibleForecast && evaluation?.forecast_id === visibleForecast.forecast_id && evaluation.cutoff_sequence_index === visibleForecast.cutoff_sequence_index ? evaluation : null
  const predicted = visibleForecast ? number(visibleForecast.predicted_hour_kwh_as_provided) : NaN
  const actual = visibleEvaluation ? number(visibleEvaluation.actual_hour_kwh_as_provided) : NaN
  const usd = (n: number) => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2}).format(n)
  const benchmark = model?.test_baselines?.[visibleForecast?.selected_baseline ?? '']
  const preparedBenchmark = preparedSummary.test_baselines.last_observation
  const distribution = visibleForecast && model && benchmark &&
    model.model_run_id === visibleForecast.model_run_id && model.model_version === preparedSummary.model_version &&
    model.source_id === preparedSummary.source_id && model.prepared_readings_sha256 === preparedSummary.prepared_energy_sha256 &&
    model.selected_baseline === preparedSummary.selected_baseline && visibleForecast.selected_baseline === preparedSummary.selected_baseline &&
    model.test_cutoff_count === preparedSummary.test_cutoff_count && visibleForecast.test_cutoff_count === preparedSummary.test_cutoff_count &&
    Math.abs(Number(benchmark.mean_absolute_one_hour_total_error_kwh) - preparedBenchmark.mean_absolute_one_hour_total_error_kwh) < 0.00001 &&
    Math.abs(Number(benchmark.mae_kwh_per_interval_all_horizons) - preparedBenchmark.mae_kwh_per_interval_all_horizons) < 0.00001
      ? preparedBenchmark.four_interval_total_absolute_error_distribution_kwh : null

  function apply(event: FormEvent) {
    event.preventDefault(); revealGeneration.current += 1; setParams({ cutoff: index })
  }

  return <div className="app-shell"><a className="skip-link" href="#energy-content">Skip to content</a>
    <header className="app-topbar"><Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
      <nav><Link className="secondary-link" to="/dashboard">← Overview</Link><span aria-current="page">Energy analysis</span></nav></header>
    <main className="dashboard-content" id="energy-content">
      <div className="dashboard-title"><p className="scope-label">EXTERNAL / SOUTH KOREAN STEEL / 2018</p>
        <h1>Forecast the next hour</h1><p>Choose a point in the historic test period, view four predictions, then reveal what happened.</p></div>
      <section className="panel"><h2>1 · Select a historical example</h2>
        <div className="sample-cutoffs">{samples.map((sample) => <button key={sample.cutoff_sequence_index} className={cutoff === String(sample.cutoff_sequence_index) ? 'sample-active' : ''} type="button" onClick={() => { const next=String(sample.cutoff_sequence_index); revealGeneration.current += 1; setIndex(next); setParams({cutoff:next}) }}><span>{sample.cutoff_sequence_index === 29760 ? 'Early test' : sample.cutoff_sequence_index === 32100 ? 'Middle test' : 'Late test'}</span><strong>{sample.cutoff_timestamp_derived_naive}</strong></button>)}</div>
        {!samples.length && <p className="source-note">Loading example cutoffs. The current forecast can still be viewed below.</p>}
        <details className="inline-evidence"><summary>Enter another test sequence</summary><form className="filter-row" onSubmit={apply}>
          <label>Source sequence (29,760–35,036)<input type="number" min="29760" max="35036" step="1" value={index} onChange={e => setIndex(e.target.value)} required /></label>
          <button className="primary-link" type="submit">Apply cutoff ↗</button>
        </form></details><p className="source-note">UCI steel, 2018. Display timestamps are derived from source order; time zone is not verified.</p></section>
      {status === 'loading' && <p role="status" className="route-status">Loading prediction…</p>}
      {status === 'missing' && <p role="status" className="route-status">No stored test prediction at this cutoff. Choose a supported sequence.</p>}
      {status === 'error' && <p role="alert" className="route-status">Forecast could not be checked. No result is displayed.</p>}
      {visibleForecast && <>
        <section className="panel energy-panel"><p className="scope-label">2 / PREDICT · ACTUAL HIDDEN UNTIL REVEAL</p>
          <h2>Next four 15-minute intervals</h2><p>From {visibleForecast.cutoff_timestamp_derived_naive} · model {visibleForecast.selected_baseline}.</p>
          <div className="energy-intervals">{visibleForecast.predicted_kwh_by_horizon.map((v,i) => <div key={i}><span>+{visibleForecast.horizon_minutes[i]} minutes</span><strong>{fmt(number(v))} kWh</strong>{visibleEvaluation && <small>Observed: {fmt(number(visibleEvaluation.actual_kwh_by_horizon[i]))} kWh</small>}</div>)}</div>
          <div className="metrics-grid"><div className="metric-card"><span>Predicted four-interval sum</span><strong>{fmt(predicted)} kWh</strong><small>One-hour estimate if interval semantics hold.</small></div>
            <div className="metric-card"><span>Observed four-interval sum</span><strong>{visibleEvaluation ? `${fmt(actual)} kWh` : 'Hidden'}</strong><small>Reveal after inspecting the prediction.</small></div></div>
          {!visibleEvaluation && <button className="primary-link" type="button" disabled={revealStatus === 'loading'} onClick={() => { void reveal() }}>Reveal held-out result ↗</button>}
          {revealStatus === 'error' && <p role="alert">{revealError}</p>}
          {visibleEvaluation && <p className="insight-note">Absolute error for this cutoff: <strong>{fmt(number(visibleEvaluation.absolute_hour_total_error_kwh))} kWh</strong>. This single example is distinct from the test mean.</p>}
          {visibleEvaluation && <div className="source-note"><p>Stored evaluation checked against this exact forecast and cutoff.</p><ul>{visibleForecast.horizon_minutes.map((h,i) => <li key={h}><Link to={`/data/energy?sequence=${visibleForecast.cutoff_sequence_index+i+1}&field=Usage_kWh#energy-source-record`}>+{h} min → original CSV sequence {visibleForecast.cutoff_sequence_index+i+1}, column Usage_kWh</Link></li>)}</ul></div>}
          <p className="source-note"><Link to={`/data/energy?sequence=${visibleForecast.cutoff_sequence_index}&field=Usage_kWh#energy-source-record`}>Inspect the input reading at cutoff · CSV sequence {visibleForecast.cutoff_sequence_index} ↗</Link></p>
          <p className="source-note">Source: UCI Steel Industry Energy Consumption; interval meaning: {visibleForecast.interval_semantics_status}. This test is retrospective, with predictions made before the four outcomes.</p>
        </section>
        <section className="panel"><h2>3 · Illustrative historical cost · US$</h2>
          <p>2018 South Korean industrial sale price: <strong>{INDUSTRIAL_PRICE_2018_KRW_PER_KWH} KRW/kWh</strong> ÷ annual average <strong>{fmt(FX_2018_KRW_PER_USD)} KRW/US$</strong> = <strong>US${INDUSTRIAL_BENCHMARK_USD_PER_KWH.toFixed(4)}/kWh</strong>. The calculation uses the unrounded rate.</p>
          <div className="metrics-grid"><div className="metric-card"><span>Forecast variable cost · indicative</span><strong>{usd(indicativeUsd(predicted))}</strong><small>Predicted four-interval kWh × 2018 benchmark</small></div>
            <div className="metric-card"><span>Observed variable cost · indicative</span><strong>{visibleEvaluation ? usd(indicativeUsd(actual)) : 'Hidden until reveal'}</strong><small>Same benchmark after revealing original readings</small></div>
            <div className="metric-card"><span>Cost estimate absolute difference</span><strong>{visibleEvaluation ? usd(indicativeUsd(Math.abs(predicted-actual))) : 'Hidden until reveal'}</strong><small>Backtest error, not a saving</small></div></div>
          <details className="inline-evidence"><summary>Check benchmark and currency sources</summary><ul><li><a href={PRICE_SOURCE} target="_blank" rel="noopener noreferrer">Korean Energy Agency, electricity sale price table · 2018 industrial column</a> (source: KEPCO statistics).</li><li><a href={FX_SOURCE} target="_blank" rel="noopener noreferrer">US Federal Reserve G.5A annual exchange rate · 2018 SOUTH KOREA / WON column</a>.</li></ul><p>National annual averages, not the UCI facility tariff, contract price or a company bill. Demand charges and plant energy semantics are not established.</p></details></section>
        <section className="panel"><h2>Model accuracy on the test period</h2>{benchmark ? <div className="metrics-grid"><div className="metric-card"><span>Test cutoffs</span><strong>{visibleForecast.test_cutoff_count.toLocaleString('en-US')}</strong><small>Chronological test period; overlapping target windows.</small></div><div className="metric-card"><span>Per-interval MAE</span><strong>{Number.isFinite(benchmark.mae_kwh_per_interval_all_horizons) ? `${fmt(Number(benchmark.mae_kwh_per_interval_all_horizons))} kWh` : 'Unavailable'}</strong><small>All four horizons across test cutoffs.</small></div><div className="metric-card"><span>Mean absolute total error</span><strong>{Number.isFinite(benchmark.mean_absolute_one_hour_total_error_kwh) ? `${fmt(Number(benchmark.mean_absolute_one_hour_total_error_kwh))} kWh` : 'Unavailable'}</strong><small>Four-interval sum across test cutoffs.</small></div></div> : <p>Model metrics are unavailable for this account.</p>}
          {distribution ? <details className="inline-evidence"><summary>How much did test errors vary?</summary><p>The absolute error of each four-interval sum has median <strong>{fmt(distribution.median)} kWh</strong>, 90th percentile <strong>{fmt(distribution.p90)} kWh</strong>, 95th percentile <strong>{fmt(distribution.p95)} kWh</strong>, 99th percentile <strong>{fmt(distribution.p99)} kWh</strong>, and maximum <strong>{fmt(distribution.maximum)} kWh</strong>. Calculated across all {preparedSummary.test_cutoff_count.toLocaleString('en-US')} chronological test cutoffs from the original UCI readings. The four-interval target windows overlap; percentiles are descriptive, not calibrated uncertainty bounds.</p><p>For a less favorable example, <Link to="/dashboard/energy?cutoff=32100">inspect cutoff 32,100</Link>; reveal its observed intervals and check each source row.</p></details> : <p className="source-note">Error distribution unavailable until the displayed model and source checksum match the validated prepared summary.</p>}
          <p className="source-note">Baseline selection used chronological validation. Test performance does not establish accuracy for any chemical plant.</p><Link className="secondary-link" to="/data/energy">Inspect original energy records →</Link></section>
      </>}
    </main></div>
}
