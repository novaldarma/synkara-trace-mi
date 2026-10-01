import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ActionError, changeAction, getAction, listActionEvents, statusLabels, type ActionEvent, type ChangeRequest, type FollowupAction, type Proposal } from '../../../services/actions'
import { EvidenceContext, EvidenceLinks } from './ActionEvidence'
import { ProposalFields } from './DraftComposer'
import { clearSession, errorText, readSession, saveSession, time } from './ui'

const eventNames: Record<string,string> = { created:'Proposal saved', accepted:'Accepted and assigned', rejected:'Proposal rejected', started:'Follow-up started', completed:'Legacy completion reported', completion_submitted:'Result submitted for review', verified:'Demo completion verified', returned_to_work:'Returned for more work', canceled:'Action canceled', revised:'Proposal updated', rescheduled:'Deadline changed', commented:'Note added', reassigned:'Owner changed' }
function formValues(e: FormEvent<HTMLFormElement>): FormData { e.preventDefault(); return new FormData(e.currentTarget) }
function value(data: FormData, key: string): string { return String(data.get(key) ?? '').trim() }
function Note({ label = 'Review note', min = 12, name = 'note' }: { label?: string; min?: number; name?: string }) { return <label>{label}<textarea name={name} required minLength={min} maxLength={1800} rows={3} /></label> }

export default function ActionDetail({ id, account, onChanged }: { id: string; account: string; onChanged: (operation?:string) => void }) {
  const [action,setAction]=useState<FollowupAction|null>(null)
  const [events,setEvents]=useState<ActionEvent[]>([])
  const [error,setError]=useState('')
  const [historyError,setHistoryError]=useState('')
  const [historyLoading,setHistoryLoading]=useState(true)
  const [notice,setNotice]=useState('')
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [revision,setRevision]=useState(0)
  const [editing,setEditing]=useState(false)
  const [edit,setEdit]=useState<Proposal|null>(null)
  const key=`trace-mi:v5:mutation:${account}:${id}`
  const [pending,setPending]=useState<ChangeRequest|null>(()=>readSession<ChangeRequest>(key))
  const guard=useRef(false)
  const heading=useRef<HTMLHeadingElement>(null)
  useEffect(()=>{heading.current?.focus()},[])
  useEffect(()=>{
    let alive=true
    setLoading(true); setError(''); setHistoryError(''); setEvents([]); setHistoryLoading(true)
    getAction(id).then(a=>{if(alive){setAction(a);setLoading(false)}}).catch(e=>{if(alive){setAction(null);setError(errorText(e));setLoading(false)}})
    listActionEvents(id).then(v=>{if(alive){setEvents(v);setHistoryLoading(false)}}).catch(e=>{if(alive){setEvents([]);setHistoryError(errorText(e));setHistoryLoading(false)}})
    return ()=>{alive=false}
  },[id,revision])
  async function mutate(operation: string,note='',details:Record<string,unknown>={},retry?:ChangeRequest) {
    if(!action || guard.current || (pending && !retry))return
    const req=retry ?? { actionId:id,revision:action.revision,requestKey:crypto.randomUUID(),operation,note,details }
    guard.current=true;setBusy(true);setError('');setNotice('');setPending(req);saveSession(key,req)
    try { await changeAction(req);clearSession(key);setPending(null);setEditing(false);setNotice('Update saved. Refreshing the record and its history.');setRevision(n=>n+1);onChanged(req.operation) }
    catch(e){setError(errorText(e));if(!(e instanceof ActionError && e.uncertain)){clearSession(key);setPending(null)}}
    finally{guard.current=false;setBusy(false)}
  }
  function submit(operation:string,e:FormEvent<HTMLFormElement>){
    const d=formValues(e); const details:Record<string,unknown>={}
    const due=value(d,'due')
    if(due){const parsed=new Date(due);if(!Number.isFinite(parsed.getTime())||parsed.getTime()<=Date.now()){setError('Choose a future due date and time.');return}details.due_at=parsed.toISOString()}
    if(operation==='accept'){details.priority=value(d,'priority');details.priority_reason=value(d,'priority_reason');details.responsible_function=value(d,'function')}
    if(operation==='submit_completion')details.reference=value(d,'reference')
    void mutate(operation,value(d,'note'),details)
  }
  const owner=action?.owner_user_id===account
  const author=action?.created_by===account
  return <section className="panel action-detail" aria-labelledby="action-detail-heading" aria-busy={loading||busy}>
    <div className="action-panel-heading"><h2 id="action-detail-heading" tabIndex={-1} ref={heading}>Action review</h2><button className="secondary-action" disabled={busy} onClick={()=>{setRevision(n=>n+1);onChanged()}}>Refresh</button></div>
    {error&&<p className="action-error" role="alert">{error}</p>}{notice&&<p className="action-success" role="status">{notice}</p>}
    {loading&&<p role="status">Loading saved action…</p>}
    {pending&&!busy&&<div className="action-retry"><p>An earlier update is unconfirmed. Retry the same update safely before making another change.</p><button className="primary-link" onClick={()=>void mutate(pending.operation,pending.note,pending.details,pending)}>Retry saved request</button></div>}
    {action&&!loading&&<>
      <div className="action-status-row"><span className={`action-badge status-${action.status}`}>{statusLabels[action.status]}</span>{action.overdue&&<span className="action-badge overdue">Overdue</span>}</div>
      <h3 className="action-detail-title">{action.title || action.action_text}</h3>
      <p><strong>{action.asset} · {action.plant}</strong> · incident {action.incident_date}</p>
      <Link className="text-link" to={`/dashboard/investigation/${encodeURIComponent(action.incident_record_id)}`}>Open this investigation ↗</Link>
      <dl className="action-facts"><div><dt>Demo account</dt><dd>{action.owner_user_id ? owner?'Shared demo account':'Assigned member':'Not assigned'}</dd></div><div><dt>Responsible function</dt><dd>{action.responsible_function}</dd></div><div><dt>Deadline · browser local time</dt><dd>{time(action.due_at)}</dd></div><div><dt>Review priority</dt><dd>{action.review_priority==='unassessed'?'Not assessed':action.review_priority==='expedited'?'Expedited review':'Standard review'}</dd></div></dl>
      {action.priority_reason&&<p><strong>Priority reason:</strong> {action.priority_reason}</p>}
      {action.decision_reason&&<p><strong>Decision reason:</strong> {action.decision_reason}</p>}
      <div className="action-reason"><h4>Proposed step</h4><p>{action.action_text}</p><h4>Why this is relevant</h4><p>{action.rationale || 'This earlier draft has no saved rationale. Complete the proposal before review.'}</p><h4>Expected result</h4><p>{action.success_criteria || 'Not recorded in this legacy action.'}</p></div>
      <p className="source-note">Origin: {action.source_kind==='manual_proposal'?'Manual proposal':action.source_kind==='reviewed_rca_action'?'Reviewed historical RCA action':'Evidence-assisted review proposal'} · Intended category: {action.action_type}. The saved action records human-reviewed wording and stable source context. Model-run provenance is not stored as action evidence.</p>
      <details className="action-source-detail"><summary>Inspect supporting evidence</summary>{action.evidence_snapshot ? <EvidenceContext context={action.evidence_snapshot}/> : <><p>Legacy action: only its original source references were saved.</p><EvidenceLinks refs={action.evidence_refs}/></>}</details>
      {action.completion_note&&<div className="action-result"><h4>Reported demo result</h4><p>{action.completion_note}</p><p><strong>Result reference:</strong> {action.completion_reference}</p></div>}
      {action.verification_note&&<p><strong>Completion review:</strong> {action.verification_note}{action.verified_at&&` · ${time(action.verified_at)}`}</p>}
      {action.status==='verified'&&<p className="action-success">Completion was reviewed within this demo. This is not independent sign-off, proof of physical maintenance, or evidence of avoided downtime.</p>}
      {action.workflow_version===1&&<p className="action-warning">Legacy action retained with its original history. {author&&['draft','assigned','in_progress','completed'].includes(action.status)?'Complete its rationale and expected result before continuing.':'Its original completion was not verified by the v5 workflow.'}</p>}
      <fieldset disabled={busy||!!pending} className="action-controls">
        {author&&(action.status==='draft'||(action.workflow_version===1&&['assigned','in_progress','completed'].includes(action.status)))&&<>
          <button className="secondary-action" onClick={()=>{setEditing(!editing);setEdit({title:action.title||`Review ${action.asset} follow-up`,action_text:action.action_text,rationale:action.rationale||'',success_criteria:action.success_criteria||'',source_kind:action.source_kind,action_type:action.action_type})}}>{editing?'Close editor':'Edit proposal'}</button>
          {editing&&edit&&<form className="action-form" onSubmit={e=>{e.preventDefault();void mutate('revise','Proposal revised before review.',{...edit})}}><ProposalFields value={edit} onChange={setEdit} fixedOrigin/><button className="primary-link">Save proposal changes</button></form>}
        </>}
        {!editing&&author&&action.status==='draft'&&action.workflow_version===2&&<form className="action-form" onSubmit={e=>submit('accept',e)}>
          <h3>Review and assign</h3><p className="source-note">You record the reviewer decision. The same shared demo account becomes the accountable account for this prototype step; this does not represent independent approval.</p>
          <div className="action-form-columns"><label>Responsible function<select name="function" required defaultValue=""><option value="" disabled>Select a function</option><option>Reliability</option><option>Maintenance</option><option>Operations</option></select></label>
          <label>Review priority<select name="priority" required defaultValue=""><option value="" disabled>Select a review priority</option><option value="standard">Standard review</option><option value="expedited">Expedited review</option></select></label></div>
          <p className="source-note">Review priority is your decision, not a calculated safety risk score.</p>
          <label>Why this priority?<textarea name="priority_reason" required minLength={12} maxLength={800} rows={2}/></label>
          <label>Due date and time · browser local time<input name="due" type="datetime-local" required/></label>
          <Note label="Why do you accept this proposal?"/><button className="primary-link">Accept and assign to shared demo account</button>
        </form>}
        {!editing&&author&&action.status==='draft'&&<details><summary>Reject this proposal</summary><form className="action-form" onSubmit={e=>submit('reject',e)}><Note label="Reason for rejection"/><button className="secondary-action">Reject with reason</button></form></details>}
        {owner&&action.status==='assigned'&&action.workflow_version===2&&<div className="action-next-step"><h3>Begin the follow-up</h3><p>Review the proposed step and evidence before starting this demo follow-up.</p><button className="primary-link" onClick={()=>void mutate('start')}>Start demo follow-up</button></div>}
        {owner&&['in_progress','completed'].includes(action.status)&&action.workflow_version===2&&<form className="action-form" onSubmit={e=>submit('submit_completion',e)}><h3>Report the demo result</h3><p className="source-note">Describe a documented desk review or clearly identify simulated work. Do not claim a physical repair occurred.</p><Note label="Result against the expected outcome" min={20}/><label>Checkable result reference<textarea name="reference" required minLength={8} maxLength={800} rows={2} placeholder="Document or review-note title, section and date; label simulated evidence explicitly."/></label><button className="primary-link">Submit result for review</button></form>}
        {author&&action.status==='completion_review'&&<div className="action-next-step"><h3>Check the reported result</h3><p>Compare the result reference with the expected outcome above. This demo records the shared account's review.</p><form className="action-form" onSubmit={e=>submit('verify',e)}><Note label="How does the result meet the expected outcome?"/><label className="action-check"><input type="checkbox" required/>I checked the result reference and expected outcome within this demo.</label><button className="primary-link">Verify demo completion</button></form><details><summary>Return for more work</summary><form className="action-form" onSubmit={e=>submit('return_to_work',e)}><Note label="What still needs to be done?"/><button className="secondary-action">Return to in progress</button></form></details></div>}
        {author&&['assigned','in_progress'].includes(action.status)&&<details><summary>Change the deadline</summary><form className="action-form" onSubmit={e=>submit('reschedule',e)}><label>New deadline · browser local time<input name="due" required type="datetime-local"/></label><Note label="Why does the deadline need to change?"/><button className="secondary-action">Save new deadline</button></form></details>}
        {owner&&['assigned','in_progress'].includes(action.status)&&<details><summary>Cancel this action</summary><form className="action-form" onSubmit={e=>submit('cancel',e)}><Note label="Why is this action canceled?"/><button className="secondary-action">Cancel with reason</button></form></details>}
        <details><summary>Add a progress or review note</summary><form className="action-form" onSubmit={e=>submit('comment',e)}><Note label="Note for the action history"/><button className="secondary-action">Save note</button></form></details>
      </fieldset>
      {busy&&<p role="status">Saving change…</p>}
      <details className="action-history"><summary>Decision and progress history · {historyLoading?'Loading…':`${events.length} events`}</summary>{historyLoading?<p role="status">Loading action history…</p>:historyError?<p className="action-error" role="alert">{historyError}</p>:<ol>{events.map(e=><li key={e.event_id}><strong>{eventNames[e.event_kind]??e.event_kind}</strong><time>{time(e.happened_at)}</time><p>{e.event_note||'Stage change recorded.'}</p><small>{e.actor_user_id===account?'Shared demo account':'Assigned member'}{e.old_status&&` · ${statusLabels[e.old_status as keyof typeof statusLabels]??e.old_status} → ${statusLabels[e.new_status as keyof typeof statusLabels]??e.new_status}`}</small>{e.event_kind==='rescheduled'&&<p className="source-note">Previous deadline: {time(typeof e.details.previous_due_at==='string'?e.details.previous_due_at:null)}</p>}{e.event_kind==='revised'&&<details><summary>Previous proposal</summary><pre>{JSON.stringify(e.details.previous_proposal,null,2)}</pre></details>}</li>)}</ol>}</details>
      <details><summary>Technical record</summary><p className="source-note">Action ID: {action.action_id}<br/>Revision: {action.revision} · Created {time(action.created_at)} · Updated {time(action.updated_at)}<br/>Evidence rule: {action.evidence_snapshot?.context_version??'legacy'}</p></details>
    </>}
  </section>
}
