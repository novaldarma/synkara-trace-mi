import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { listActions, statusLabels, type FollowupAction } from '../../services/actions'
import { supabase } from '../../services/supabase'

type Incident = {
  record_id: string
  source_id: string
  source_row: number
  occurred_date: string
  plant_code: string
  asset_tag_as_provided: string
}
type Measurement = { parameter_label_raw: string; unit_as_provided: string; value: number }
type Equipment = {
  record_id: string; source_id: string; source_row: number; observed_date: string
  health_status_as_provided: string; measurements: Measurement[]
}
type Production = {
  record_id: string; source_id: string; source_row: number; observed_at_naive: string
  tag_name: string; value: number; unit: string
}
type Rca = { document_id: string; source_file: string; visual_review_status: string }
type Entry<T> = { status: 'loading' | 'ready' | 'missing' | 'error'; value: T | null }
type Snapshot = { equipment: Entry<Equipment>; production: Entry<Production>; rca: Entry<Rca> }
const loading = <T,>(): Entry<T> => ({ status: 'loading', value: null })
const missing = <T,>(): Entry<T> => ({ status: 'missing', value: null })
const error = <T,>(): Entry<T> => ({ status: 'error', value: null })
const ready = <T,>(value: T): Entry<T> => ({ status: 'ready', value })
const initial = (): Snapshot => ({ equipment: loading(), production: loading(), rca: loading() })
const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function finite(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`))
}
function sourceUrl(path: string, params: Record<string, string>, anchor: string) {
  return `${path}?${new URLSearchParams(params)}#${anchor}`
}

async function loadEquipment(assetId: string, incidentDate: string): Promise<Entry<Equipment>> {
  const result = await supabase.from('equipment_observations')
    .select('record_id,source_id,source_row,observed_date,health_status_as_provided,measurements')
    .eq('dataset_id', 'caliber2026_case2').eq('asset_id', assetId).lt('observed_date', incidentDate)
    .order('observed_date', { ascending: false }).order('record_id').limit(1)
  if (result.error) return error()
  const row = result.data?.[0]
  if (!row) return missing()
  if (typeof row.record_id !== 'string' || typeof row.source_id !== 'string' ||
    typeof row.source_row !== 'number' || typeof row.observed_date !== 'string' ||
    typeof row.health_status_as_provided !== 'string' || !Array.isArray(row.measurements)) return error()
  const measurements: Measurement[] = []
  for (const item of row.measurements) {
    if (!object(item) || typeof item.parameter_label_raw !== 'string' ||
      typeof item.unit_as_provided !== 'string') return error()
    const value = finite(item.value)
    if (value !== null) measurements.push({ parameter_label_raw: item.parameter_label_raw.replace(/\s+/g, ' ').trim(),
      unit_as_provided: item.unit_as_provided, value })
  }
  return ready({ record_id: row.record_id, source_id: row.source_id, source_row: row.source_row,
    observed_date: row.observed_date, health_status_as_provided: row.health_status_as_provided, measurements })
}

async function loadProduction(assetId: string, incidentDate: string): Promise<Entry<Production>> {
  // No occurrence hour is supplied. Use only readings strictly before the incident date.
  const result = await supabase.from('production_records')
    .select('record_id,source_id,source_row,observed_at_naive,raw')
    .eq('dataset_id', 'caliber2026_case2').eq('asset_id', assetId)
    .lt('observed_at_naive', `${incidentDate}T00:00:00`)
    .order('observed_at_naive', { ascending: false }).order('record_id').limit(1)
  if (result.error) return error()
  const row = result.data?.[0]
  if (!row) return missing()
  if (typeof row.record_id !== 'string' || typeof row.source_id !== 'string' ||
    typeof row.source_row !== 'number' || typeof row.observed_at_naive !== 'string' ||
    !object(row.raw) || row.observed_at_naive.slice(0, 10) >= incidentDate) return error()
  const values = await supabase.from('production_values')
    .select('tag_name,numeric_value,engineering_unit_as_provided')
    .eq('production_record_id', row.record_id).order('tag_name').limit(30)
  if (values.error) return error()
  const usable = (values.data ?? []).filter(item => typeof item.tag_name === 'string' &&
    Object.hasOwn(row.raw, item.tag_name) && finite(item.numeric_value) !== null &&
    typeof item.engineering_unit_as_provided === 'string')
  const selected = usable.find(item => /vib/i.test(item.tag_name)) ??
    usable.find(item => /temp|press|flow/i.test(item.tag_name)) ?? usable[0]
  if (!selected) return missing()
  return ready({ record_id: row.record_id, source_id: row.source_id, source_row: row.source_row,
    observed_at_naive: row.observed_at_naive, tag_name: selected.tag_name,
    value: finite(selected.numeric_value)!, unit: selected.engineering_unit_as_provided })
}

async function loadRca(incident: Incident): Promise<Entry<Rca>> {
  const links = await supabase.from('case_links')
    .select('rca_document_id,asset_id,incident_record_id')
    .eq('dataset_id', 'caliber2026_case2').eq('relation_kind', 'incident_rca')
    .eq('match_status', 'verified').eq('incident_record_id', incident.record_id).limit(2)
  if (links.error || (links.data ?? []).length > 1) return error()
  const link = links.data?.[0]
  if (!link) return missing()
  if (typeof link.rca_document_id !== 'string' || typeof link.asset_id !== 'string' ||
    link.incident_record_id !== incident.record_id) return error()
  const result = await supabase.from('rca_documents')
    .select('document_id,source_file,linked_incident_record_id,asset_id,plant_code,incident_occurred_date,visual_review_status')
    .eq('dataset_id', 'caliber2026_case2').eq('document_id', link.rca_document_id).maybeSingle()
  const row = result.data
  if (result.error || !row || row.document_id !== link.rca_document_id ||
    row.linked_incident_record_id !== incident.record_id || row.asset_id !== link.asset_id ||
    row.plant_code !== incident.plant_code || row.incident_occurred_date !== incident.occurred_date ||
    typeof row.source_file !== 'string' || !['pending','reviewed'].includes(String(row.visual_review_status))) return error()
  return ready({ document_id: row.document_id, source_file: row.source_file,
    visual_review_status: row.visual_review_status })
}

function Detail<T>({ entry, unavailable, children }: {
  entry: Entry<T>; unavailable: string; children: (value: T) => ReactNode
}) {
  if (entry.status === 'loading') return <p role="status">Checking source…</p>
  if (entry.status === 'error') return <p role="alert">Source link could not be verified.</p>
  if (entry.status === 'missing' || !entry.value) return <p>{unavailable}</p>
  return <>{children(entry.value)}</>
}

export default function OverviewCaseEvidence({ incident }: { incident: Incident }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial)
  const [actions, setActions] = useState<Entry<{ count: number; latest: FollowupAction | null }>>(loading)

  useEffect(() => {
    let active = true
    setSnapshot(initial())
    setActions(loading())
    async function load() {
      const [assetResult, rca] = await Promise.all([
        supabase.from('assets').select('asset_id,asset_tag,plant_code')
          .eq('dataset_id', 'caliber2026_case2')
          .eq('asset_tag', incident.asset_tag_as_provided).eq('plant_code', incident.plant_code)
          .eq('detailed_observations_available', true).limit(2),
        loadRca(incident),
      ])
      let equipment: Entry<Equipment> = missing()
      let production: Entry<Production> = missing()
      if (assetResult.error || (assetResult.data ?? []).length > 1) {
        equipment = error(); production = error()
      } else {
        const asset = assetResult.data?.[0]
        if (asset) {
          if (typeof asset.asset_id !== 'string' || asset.asset_tag !== incident.asset_tag_as_provided ||
            asset.plant_code !== incident.plant_code) {
            equipment = error(); production = error()
          } else {
            [equipment, production] = await Promise.all([
              loadEquipment(asset.asset_id, incident.occurred_date),
              loadProduction(asset.asset_id, incident.occurred_date),
            ])
          }
        }
      }
      if (active) setSnapshot({ equipment, production, rca })
    }
    void load().catch(() => {
      if (active) setSnapshot({ equipment: error(), production: error(), rca: error() })
    })
    void listActions(incident.record_id, 'all', '', 1)
      .then(result => { if (active) setActions(ready({ count: result.count, latest: result.actions[0] ?? null })) })
      .catch(() => { if (active) setActions(error()) })
    return () => { active = false }
  }, [incident.record_id, incident.asset_tag_as_provided, incident.plant_code, incident.occurred_date])

  return <section className="panel overview-evidence" aria-labelledby="overview-evidence-heading">
    <div className="section-heading">
      <div><p className="scope-label">03 / CASE EVIDENCE</p><h2 id="overview-evidence-heading">What supports the next review?</h2></div>
      <Link className="text-link" to={`/dashboard/investigation/${encodeURIComponent(incident.record_id)}`}>Open full investigation ↗</Link>
    </div>
    <p className="overview-evidence-intro">One recorded incident, two separate observation sources, and any linked retrospective RCA. The incident date has no verified event hour.</p>
    <div className="overview-evidence-grid">
      <article>
        <span className="overview-evidence-type">01 · INCIDENT DATABASE</span>
        <strong>{dateLabel(incident.occurred_date)} · recorded event</strong>
        <p>Impact and case identity come from Incident Database row {incident.source_row}.</p>
        <Link to={sourceUrl('/data/incidents', { record: incident.record_id, field: 'Downtime (hrs)' }, 'incident-source-record')}>Inspect exact row ↗</Link>
      </article>
      <article>
        <span className="overview-evidence-type">02 · WEEKLY EQUIPMENT</span>
        <Detail entry={snapshot.equipment} unavailable="No earlier detailed Equipment observation supplied for this asset.">
          {row => <><strong>{dateLabel(row.observed_date)} · source status {row.health_status_as_provided}</strong>
            <p>{row.measurements.filter(item => /vibration|water/i.test(item.parameter_label_raw)).slice(0, 2)
              .map(item => `${item.parameter_label_raw}: ${amount.format(item.value)} ${item.unit_as_provided}`).join(' · ') || 'Open the source for recorded measurements.'}</p>
            <Link to={sourceUrl('/data/equipment', { source: row.source_id, observation: row.record_id, field: 'Health Status' }, 'equipment-source-observation')}>Equipment row {row.source_row} ↗</Link></>}
        </Detail>
      </article>
      <article>
        <span className="overview-evidence-type">03 · HOURLY PRODUCTION</span>
        <Detail entry={snapshot.production} unavailable="No earlier hourly Production reading supplied for this asset.">
          {row => <><strong>{row.observed_at_naive.replace('T', ' ').slice(0, 16)} · source clock</strong>
            <p>{row.tag_name}: {amount.format(row.value)} {row.unit}. Separate source and unit from weekly Equipment.</p>
            <Link to={sourceUrl('/data/production', { source: row.source_id, record: row.record_id, field: row.tag_name }, 'production-source-record')}>Production row {row.source_row} ↗</Link></>}
        </Detail>
      </article>
      <article>
        <span className="overview-evidence-type">04 · AFTER-EVENT RCA</span>
        <Detail entry={snapshot.rca} unavailable="No RCA document was supplied and verified for this incident.">
          {row => <><strong>Historical document linked</strong>
            <p>{row.visual_review_status === 'pending' ? 'Structured slide review pending.' : 'Structured slide review recorded.'} Its conclusions were not available to the earlier observation view.</p>
            <Link to={sourceUrl('/data/rca', { document: row.document_id }, 'rca-source-document')}>Inspect RCA source ↗</Link></>}
        </Detail>
      </article>
    </div>
    <div className="overview-evidence-action">
      <div><span className="overview-evidence-type">HUMAN FOLLOW-UP · DEMO WORKFLOW</span>
        {actions.status === 'loading' ? <p role="status">Checking saved actions…</p> :
          actions.status === 'error' ? <p role="alert">Action status unavailable. Open Actions to check.</p> :
          actions.value?.count ? <p>{actions.value.count} saved action{actions.value.count === 1 ? '' : 's'} for this incident.{actions.value.latest && <> First listed: <strong>{statusLabels[actions.value.latest.status]}</strong>{actions.value.latest.responsible_function ? ` · ${actions.value.latest.responsible_function}` : ''}.</>} Demo status is not physical maintenance completion.</p> :
            <p>No follow-up action saved for this incident in this account's demo workspace. An engineer must review the evidence before proposing one.</p>}</div>
      <Link className="secondary-link" to={`/dashboard/actions?${new URLSearchParams({ incidentId: incident.record_id })}`}>Review or propose follow-up ↗</Link>
    </div>
    <p className="overview-evidence-note">Earlier observations are context, not a proven prediction or cause. Weekly dates have no verified availability hour; Production timestamps have no verified timezone. RCA is retrospective.</p>
  </section>
}
