import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ActionError, createDraft, initialProposal, loadContext, type ActionContext, type Proposal, type SaveRequest } from '../../../services/actions'
import { EvidenceContext } from './ActionEvidence'
import { clearSession, errorText, readSession, saveSession } from './ui'

type TraceDraftHandoff = {
  version: 1
  incident: string
  createdAt: string
  generated: boolean
  traceVersion: string
  candidate: {
    title: string
    action: string
    rationale: string
    successCriteria: string
  }
}

const TRACE_HANDOFF_TTL_MS = 30 * 60 * 1000

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textBetween(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
}

function traceHandoffKey(incident: string) {
  return `trace-mi:v5:trace-handoff:${incident}`
}

function readTraceDraftHandoff(incident: string): TraceDraftHandoff | null {
  try {
    const key = traceHandoffKey(incident)
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null

    const value: unknown = JSON.parse(raw)
    if (!record(value) || value.version !== 1 || value.incident !== incident ||
      typeof value.createdAt !== 'string' || typeof value.generated !== 'boolean' ||
      !textBetween(value.traceVersion, 1, 100) || !record(value.candidate)) return null

    const candidate = value.candidate
    const title = candidate.title
    const action = candidate.action
    const rationale = candidate.rationale
    const successCriteria = candidate.successCriteria

    if (!textBetween(title, 8, 140) ||
      !textBetween(action, 20, 1200) ||
      !textBetween(rationale, 20, 1800) ||
      !textBetween(successCriteria, 20, 1200)) return null

    const created = Date.parse(value.createdAt)
    const age = Date.now() - created
    if (!Number.isFinite(created) || age < -5 * 60 * 1000 || age > TRACE_HANDOFF_TTL_MS) {
      window.sessionStorage.removeItem(key)
      return null
    }

    return {
      version: 1,
      incident,
      createdAt: value.createdAt,
      generated: value.generated,
      traceVersion: value.traceVersion,
      candidate: {
        title: title.trim(),
        action: action.trim(),
        rationale: rationale.trim(),
        successCriteria: successCriteria.trim(),
      },
    }
  } catch {
    return null
  }
}

function proposalFromTrace(handoff: TraceDraftHandoff): Proposal {
  return {
    title: handoff.candidate.title,
    action_text: handoff.candidate.action,
    rationale: handoff.candidate.rationale,
    success_criteria: handoff.candidate.successCriteria,
    source_kind: 'inspection_proposal',
    action_type: 'preventive',
  }
}

export function ProposalFields({ value, onChange, fixedOrigin = false }: { value: Proposal; onChange: (p: Proposal) => void; fixedOrigin?: boolean }) {
  const set = (key: keyof Proposal, next: string) => onChange({ ...value, [key]: next })
  return <>
    <label>Action title <input required minLength={8} maxLength={140} value={value.title} onChange={e => set('title', e.target.value)} /></label>
    <div className="action-form-columns">
      <label>Proposal origin<select value={value.source_kind} disabled={fixedOrigin || value.source_kind === 'reviewed_rca_action'} onChange={e => set('source_kind',e.target.value)}>
        <option value="inspection_proposal">Evidence-assisted review proposal</option><option value="manual_proposal">Manual proposal</option>{value.source_kind === 'reviewed_rca_action' && <option value="reviewed_rca_action">Reviewed historical RCA action</option>}
      </select></label>
      <label>Intended follow-up category<select value={value.action_type} onChange={e => set('action_type',e.target.value)}><option value="preventive">Preventive follow-up</option><option value="corrective">Corrective follow-up</option></select></label>
    </div>
    <p className="source-note">The category describes the proposal's intent. It does not prove prevention or establish a cause. Proposal origin describes how the draft started; it is not an AI diagnosis, approval or proof of cause.</p>
    <label>What should be checked or done?<textarea required minLength={20} maxLength={1200} rows={4} value={value.action_text} onChange={e => set('action_text',e.target.value)} /></label>
    <label>Why is this action relevant?<textarea required minLength={20} maxLength={1800} rows={4} value={value.rationale} onChange={e => set('rationale',e.target.value)} /></label>
    <label>What result should the reviewer check?<textarea required minLength={20} maxLength={1200} rows={4} value={value.success_criteria} onChange={e => set('success_criteria',e.target.value)} /></label>
  </>
}
export default function DraftComposer({ account, incident, historical, tracePrefill = false, onSaved, onClose }: { account: string; incident: string; historical: string | null; tracePrefill?: boolean; onSaved: (id: string) => void; onClose: () => void }) {
  const storageKey = `trace-mi:v5:draft:${account}:${incident}:${historical ?? ''}`
  const traceKey = traceHandoffKey(incident)
  const [restored] = useState(() => readSession<{ proposal: Proposal; pending: SaveRequest | null }>(storageKey))
  const [traceHandoff] = useState(() =>
    tracePrefill && !historical && !restored ? readTraceDraftHandoff(incident) : null
  )
  const [context, setContext] = useState<ActionContext | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(restored?.proposal ?? null)
  const [pending, setPending] = useState<SaveRequest | null>(restored?.pending ?? null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const guard = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    loadContext(incident,historical).then(c => {
      if (!alive) return
      setContext(c)
      setProposal(p => p ?? (traceHandoff ? proposalFromTrace(traceHandoff) : initialProposal(c)))
      setLoading(false)
    }).catch(e => { if (alive) { setError(errorText(e)); setLoading(false) } })
    return () => { alive = false }
  },[incident,historical,retry,traceHandoff])
  useEffect(() => { if(proposal) saveSession(storageKey,{ proposal, pending }) },[proposal,pending,storageKey])
  async function save(event?: FormEvent) {
    event?.preventDefault()
    if (!context || !proposal || guard.current) return
    const req = pending ?? { incident, requestKey: crypto.randomUUID(), contextHash: context.context_hash, proposal, historicalAction: historical }
    guard.current = true; setBusy(true); setError(''); setPending(req); saveSession(storageKey,{proposal,pending:req})
    try {
      const id = await createDraft(req)
      clearSession(storageKey)
      if (traceHandoff) {
        try { window.sessionStorage.removeItem(traceKey) } catch { /* transient handoff cleanup only */ }
      }
      onSaved(id)
    }
    catch(e) { setError(errorText(e)); if (!(e instanceof ActionError && e.uncertain)) { setPending(null); saveSession(storageKey,{proposal,pending:null}) } }
    finally { guard.current=false; setBusy(false) }
  }
  return <section className="panel action-composer" aria-labelledby="draft-heading" aria-busy={busy || loading}>
    <div className="action-panel-heading"><div><p className="scope-label">{traceHandoff ? '1 · TRACE PREFILL · HUMAN REVIEW REQUIRED' : '1 · PREPARE A SOURCE-LINKED PROPOSAL'}</p><h2 id="draft-heading" tabIndex={-1} ref={heading}>{traceHandoff ? 'Review the proposed follow-up' : 'Propose a follow-up'}</h2></div><button className="secondary-action" disabled={busy} onClick={onClose}>Close draft</button></div>
    {error && <p className="action-error" role="alert">{error}</p>}
    {loading && <p role="status">Loading the case evidence…</p>}
    {!loading && !context && <button className="secondary-action" onClick={() => setRetry(n=>n+1)}>Retry evidence</button>}
    {context && proposal && <div className="action-compose-grid"><EvidenceContext context={context} /><form onSubmit={save} className="action-form">
      {restored && <p className="source-note">Your unsaved draft was restored for this case and account.</p>}
      {restored && tracePrefill && <p className="source-note">An existing unsaved human draft took precedence and was not overwritten by the TRACE prefill.</p>}
      {traceHandoff && <div className="insight-note"><strong>{traceHandoff.generated ? 'TRACE AI prefill · human review required.' : 'TRACE source-bound prefill · human review required.'}</strong> The wording below came from the investigation and remains fully editable. The server rebuilds the stable evidence context when this proposal is saved; TRACE evidence IDs are not copied as database authority. Review the follow-up category as a human decision.</div>}
      {tracePrefill && !restored && !traceHandoff && <p className="action-warning" role="status">The TRACE handoff was unavailable, invalid or expired. A normal source-bound starter proposal is shown instead; no AI text was silently substituted.</p>}
      <fieldset disabled={busy || !!pending}><ProposalFields value={proposal} onChange={setProposal} fixedOrigin={!!traceHandoff} /></fieldset>
      {pending && !busy && <p role="status">An earlier save has not been confirmed. Retry its exact contents before editing this draft.</p>}
      <button className="primary-link" disabled={busy} type="submit">{busy ? 'Saving proposal…' : pending ? 'Retry this save safely' : 'Save proposal for review'}</button>
      <p className="source-note">Saving creates an unassigned demo proposal. Acceptance is a separate decision.</p>
    </form></div>}
  </section>
}
