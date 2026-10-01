import { supabase } from './supabase'

export type ActionStatus = 'draft' | 'assigned' | 'in_progress' | 'completed' | 'completion_review' | 'verified' | 'canceled' | 'rejected'
export type ActionKind = 'inspection_proposal' | 'manual_proposal' | 'reviewed_rca_action'
export type ActionType = 'corrective' | 'preventive'
export type EvidenceRef = { table: string; record_id?: string; source_id?: string; source_row?: number; source_sha256?: string; document_id?: string; slide?: number; field?: string; label: string; scope: string }
export type ActionContext = {
  context_hash: string; context_version: string; limitations: string; evidence_refs: EvidenceRef[]
  incident: { record_id: string; asset: string; plant: string; date: string; source_id: string; source_row: number; downtime_hours: number; actual_loss_kusd: number; potential_loss_kusd: number }
  equipment: { record_id: string; date: string; status: string; measurements: unknown[] } | null
  rca: { document_id: string; file: string; review_status: string } | null
  historical_action: { historical_action_id: string; action_as_written: string; owner_as_written: string | null; plan_date_as_written: string | null; source_status_as_written: string | null; document_id: string; slide: number } | null
}
export type Proposal = { title: string; action_text: string; rationale: string; success_criteria: string; source_kind: ActionKind; action_type: ActionType }
export type FollowupAction = Proposal & {
  action_id: string; incident_record_id: string; evidence_refs: EvidenceRef[]; evidence_snapshot: ActionContext | null
  decision: 'pending' | 'accepted' | 'rejected'; decision_reason: string | null
  owner_user_id: string | null; due_at: string | null; status: ActionStatus
  created_by: string; created_at: string; updated_at: string; revision: number; workflow_version: number
  review_priority: 'unassessed' | 'standard' | 'expedited'; priority_reason: string | null; responsible_function: string
  completion_note: string | null; completion_reference: string | null; verification_note: string | null
  verified_at: string | null; verified_by: string | null; asset: string; plant: string; incident_date: string; overdue: boolean
}
export type ActionEvent = { event_id: number; action_id: string; actor_user_id: string; event_kind: string; old_status: string | null; new_status: string | null; event_note: string | null; happened_at: string; details: Record<string, unknown> }
export type Summary = { needs_review: number; active: number; overdue: number; completion_review: number; verified: number }
export type ActionList = { actions: FollowupAction[]; count: number; page_size: number; summary: Summary; server_time: string }
export type HistoryData = {
  documents: { document_id: string; incident_id: string; asset: string; plant: string; file: string; review_status: string }[]
  actions: { historical_action_id: string; incident_id: string; document_id: string; slide: number; asset: string; plant: string; action_as_written: string; owner_as_written: string | null; plan_date_as_written: string | null; source_status_as_written: string | null }[]
}
export type SaveRequest = { incident: string; requestKey: string; contextHash: string; proposal: Proposal; historicalAction: string | null }
export type ChangeRequest = { actionId: string; revision: number; requestKey: string; operation: string; note: string; details: Record<string, unknown> }

export class ActionError extends Error {
  uncertain: boolean
  constructor(message: string, uncertain = false) { super(message); this.uncertain = uncertain }
}
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) }
function requireObject(v: unknown): Record<string, unknown> {
  if (!object(v)) throw new ActionError('The action response is incomplete. Refresh and try again.')
  return v
}
function isContext(v: unknown): v is ActionContext {
  return object(v) && typeof v.context_hash === 'string' && object(v.incident) && typeof v.incident.record_id === 'string'
    && typeof v.incident.asset === 'string' && Array.isArray(v.evidence_refs) && typeof v.limitations === 'string'
}
function isAction(v: unknown): v is FollowupAction {
  return object(v) && typeof v.action_id === 'string' && typeof v.incident_record_id === 'string'
    && typeof v.asset === 'string' && typeof v.plant === 'string' && typeof v.action_text === 'string'
    && typeof v.revision === 'number' && typeof v.workflow_version === 'number' && Array.isArray(v.evidence_refs)
    && ['draft','assigned','in_progress','completed','completion_review','verified','canceled','rejected'].includes(String(v.status))
    && (v.evidence_snapshot === null || isContext(v.evidence_snapshot))
}
function failure(error: { code?: string; message?: string }, mutation = false): never {
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42703') {
    throw new ActionError('The action workspace needs an update. Ask the workspace owner to install the v5 database update.')
  }
  if (error.code === 'P0001') throw new ActionError(error.message ?? 'The action could not be validated.')
  if (error.code === '42501' || error.code === 'PGRST301') throw new ActionError('Your account cannot make this change. Check your session and refresh.')
  if (error.code === '22007' || error.code === '22008') throw new ActionError('Choose a valid date and time.')
  const uncertain = mutation && (!error.code || !/^\d|^P/.test(error.code))
  throw new ActionError(uncertain ? 'The save result could not be confirmed. Retry the same request below; it will not create a duplicate.' : 'The request could not be completed. Refresh the workspace and try again.', uncertain)
}
async function rpc(name: string, args: Record<string, unknown> = {}, mutation = false): Promise<unknown> {
  try {
    const { data, error } = await supabase.rpc(name, args)
    if (error) failure(error, mutation)
    return data
  } catch (e) {
    if (e instanceof ActionError) throw e
    throw new ActionError(mutation ? 'The save result is uncertain. Retry the same request below.' : 'The workspace could not be reached. Please retry.', mutation)
  }
}
export async function currentMemberId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new ActionError('Sign in again before changing actions.')
  return data.user.id
}
export async function loadContext(incidentId: string, historicalId: string | null): Promise<ActionContext> {
  const data = await rpc('get_action_context_v2', { p_incident_id: incidentId, p_historical_action_id: historicalId })
  if (!isContext(data) || data.incident.record_id !== incidentId) throw new ActionError('The selected source could not be validated.')
  return data
}
export async function listActions(incidentId: string | null, view: string, search: string, page: number): Promise<ActionList> {
  const data = requireObject(await rpc('list_actions_v2', { p_incident_id: incidentId, p_view: view, p_search: search, p_page: page }))
  if (!Array.isArray(data.actions) || !data.actions.every(isAction) || typeof data.count !== 'number' || !object(data.summary)
    || typeof data.server_time !== 'string' || data.page_size !== 12
    || !['needs_review','active','overdue','completion_review','verified'].every(k => typeof (data.summary as Record<string, unknown>)[k] === 'number')) throw new ActionError('The action list could not be validated.')
  return data as unknown as ActionList
}
export async function getAction(actionId: string): Promise<FollowupAction> {
  const data = await rpc('get_action_v2', { p_action_id: actionId })
  if (!isAction(data) || data.action_id !== actionId) throw new ActionError('The selected action could not be validated.')
  return data
}
export async function listActionEvents(actionId: string): Promise<ActionEvent[]> {
  const rows: ActionEvent[] = []
  let expected = -1
  for (let offset = 0; ; offset += 500) {
    const { data, count, error } = await supabase.from('action_events')
      .select('event_id,action_id,actor_user_id,event_kind,old_status,new_status,event_note,happened_at,details', { count: 'exact' })
      .eq('action_id', actionId).order('happened_at').order('event_id').range(offset, offset + 499)
    if (error || count === null || !Array.isArray(data) || (expected >= 0 && count !== expected)
      || data.some(v => !object(v) || v.action_id !== actionId || typeof v.event_id !== 'number' || typeof v.happened_at !== 'string')) {
      throw new ActionError('The complete history could not be loaded. Refresh to retrieve a consistent history.')
    }
    expected = count
    rows.push(...data as ActionEvent[])
    if (rows.length === count) break
    if (!data.length || rows.length > count) throw new ActionError('History changed while loading. Please refresh.')
  }
  return rows
}
export async function createDraft(r: SaveRequest): Promise<string> {
  const data = await rpc('create_action_v2', { p_incident_id: r.incident, p_request_key: r.requestKey,
    p_context_hash: r.contextHash, p_proposal: r.proposal, p_historical_action_id: r.historicalAction }, true)
  if (typeof data !== 'string') throw new ActionError('The save response was incomplete. Retry the same draft.', true)
  return data
}
export async function changeAction(r: ChangeRequest): Promise<void> {
  await rpc('change_action_v2', { p_action_id: r.actionId, p_operation: r.operation, p_expected_revision: r.revision,
    p_request_key: r.requestKey, p_note: r.note, p_details: r.details }, true)
}
export async function historicalActions(): Promise<HistoryData> {
  const data = requireObject(await rpc('historical_actions_v2'))
  if (!Array.isArray(data.documents) || !Array.isArray(data.actions)) throw new ActionError('Historical sources could not be validated.')
  return data as unknown as HistoryData
}
export function evidenceUrl(ref: EvidenceRef): string | null {
  if (ref.table === 'incident_records' && ref.record_id) return `/data/incidents?${new URLSearchParams({ record: ref.record_id, field:ref.field ?? 'Downtime (hrs)' })}#incident-source-record`
  if (ref.table === 'equipment_observations' && ref.record_id && ref.source_id) return `/data/equipment?${new URLSearchParams({ source: ref.source_id, observation: ref.record_id, field:ref.field ?? 'Health Status' })}#equipment-source-observation`
  if ((ref.table === 'rca_documents' || ref.table === 'rca_actions') && ref.document_id) return `/data/rca?${new URLSearchParams({ document: ref.document_id, ...(ref.slide ? { slide: String(ref.slide) } : {}) })}#${ref.slide ? `rca-slide-${ref.slide}` : 'rca-source-document'}`
  return null
}
export const statusLabels: Record<ActionStatus, string> = { draft: 'Needs review', assigned: 'Assigned', in_progress: 'In progress', completed: 'Legacy completion · review needed', completion_review: 'Completion review', verified: 'Completion verified in demo', canceled: 'Canceled', rejected: 'Rejected' }
export function initialProposal(c: ActionContext): Proposal {
  const i = c.incident
  return {
    title: `Review ${i.asset} evidence and document the follow-up`,
    action_text: c.historical_action ? `Review the applicability of this historically documented action for ${i.asset}: ${c.historical_action.action_as_written}`.slice(0,1200)
      : `Review the supplied incident and ${c.equipment ? 'earlier Equipment observation' : 'available source classifications'} for ${i.asset}. Document the measurement context, remaining questions and the follow-up an engineer should consider.`,
    rationale: `${i.asset} has a recorded incident on ${i.date} with ${i.downtime_hours} hours of downtime.` + (c.equipment ? ` The earlier weekly observation on ${c.equipment.date} is labeled ${c.equipment.status}. This is a reason to review the evidence, not proof of a cause.` : ' No earlier detailed Equipment observation has been established. Further source review is needed before selecting corrective work.'),
    success_criteria: 'A review note identifies the exact source records, explains what is and is not established, and records the proposed next step with its justification. Any field inspection requires a separate engineering decision.',
    source_kind: c.historical_action ? 'reviewed_rca_action' : 'inspection_proposal', action_type: 'preventive',
  }
}
