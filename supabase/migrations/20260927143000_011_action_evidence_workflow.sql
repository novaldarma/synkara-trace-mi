-- TRACE-MI v5: source-bound, replay-safe retrospective demo follow-ups.
-- Apply after 010. Additive: keep all existing actions and audit events.
begin;

alter table public.followup_actions
  add column title text,
  add column rationale text,
  add column success_criteria text,
  add column evidence_snapshot jsonb,
  add column workflow_version integer not null default 1,
  add column revision integer not null default 0,
  add column request_key uuid,
  add column draft_request jsonb,
  add column review_priority text not null default 'unassessed'
    check (review_priority in ('unassessed','standard','expedited')),
  add column priority_reason text,
  add column responsible_function text not null default 'Unassigned'
    check (responsible_function in ('Unassigned','Reliability','Maintenance','Operations')),
  add column completion_note text,
  add column completion_reference text,
  add column verification_note text,
  add column verified_by uuid references auth.users(id),
  add column verified_at timestamptz,
  add constraint action_request_unique unique(created_by, request_key),
  add constraint action_v2_fields check (workflow_version = 1 or (
    workflow_version = 2 and title is not null and length(btrim(title)) between 8 and 140
    and rationale is not null and length(btrim(rationale)) between 20 and 1800
    and success_criteria is not null and length(btrim(success_criteria)) between 20 and 1200
    and length(btrim(action_text)) between 20 and 1200
    and evidence_snapshot is not null and jsonb_typeof(evidence_snapshot) = 'object'
  ));
alter table public.followup_actions drop constraint followup_actions_status_check;
alter table public.followup_actions add constraint followup_actions_status_check
  check(status in ('draft','assigned','in_progress','completed','completion_review','verified','canceled','rejected'));
alter table public.followup_actions drop constraint followup_actions_decision_status_check;
alter table public.followup_actions add constraint followup_actions_decision_status_check check (
  (decision='pending' and status='draft' and owner_user_id is null and due_at is null)
  or (decision='accepted' and status in ('assigned','in_progress','completed','completion_review','verified','canceled')
    and owner_user_id is not null and due_at is not null)
  or (decision='rejected' and status='rejected' and owner_user_id is null and due_at is null
    and decision_reason is not null and btrim(decision_reason) <> '')
);
alter table public.followup_actions add constraint action_completion_evidence check (
  status not in ('completion_review','verified') or (
    completion_note is not null and length(btrim(completion_note)) between 20 and 1800
    and completion_reference is not null and length(btrim(completion_reference)) between 8 and 800
  )
), add constraint action_verification_evidence check (
  (status='verified' and verified_by is not null and verified_at is not null
    and verification_note is not null and length(btrim(verification_note)) between 12 and 1800)
  or (status<>'verified' and verified_by is null and verified_at is null)
);
alter table public.action_events add column request_key uuid,
  add column details jsonb not null default '{}'::jsonb,
  add constraint action_event_request_unique unique(action_id,request_key);
alter table public.action_events drop constraint action_events_event_kind_check;
alter table public.action_events add constraint action_events_event_kind_check check (
  event_kind in ('created','accepted','rejected','assigned','started','completed','canceled','reassigned','commented',
    'revised','completion_submitted','verified','returned_to_work','rescheduled')
);

-- No browser-supplied source locator or old RPC may bypass v5 validation.
revoke insert on public.followup_actions from authenticated;
revoke insert (incident_record_id, analysis_id, source_rca_action_id, source_kind,
  action_text, action_type, evidence_refs, created_by) on public.followup_actions from authenticated;
revoke execute on function public.decide_followup_action(uuid,text,uuid,timestamptz,text) from authenticated;
revoke execute on function public.advance_followup_action(uuid,text,text) from authenticated;
revoke execute on function public.reassign_followup_action(uuid,uuid,text) from authenticated;
drop policy action_member_read on public.followup_actions;
create policy action_member_read on public.followup_actions for select to authenticated using (
  (select private.is_demo_member()) and ((select auth.uid())=created_by or (select auth.uid())=owner_user_id)
);
drop policy action_event_member_read on public.action_events;
create policy action_event_member_read on public.action_events for select to authenticated using (
  (select private.is_demo_member()) and exists (select 1 from public.followup_actions a where a.action_id=action_events.action_id)
);

create function private.action_context_v2(p_incident_id text, p_historical_action_id text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.incident_records%rowtype; e public.equipment_observations%rowtype;
  d public.rca_documents%rowtype; h record; refs jsonb; result jsonb; hist jsonb := null;
begin
  select * into i from public.incident_records where record_id=p_incident_id and dataset_id='caliber2026_case2';
  if not found then raise exception 'The source incident is unavailable.'; end if;
  select * into e from public.equipment_observations where asset_id=i.asset_id and plant_code=i.plant_code
    and observed_date<i.occurred_date order by observed_date desc,record_id limit 1;
  select * into d from public.rca_documents where linked_incident_record_id=i.record_id
    and link_status='verified_by_tag_plant_AR_and_occurrence_date';
  refs := jsonb_build_array(jsonb_build_object('table','incident_records','record_id',i.record_id,
    'source_id',i.source_id,'source_sha256',i.source_sha256,'source_row',i.source_row,'label',
    'Incident Database · row '||i.source_row,'scope','retrospective_source'));
  if e.record_id is not null then
    refs := refs || jsonb_build_array(jsonb_build_object('table','equipment_observations','record_id',e.record_id,
      'source_id',e.source_id,'source_sha256',e.source_sha256,'source_row',e.source_row,
      'label','Condition History · '||e.observed_date||' · row '||e.source_row,'scope','strictly_before_incident_date'));
  end if;
  if d.document_id is not null then
    refs := refs || jsonb_build_array(jsonb_build_object('table','rca_documents','document_id',d.document_id,
      'source_id',d.source_id,'source_sha256',d.source_sha256,'label','RCA document · '||d.visual_review_status,
      'scope','post_incident_context_only','visual_review_status',d.visual_review_status));
  end if;
  if p_historical_action_id is not null then
    select a.*,s.source_slide_number,s.source_id,s.source_sha256 into h from public.rca_actions a
      join public.rca_sections s on s.slide_id=a.slide_id and s.document_id=a.document_id
      join public.rca_documents rd on rd.document_id=a.document_id
      where a.historical_action_id=p_historical_action_id and rd.linked_incident_record_id=i.record_id
        and rd.link_status='verified_by_tag_plant_AR_and_occurrence_date' and rd.visual_review_status='reviewed'
        and a.manual_review_status='reviewed' and s.visual_review_status='reviewed' and s.unread_visual_count=0;
    if not found then raise exception 'This RCA action has not passed source and slide review.'; end if;
    hist := jsonb_build_object('historical_action_id',h.historical_action_id,'action_as_written',h.action_as_written,
      'owner_as_written',h.owner_as_written,'plan_date_as_written',h.plan_date_as_written,
      'source_status_as_written',h.source_status_as_written,'document_id',h.document_id,'slide',h.source_slide_number);
    refs := refs || jsonb_build_array(jsonb_build_object('table','rca_actions','historical_action_id',h.historical_action_id,
      'document_id',h.document_id,'slide',h.source_slide_number,'source_id',h.source_id,'source_sha256',h.source_sha256,
      'label','Reviewed historical action · slide '||h.source_slide_number,'scope','historical_snapshot'));
  end if;
  result := jsonb_build_object('context_version','actions-v2-retrospective',
    'incident',jsonb_build_object('record_id',i.record_id,'source_id',i.source_id,'source_row',i.source_row,
      'asset',i.asset_tag_as_provided,'plant',i.plant_code,'date',i.occurred_date,
      'downtime_hours',i.downtime_hours,'actual_loss_kusd',i.actual_loss_kusd,'potential_loss_kusd',i.potential_loss_kusd),
    'equipment',case when e.record_id is null then null else jsonb_build_object('record_id',e.record_id,
      'date',e.observed_date,'status',e.health_status_as_provided,'measurements',e.measurements) end,
    'rca',case when d.document_id is null then null else jsonb_build_object('document_id',d.document_id,
      'file',d.source_file,'review_status',d.visual_review_status) end,
    'historical_action',hist,'evidence_refs',refs,
    'limitations','Retrospective review. Weekly Equipment and hourly Production are different sources and units. A historical status does not prove cause or present equipment condition. RCA document identity does not certify slide interpretation. Demo work does not change company records or prove avoided losses.');
  return result || jsonb_build_object('context_hash',md5(result::text));
end $$;
revoke all on function private.action_context_v2(text,text) from public,anon,authenticated;

create function public.get_action_context_v2(p_incident_id text,p_historical_action_id text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_demo_member() then raise exception 'An active account is required.'; end if;
  return private.action_context_v2(p_incident_id,p_historical_action_id);
end $$;

create function private.validate_action_proposal_v2(p jsonb) returns void language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p) is distinct from 'object'
    or coalesce(length(btrim(p->>'title')),0) not between 8 and 140
    or coalesce(length(btrim(p->>'action_text')),0) not between 20 and 1200
    or coalesce(length(btrim(p->>'rationale')),0) not between 20 and 1800
    or coalesce(length(btrim(p->>'success_criteria')),0) not between 20 and 1200
    or coalesce(p->>'action_type','') not in ('corrective','preventive')
    or coalesce(p->>'source_kind','') not in ('inspection_proposal','manual_proposal','reviewed_rca_action') then
    raise exception 'Complete the title, proposal, rationale and expected result within the stated limits.';
  end if;
end $$;
revoke all on function private.validate_action_proposal_v2(jsonb) from public,anon,authenticated;

create function public.create_action_v2(p_incident_id text,p_request_key uuid,p_context_hash text,p_proposal jsonb,
  p_historical_action_id text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); ctx jsonb; req jsonb; old public.followup_actions%rowtype; id uuid;
begin
  if actor is null or not private.is_demo_member() then raise exception 'An active account is required.'; end if;
  if p_request_key is null then raise exception 'A save request ID is required.'; end if;
  perform private.validate_action_proposal_v2(p_proposal);
  req := jsonb_build_object('incident',p_incident_id,'context_hash',p_context_hash,'proposal',p_proposal,'historical_action',p_historical_action_id);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_key::text,0));
  select * into old from public.followup_actions where created_by=actor and request_key=p_request_key;
  if found then
    if old.draft_request is distinct from req then raise exception 'This save ID belongs to different draft contents. Refresh before saving.'; end if;
    return old.action_id;
  end if;
  ctx := private.action_context_v2(p_incident_id,p_historical_action_id);
  if p_context_hash is distinct from ctx->>'context_hash' then raise exception 'Source context changed. Reload the evidence before saving.'; end if;
  if ((p_proposal->>'source_kind')='reviewed_rca_action') <> (p_historical_action_id is not null) then
    raise exception 'Choose a reviewed RCA source for this origin.';
  end if;
  insert into public.followup_actions(incident_record_id,source_rca_action_id,source_kind,title,action_text,action_type,
    rationale,success_criteria,evidence_refs,evidence_snapshot,created_by,workflow_version,request_key,draft_request)
  values(p_incident_id,p_historical_action_id,p_proposal->>'source_kind',btrim(p_proposal->>'title'),
    btrim(p_proposal->>'action_text'),p_proposal->>'action_type',btrim(p_proposal->>'rationale'),
    btrim(p_proposal->>'success_criteria'),ctx->'evidence_refs',ctx,actor,2,p_request_key,req) returning action_id into id;
  return id;
end $$;

create function public.change_action_v2(p_action_id uuid,p_operation text,p_expected_revision integer,p_request_key uuid,
  p_note text default '',p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); a public.followup_actions%rowtype; req jsonb; previous jsonb;
  next_status text; kind text; due timestamptz; ctx jsonb;
begin
  if actor is null or not private.is_demo_member() then raise exception 'An active account is required.'; end if;
  if p_request_key is null or p_expected_revision is null or jsonb_typeof(p_details) is distinct from 'object'
    then raise exception 'The request is incomplete. Refresh and retry.'; end if;
  if length(coalesce(p_note,''))>1800 then raise exception 'Keep the note within 1,800 characters.'; end if;
  select * into a from public.followup_actions where action_id=p_action_id for update;
  if not found or (a.created_by<>actor and a.owner_user_id is distinct from actor) then raise exception 'This action is unavailable to your account.'; end if;
  req:=jsonb_build_object('operation',p_operation,'note',btrim(coalesce(p_note,'')),'details',p_details,'revision',p_expected_revision);
  select details->'request' into previous from public.action_events where action_id=p_action_id and request_key=p_request_key;
  if found then
    if previous is distinct from req then raise exception 'This request ID was already used for different contents.'; end if;
    return;
  end if;
  if a.revision<>p_expected_revision then raise exception 'Another session changed this action. Refresh it before continuing.'; end if;
  next_status:=a.status;
  if p_operation in ('accept','reject','revise','verify','return_to_work','reschedule') and a.created_by<>actor
    then raise exception 'Only the proposal author can record this demo review.'; end if;
  if p_operation in ('start','submit_completion','cancel') and a.owner_user_id is distinct from actor
    then raise exception 'Only the assigned owner can update this work.'; end if;
  if p_operation='revise' and (a.status='draft' or (a.workflow_version=1 and a.status in ('assigned','in_progress','completed'))) then
    perform private.validate_action_proposal_v2(p_details);
    if p_details->>'source_kind' is distinct from a.source_kind then raise exception 'The saved source origin cannot be changed.'; end if;
    ctx:=coalesce(a.evidence_snapshot,private.action_context_v2(a.incident_record_id,a.source_rca_action_id));
    update public.followup_actions set title=btrim(p_details->>'title'),action_text=btrim(p_details->>'action_text'),
      action_type=p_details->>'action_type',rationale=btrim(p_details->>'rationale'),success_criteria=btrim(p_details->>'success_criteria'),
      evidence_snapshot=ctx,evidence_refs=ctx->'evidence_refs',workflow_version=2 where action_id=p_action_id;
    kind:='revised';
  elsif p_operation='accept' and a.status='draft' then
    if a.workflow_version<>2 then raise exception 'Complete the evidence and expected result using Edit proposal first.'; end if;
    due:=(p_details->>'due_at')::timestamptz;
    if due is null or not isfinite(due) or due<=clock_timestamp() then raise exception 'Choose a future due date and time.'; end if;
    if coalesce(p_details->>'priority','') not in ('standard','expedited')
      or coalesce(length(btrim(p_details->>'priority_reason')),0) not between 12 and 800
      or coalesce(p_details->>'responsible_function','') not in ('Reliability','Maintenance','Operations')
      or length(btrim(coalesce(p_note,'')))<12 then raise exception 'Choose a responsible function and review priority, and explain both the priority and your decision.'; end if;
    update public.followup_actions set decision='accepted',status='assigned',owner_user_id=actor,due_at=due,
      decision_reason=btrim(p_note),review_priority=p_details->>'priority',priority_reason=btrim(p_details->>'priority_reason'),
      responsible_function=p_details->>'responsible_function' where action_id=p_action_id;
    next_status:='assigned'; kind:='accepted';
  elsif p_operation='reject' and a.status='draft' then
    if length(btrim(coalesce(p_note,'')))<12 then raise exception 'Explain the rejection in at least 12 characters.'; end if;
    update public.followup_actions set decision='rejected',status='rejected',decision_reason=btrim(p_note) where action_id=p_action_id;
    next_status:='rejected'; kind:='rejected';
  elsif p_operation='start' and a.status='assigned' then
    next_status:='in_progress'; kind:='started';
  elsif p_operation='submit_completion' and a.status in ('in_progress','completed') then
    if a.workflow_version<>2 then raise exception 'Complete the proposal, rationale and expected result before submitting a legacy completion.'; end if;
    if length(btrim(coalesce(p_note,'')))<20 or coalesce(length(btrim(p_details->>'reference')),0) not between 8 and 800
      then raise exception 'Describe the demo result and give a checkable result reference.'; end if;
    update public.followup_actions set status='completion_review',completion_note=btrim(p_note),completion_reference=btrim(p_details->>'reference') where action_id=p_action_id;
    next_status:='completion_review'; kind:='completion_submitted';
  elsif p_operation in ('verify','return_to_work') and a.status='completion_review' then
    if length(btrim(coalesce(p_note,'')))<12 then raise exception 'Explain the outcome of your completion review.'; end if;
    if p_operation='verify' then
      if a.workflow_version<>2 then raise exception 'Complete the legacy proposal and expected result before submitting it for verification.'; end if;
      update public.followup_actions set status='verified',verification_note=btrim(p_note),verified_by=actor,verified_at=now() where action_id=p_action_id;
      next_status:='verified'; kind:='verified';
    else
      update public.followup_actions set verification_note=btrim(p_note) where action_id=p_action_id;
      next_status:='in_progress'; kind:='returned_to_work';
    end if;
  elsif p_operation='cancel' and a.status in ('assigned','in_progress') then
    if length(btrim(coalesce(p_note,'')))<12 then raise exception 'Explain why this action is canceled.'; end if;
    next_status:='canceled'; kind:='canceled';
  elsif p_operation='reschedule' and a.status in ('assigned','in_progress') then
    due:=(p_details->>'due_at')::timestamptz;
    if due is null or not isfinite(due) or due<=clock_timestamp() or due=a.due_at
      or length(btrim(coalesce(p_note,'')))<12 then raise exception 'Choose a different future deadline and explain the change.'; end if;
    update public.followup_actions set due_at=due where action_id=p_action_id; kind:='rescheduled';
  elsif p_operation='comment' then
    if length(btrim(coalesce(p_note,'')))<12 then raise exception 'Write a note of at least 12 characters.'; end if;
    kind:='commented';
  else raise exception 'This transition is unavailable. Refresh the action to see its current stage.';
  end if;
  update public.followup_actions set status=next_status,revision=revision+1,updated_at=now() where action_id=p_action_id;
  insert into public.action_events(action_id,actor_user_id,event_kind,old_status,new_status,new_owner_user_id,event_note,request_key,details)
    values(p_action_id,actor,kind,a.status,next_status,case when kind='accepted' then actor else null end,
      nullif(btrim(p_note),''),p_request_key,jsonb_build_object('request',req,'previous_due_at',a.due_at,
        'previous_proposal',case when kind='revised' then jsonb_build_object('title',a.title,'action_text',a.action_text,
          'rationale',a.rationale,'success_criteria',a.success_criteria,'action_type',a.action_type) else null end));
end $$;

create function public.list_actions_v2(p_incident_id text default null,p_view text default 'all',p_search text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_demo_member() then raise exception 'An active account is required.'; end if;
  if p_page is null or p_page<1 or p_page>100000 or p_view not in ('all','needs_review','active','overdue','completion_review','verified','ended')
    or length(coalesce(p_search,''))>100 then raise exception 'Invalid list filter.'; end if;
  with base as (
    select a.*,i.asset_tag_as_provided as asset,i.plant_code as plant,i.occurred_date as incident_date,
      (a.status in ('assigned','in_progress') and a.due_at<now()) as overdue
    from public.followup_actions a join public.incident_records i on i.record_id=a.incident_record_id
    where (a.created_by=auth.uid() or a.owner_user_id=auth.uid())
      and (p_incident_id is null or a.incident_record_id=p_incident_id)
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(concat_ws(' ',a.title,a.action_text,i.asset_tag_as_provided,i.plant_code)))>0)
  ), filtered as (
    select * from base where p_view='all' or (p_view='needs_review' and status='draft')
      or (p_view='active' and status in ('assigned','in_progress')) or (p_view='overdue' and overdue)
      or (p_view='completion_review' and status in ('completion_review','completed'))
      or (p_view='verified' and status='verified') or (p_view='ended' and status in ('rejected','canceled'))
  ), page as (
    select * from filtered order by
      case when status in ('verified','rejected','canceled') then 1 else 0 end,
      overdue desc,case review_priority when 'expedited' then 0 when 'standard' then 1 else 2 end,
      due_at asc nulls last,created_at,action_id limit 12 offset (p_page-1)*12
  )
  select jsonb_build_object('actions',coalesce((select jsonb_agg(to_jsonb(page)-'draft_request') from page),'[]'::jsonb),
    'count',(select count(*) from filtered),'page_size',12,'server_time',now(),
    'summary',jsonb_build_object('needs_review',(select count(*) from base where status='draft'),
      'active',(select count(*) from base where status in ('assigned','in_progress')),
      'overdue',(select count(*) from base where overdue),
      'completion_review',(select count(*) from base where status in ('completion_review','completed')),
      'verified',(select count(*) from base where status='verified'))) into result;
  return result;
end $$;

create function public.get_action_v2(p_action_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_demo_member() then raise exception 'An active account is required.'; end if;
  select (to_jsonb(a)-'draft_request')||jsonb_build_object('asset',i.asset_tag_as_provided,'plant',i.plant_code,
    'incident_date',i.occurred_date,'overdue',(a.status in ('assigned','in_progress') and a.due_at<now())) into result
    from public.followup_actions a join public.incident_records i on i.record_id=a.incident_record_id
    where a.action_id=p_action_id and (a.created_by=auth.uid() or a.owner_user_id=auth.uid());
  if result is null then raise exception 'This action is unavailable to your account.'; end if;
  return result;
end $$;

create function public.historical_actions_v2() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_demo_member() then raise exception 'An active account is required.'; end if;
  return jsonb_build_object('documents',coalesce((select jsonb_agg(jsonb_build_object('document_id',d.document_id,
    'incident_id',d.linked_incident_record_id,'asset',a.asset_tag,'plant',d.plant_code,
    'file',d.source_file,'review_status',d.visual_review_status) order by a.asset_tag)
    from public.rca_documents d join public.assets a on a.asset_id=d.asset_id
    where d.link_status='verified_by_tag_plant_AR_and_occurrence_date'),'[]'::jsonb),
    'actions',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select ra.historical_action_id,ra.action_as_written,ra.owner_as_written,ra.plan_date_as_written,
        ra.source_status_as_written,rd.document_id,rd.linked_incident_record_id as incident_id,
        s.source_slide_number as slide,a.asset_tag as asset,rd.plant_code as plant
      from public.rca_actions ra join public.rca_documents rd on rd.document_id=ra.document_id
        join public.rca_sections s on s.slide_id=ra.slide_id and s.document_id=ra.document_id
        join public.assets a on a.asset_id=rd.asset_id
      where rd.link_status='verified_by_tag_plant_AR_and_occurrence_date' and rd.visual_review_status='reviewed'
        and s.visual_review_status='reviewed' and s.unread_visual_count=0 and ra.manual_review_status='reviewed'
      order by a.asset_tag,s.source_slide_number,ra.historical_action_id) x),'[]'::jsonb));
end $$;

revoke all on function public.get_action_context_v2(text,text),public.create_action_v2(text,uuid,text,jsonb,text),
  public.change_action_v2(uuid,text,integer,uuid,text,jsonb),public.list_actions_v2(text,text,text,integer),
  public.get_action_v2(uuid),public.historical_actions_v2() from public,anon;
grant execute on function public.get_action_context_v2(text,text),public.create_action_v2(text,uuid,text,jsonb,text),
  public.change_action_v2(uuid,text,integer,uuid,text,jsonb),public.list_actions_v2(text,text,text,integer),
  public.get_action_v2(uuid),public.historical_actions_v2() to authenticated;
comment on function public.create_action_v2(text,uuid,text,jsonb,text) is
  'Idempotent demo draft creation. Citations and historical context are generated from authorized source rows, never browser-provided locators.';
commit;
