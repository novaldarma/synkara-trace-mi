import { evidenceUrl, type ActionContext, type EvidenceRef } from '../../../services/actions'

export function EvidenceLinks({ refs }: { refs: EvidenceRef[] }) {
  return <ul className="action-evidence-links">{refs.map((ref, index) => {
    const url = evidenceUrl(ref)
    return <li key={`${ref.table}-${index}`}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{ref.label || `Source record ${index + 1}`} <span aria-hidden="true">↗</span><span className="action-sr"> (opens a new tab)</span></a> : <span>Source reference unavailable</span>}
      {(ref.table === 'incident_records' || ref.table === 'equipment_observations') && <small> · highlighted original column: {ref.field ?? (ref.table === 'incident_records' ? 'Downtime (hrs)' : 'Health Status')}</small>}
      {ref.scope === 'post_incident_context_only' && <small>Retrospective context; inspect the slide before using a finding.</small>}</li>
  })}</ul>
}
export function EvidenceContext({ context, compact = false }: { context: ActionContext; compact?: boolean }) {
  const i = context.incident
  return <div className="action-evidence">
    <p className="scope-label">RETROSPECTIVE SOURCE CONTEXT</p>
    <h3>{i.asset} <span>· {i.plant}</span></h3>
    <p>Incident on {i.date} · {i.downtime_hours.toLocaleString('en-US')} h recorded downtime · {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(i.actual_loss_kusd * 1000)} actual loss.</p>
    {context.equipment ? <p>Earlier weekly Equipment record: <strong>{context.equipment.status}</strong> on {context.equipment.date}. This source label does not establish a cause.</p> : <p>No earlier detailed Equipment observation has been established for this incident.</p>}
    <EvidenceLinks refs={context.evidence_refs} />
    {!compact && <details><summary>Evidence limits and snapshot</summary><p>{context.limitations}</p><p>Saved references retain source hashes. Source links show the imported records; a saved proposal retains its original context snapshot. Source observation times have no verified time zone.</p></details>}
  </div>
}
