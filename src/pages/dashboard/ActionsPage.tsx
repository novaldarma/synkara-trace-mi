import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { currentMemberId, historicalActions, listActions, statusLabels, type ActionList, type HistoryData } from '../../services/actions'
import ActionDetail from './actions/ActionDetail'
import DraftComposer from './actions/DraftComposer'
import { errorText, time } from './actions/ui'
import './actions/actions.css'

const views = [['all','All actions'],['needs_review','Needs review'],['active','Active'],['overdue','Overdue'],['completion_review','Completion review'],['verified','Verified in demo'],['ended','Rejected / canceled']] as const
const transitionViews: Record<string,string> = { accept:'active', start:'active', submit_completion:'completion_review', verify:'verified', return_to_work:'active', reject:'ended', cancel:'ended' }
function Workspace({account}:{account:string}) {
  const [params,setParams]=useSearchParams()
  const incident=params.get('incidentId')||null
  const selected=params.get('action')||''
  const historical=params.get('historical')||null
  const history=params.get('tab')==='history'
  const tracePrefill=params.get('prefill')==='trace'
  const composing=!!incident&&params.get('compose')==='1'&&!history
  const view=views.some(v=>v[0]===params.get('view'))?params.get('view')!:'all'
  const query=params.get('q')||''
  const page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page')||'1',10)||1))
  const [search,setSearch]=useState(query)
  const [data,setData]=useState<ActionList|null>(null)
  const [sources,setSources]=useState<HistoryData|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const [refresh,setRefresh]=useState(0)
  const changed=useCallback((operation?:string)=>{
    const nextView=operation&&transitionViews[operation]
    if(nextView&&view!=='all'&&view!==nextView){
      setParams(previous=>{const next=new URLSearchParams(previous);next.set('view',nextView);next.delete('page');return next})
    }
    setRefresh(n=>n+1)
  },[setParams,view])
  useEffect(()=>setSearch(query),[query])
  function update(changes:Record<string,string|null>){
    setParams(p=>{const next=new URLSearchParams(p);Object.entries(changes).forEach(([k,v])=>v===null?next.delete(k):next.set(k,v));return next})
  }
  useEffect(()=>{
    let alive=true
    setLoading(true);setError('')
    if(history){historicalActions().then(d=>{if(alive){setSources(d);setLoading(false)}}).catch(e=>{if(alive){setSources(null);setError(errorText(e));setLoading(false)}})}
    else {listActions(incident,view,query,page).then(d=>{if(alive){setData(d);setLoading(false)}}).catch(e=>{if(alive){setData(null);setError(errorText(e));setLoading(false)}})}
    return()=>{alive=false}
  },[incident,view,query,page,history,refresh])
  function searchSubmit(e:FormEvent){e.preventDefault();update({q:search.trim()||null,page:null})}
  return <>
    <div className="action-intro"><p>Turn a recorded case into a justified follow-up, review the decision, and check the reported result.</p><p className="source-note">One shared judge account performs the demo roles. History identifies the account; it does not identify individual judges or establish independent approval.</p></div>
    <nav className="action-tabs" aria-label="Action record type">
      <button aria-pressed={!history} onClick={()=>update({tab:null})}>Follow-up workspace</button>
      <button aria-pressed={history} onClick={()=>update({tab:'history'})}>Historical RCA records</button>
    </nav>
    {history?<>
      <section className="panel"><div className="action-panel-heading"><div><p className="scope-label">HISTORICAL SOURCE SNAPSHOTS</p><h2>Actions in the supplied RCA</h2></div><button className="secondary-action" disabled={loading} onClick={()=>changed()}>Refresh source records</button></div><p>Inspect the original document and its review status. A status written in a historical slide is not a current task update.</p>
        {loading&&<p role="status">Loading historical source records…</p>}{error&&<p role="alert" className="action-error">{error}</p>}
        {!loading&&sources&&<><p>{sources.documents.length} linked RCA documents · {sources.actions.length} reviewed action rows available in this workspace.</p><div className="action-source-grid">{sources.documents.map(d=><article className="action-source-card" key={d.document_id}><strong>{d.asset} · {d.plant}</strong><p>{d.review_status==='reviewed'?'Document reviewed':'Visual review pending'}</p><Link className="text-link" to={`/data/rca?document=${encodeURIComponent(d.document_id)}#rca-source-document`} target="_blank" rel="noopener noreferrer">Inspect RCA record and PDF rendition ↗<span className="sr-only"> (opens a new tab)</span></Link></article>)}</div>
        {sources.actions.length===0?<p className="action-warning">No reviewed action rows have been imported. This does not mean the original RCA contains no actions. Inspect the source decks; their extracted text must pass visual review before it can populate this list.</p>:<div className="action-historical-list">{sources.actions.map(a=><article key={a.historical_action_id}><p className="scope-label">{a.asset} · {a.plant} · SLIDE {a.slide}</p><h3>{a.action_as_written}</h3><p>Owner as written: {a.owner_as_written||'Not recorded'} · Planned date as written: {a.plan_date_as_written||'Not recorded'} · Source status: {a.source_status_as_written||'Not recorded'}</p><div className="action-toolbar"><Link className="text-link" target="_blank" rel="noopener noreferrer" to={`/data/rca?document=${encodeURIComponent(a.document_id)}&slide=${a.slide}#rca-slide-${a.slide}`}>Inspect the source slide ↗<span className="sr-only"> (opens a new tab)</span></Link><button className="secondary-action" onClick={()=>update({tab:null,incidentId:a.incident_id,historical:a.historical_action_id,compose:'1',action:null,page:null,prefill:null})}>Prepare a separate follow-up</button></div></article>)}</div>}</>}
      </section>
    </>:<>
      <section className="action-overview" aria-label="Follow-up stages">
        <div className="action-toolbar action-scope"><div><strong>{incident?'Actions for the selected incident':'Actions accessible to this account'}</strong>{incident&&<p><Link to={`/dashboard/investigation/${encodeURIComponent(incident)}`}>Open selected investigation</Link> · <button className="text-link" onClick={()=>update({incidentId:null,compose:null,historical:null,page:null})}>Show all incidents</button></p>}</div><div className="action-toolbar"><button className="secondary-action" disabled={loading} onClick={()=>changed()}>Refresh saved actions</button>{incident?<button className="primary-link" onClick={()=>update({compose:'1',historical:null,prefill:null})}>Propose a follow-up</button>:<Link className="primary-link" to="/dashboard/problem-tank">Choose an incident to begin ↗</Link>}</div></div>
        <div className="action-summary">{([['needs_review','Awaiting decision','Saved proposals'],['active','Active follow-ups','Assigned or in progress'],['overdue','Past deadline','Subset of active follow-ups'],['completion_review','Results to review','Including legacy completions']] as const).map(([k,label,note])=><button key={k} aria-pressed={view===k} onClick={()=>update({view:k,page:null})}><span>{label}</span><strong>{loading?'…':data?data.summary[k]:'—'}</strong><small>{note}</small></button>)}</div>
        <p className="source-note">Counts follow the incident scope and search. Overdue is included in Active. Review priority is a human decision, not an equipment safety ranking.</p>
      </section>
      {composing&&<DraftComposer key={`${account}:${incident}:${historical}:${tracePrefill?'trace':'standard'}`} account={account} incident={incident!} historical={historical} tracePrefill={tracePrefill} onClose={()=>update({compose:null,historical:null,prefill:null})} onSaved={id=>{update({action:id,compose:null,historical:null,prefill:null,view:'needs_review',q:null,page:null});changed()}}/>}
      <section className="panel action-filters" aria-label="Find follow-ups"><form onSubmit={searchSubmit}><label>Search title, asset or plant<input type="search" value={search} maxLength={120} onChange={e=>setSearch(e.target.value)} placeholder="For example: KO-3201"/></label><button className="secondary-action">Search</button>{query&&<button type="button" className="text-link" onClick={()=>update({q:null,page:null})}>Clear search</button>}</form><label>Stage<select value={view} onChange={e=>update({view:e.target.value,page:null})}>{views.map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></label></section>
      <div className={`action-workspace-grid${selected?' has-selection':''}`}>
        <section className="panel action-list-panel" aria-labelledby="saved-actions-heading" aria-busy={loading}>
          <h2 id="saved-actions-heading">Saved follow-ups</h2><p className="source-note">Open work first, then overdue, review priority and nearest deadline. Final stages follow open work.</p>
          {loading&&<p role="status">Loading saved follow-ups…</p>}{error&&<p role="alert" className="action-error">{error}</p>}
          {!loading&&data&&<><p role="status">{data.count} matching actions · page {page} of {Math.max(1,Math.ceil(data.count/data.page_size))}</p>
          {data.actions.length===0?<div className="action-empty"><h3>{data.count===0?'No actions in this selection':'This page has no actions'}</h3><p>{data.count===0?(selected?'The selected action remains open on this page. Its current stage may be different from the list filter. Change Stage above to see matching records.':'Choose an incident, inspect its evidence, and save a proposal for review. You can also change the stage or search above.'):'Return to the first page to view matching actions.'}</p>{data.count>0?<button className="secondary-action" onClick={()=>update({page:null})}>Go to first page</button>:!selected&&<Link className="text-link" to="/dashboard/problem-tank">Open Investigate ↗</Link>}</div>:<ul className="action-list">{data.actions.map(a=><li key={a.action_id}><button aria-pressed={selected===a.action_id} onClick={()=>update({action:a.action_id,compose:null,prefill:null})}><span className="action-list-asset">{a.asset} · {a.plant}</span><strong>{a.title||a.action_text}</strong><span className={`action-badge status-${a.status}`}>{statusLabels[a.status]}</span>{a.overdue&&<span className="action-badge overdue">Overdue</span>}<small>{a.review_priority==='expedited'?'Expedited review · ':''}{a.due_at?`Due ${time(a.due_at)}`:'Decision not yet assigned'}</small></button></li>)}</ul>}
          {data.count>data.page_size&&<nav className="action-pagination" aria-label="Action pages"><button className="secondary-action" disabled={page===1} onClick={()=>update({page:String(page-1)})}>← Previous</button><button className="secondary-action" disabled={page*data.page_size>=data.count} onClick={()=>update({page:String(page+1)})}>Next →</button></nav>}
          <p className="source-note">Loaded {time(data.server_time)}. Refresh to check new changes or deadlines.</p></>}
        </section>
        {selected?<div><p className="source-note">Selected action stays open when you filter the list or reload this URL.</p><ActionDetail key={`${account}:${selected}`} id={selected} account={account} onChanged={changed}/></div>:<section className="panel action-empty"><p className="scope-label">REVIEW → ASSIGN → WORK → CHECK RESULT</p><h2>Open a follow-up to continue</h2><p>Select a saved action to see why it was proposed, its supporting records, the next available step and its history.</p><p className="source-note">Demo completion records a review of the reported result. It does not establish a physical repair, avoided downtime or realized savings.</p></section>}
      </div>
    </>}
  </>
}
export default function ActionsPage(){
  const [account,setAccount]=useState('');const [error,setError]=useState('');const [retry,setRetry]=useState(0)
  useEffect(()=>{let alive=true;setError('');currentMemberId().then(id=>{if(alive)setAccount(id)}).catch(e=>{if(alive)setError(errorText(e))});return()=>{alive=false}},[retry])
  return <div className="app-shell actions-page"><a className="skip-link" href="#actions-content">Skip to actions</a><header className="app-topbar"><Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link><nav aria-label="Dashboard navigation"><Link className="secondary-link" to="/dashboard/problem-tank">← Investigate</Link></nav></header><main id="actions-content" className="dashboard-content"><div className="dashboard-title"><p className="scope-label">CASE 2 · REVIEWED FOLLOW-UPS</p><h1>Follow-up actions</h1></div>{account?<Workspace key={account} account={account}/>:error?<div className="panel"><p role="alert">{error}</p><button className="secondary-action" onClick={()=>setRetry(n=>n+1)}>Retry session</button></div>:<p role="status">Checking your account…</p>}</main></div>
}
