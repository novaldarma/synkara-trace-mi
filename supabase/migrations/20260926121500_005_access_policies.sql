-- SYNKARA TRACE-MI | 005: public showcase + restricted case data and actions.
-- Apply after 001-004. Create Supabase Auth accounts first, then enroll their
-- auth.users.id using a trusted SQL/admin session. No user IDs or passwords
-- are embedded in migrations. Never send a service-role key to the browser.
-- Public showcase snapshots must be synthetic, reviewed, then published by a
-- trusted importer. The visitor UI uses these snapshots, never raw case tables.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- No-login, read-only visitor experience. Start EMPTY and unpublished.
-- The application will add reviewed synthetic fixtures later; a publishable
-- key alone does not grant access to original Incident, Equipment, RCA, or
-- UCI rows. Browser code must visibly label this data as an illustrative demo.
create table public.demo_scenarios (
    scenario_id text primary key check (btrim(scenario_id) <> ''),
    title text not null check (btrim(title) <> ''),
    data_scope text not null default 'synthetic_public_demo'
        check (data_scope = 'synthetic_public_demo'),
    payload jsonb not null check (
        jsonb_typeof(payload) = 'object'
        and octet_length(payload::text) <= 100000
    ),
    approved_by uuid references auth.users(id),
    published_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint demo_publish_review_check check (
        published_at is null or approved_by is not null
    )
);

alter table public.demo_scenarios enable row level security;
revoke all on table public.demo_scenarios from public, anon, authenticated;
grant select on table public.demo_scenarios to anon, authenticated;
grant select, insert, update, delete on table public.demo_scenarios to service_role;

create policy demo_scenario_public_read on public.demo_scenarios
    for select to anon, authenticated
    using (published_at is not null and approved_by is not null
           and data_scope = 'synthetic_public_demo');

comment on table public.demo_scenarios is
  'Reviewed and published synthetic showcase fixtures only. Do not copy competition source rows, slide text, or secrets into the public payload.';

create table public.app_memberships (
    user_id uuid primary key references auth.users(id) on delete cascade,
    access_level text not null check (access_level in ('judge', 'engineer', 'admin')),
    is_active boolean not null default true,
    enrolled_at timestamptz not null default now()
);

alter table public.app_memberships enable row level security;
revoke all on table public.app_memberships from public, anon, authenticated;
grant select on table public.app_memberships to authenticated;
grant select, insert, update, delete on table public.app_memberships to service_role;

create policy app_membership_read_self on public.app_memberships
    for select to authenticated
    using (user_id = (select auth.uid()));

create function private.is_demo_member()
returns boolean language sql stable security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.app_memberships m
        where m.user_id = (select auth.uid()) and m.is_active
    );
$$;

revoke all on function private.is_demo_member() from public, anon;
grant execute on function private.is_demo_member() to authenticated;

-- Source and reference data are read-only in the app. Every exposed table
-- already has RLS enabled by 001-003. No anon policy is created.
do $$
declare tab text;
begin
    foreach tab in array array[
        'source_catalog', 'plants', 'assets', 'kpi_definitions',
        'source_field_map', 'data_quality_issues',
        'production_tag_catalog', 'production_records', 'production_values',
        'equipment_reference', 'equipment_observations',
        'equipment_summary_values', 'incident_records',
        'incident_source_summary', 'rca_documents', 'rca_sections',
        'rca_actions', 'case_links',
        'energy_readings', 'energy_model_runs', 'energy_forecasts'
    ] loop
        execute format('grant select on table public.%I to authenticated', tab);
        execute format(
            'create policy demo_member_select on public.%I '
            || 'for select to authenticated '
            || 'using ((select private.is_demo_member()))', tab
        );
    end loop;
end;
$$;

-- Deliberately do not expose energy_forecast_evaluations. The API must reveal
-- holdout results only after a forecast has been presented for that cutoff.
-- Authenticated users can still inspect raw historical readings: this is a
-- demonstrative backtest workflow, not a claim that historical data are secret.

alter table public.analysis_records
    add column reviewed_by uuid references auth.users(id),
    add column reviewed_at timestamptz,
    add column review_reason text,
    add constraint analysis_review_consistency check (
        (review_status = 'unreviewed'
         and reviewed_by is null and reviewed_at is null)
        or (review_status in ('accepted', 'rejected')
            and reviewed_by is not null and reviewed_at is not null)
    );

alter table public.review_flags
    add column resolved_by uuid references auth.users(id),
    add column resolved_at timestamptz,
    add constraint review_flag_resolution_consistency check (
        (resolution = 'open' and resolved_by is null and resolved_at is null)
        or (resolution in ('acknowledged', 'dismissed')
            and resolved_by is not null and resolved_at is not null)
    );

grant select, insert (incident_record_id, analysis_mode, as_of_at, rule_version,
    result_kind, assessment, evidence_refs, limitations, created_by)
    on table public.analysis_records to authenticated;
grant select, insert (analysis_id, flag_kind, flag_text, evidence_refs, created_by)
    on table public.review_flags to authenticated;
grant select, insert (incident_record_id, analysis_id, source_rca_action_id,
    source_kind, action_text, action_type, evidence_refs, created_by)
    on table public.followup_actions to authenticated;
grant select on table public.action_events to authenticated;

create policy analysis_member_read on public.analysis_records
    for select to authenticated using ((select private.is_demo_member()));
create policy analysis_author_insert on public.analysis_records
    for insert to authenticated with check (
        (select private.is_demo_member())
        and created_by = (select auth.uid())
        and review_status = 'unreviewed'
        and reviewed_by is null and reviewed_at is null
    );

create policy flag_member_read on public.review_flags
    for select to authenticated using ((select private.is_demo_member()));
create policy flag_author_insert on public.review_flags
    for insert to authenticated with check (
        (select private.is_demo_member())
        and created_by = (select auth.uid())
        and resolution = 'open'
        and resolved_by is null and resolved_at is null
    );

create policy action_member_read on public.followup_actions
    for select to authenticated using ((select private.is_demo_member()));
create policy action_author_insert on public.followup_actions
    for insert to authenticated with check (
        (select private.is_demo_member())
        and created_by = (select auth.uid())
        and decision = 'pending' and status = 'draft'
        and owner_user_id is null and due_at is null
        and (
            source_kind <> 'reviewed_rca_action'
            or exists (
                select 1 from public.rca_actions ra
                join public.rca_documents rd on rd.document_id = ra.document_id
                where ra.historical_action_id = source_rca_action_id
                  and rd.linked_incident_record_id = incident_record_id
                  and ra.manual_review_status = 'reviewed'
            )
        )
        and (
            analysis_id is null or exists (
                select 1 from public.analysis_records ar
                where ar.analysis_id = followup_actions.analysis_id
                  and ar.created_by = (select auth.uid())
            )
        )
    );

create policy action_event_member_read on public.action_events
    for select to authenticated using ((select private.is_demo_member()));

-- Only trusted functions can change decisions/status and append events.
-- Direct browser UPDATE/DELETE on actions or event INSERT/UPDATE/DELETE is
-- intentionally absent. The owning author decides; only the current owner
-- advances progress. All modifications append an event in one transaction.
create function private.log_action_created()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
    insert into public.action_events
        (action_id, actor_user_id, event_kind, new_status, event_note)
    values (new.action_id, coalesce((select auth.uid()), new.created_by),
            'created', 'draft', 'Draft proposal created');
    return new;
end;
$$;

revoke all on function private.log_action_created() from public, anon, authenticated;
create trigger log_followup_action_creation
    after insert on public.followup_actions
    for each row execute function private.log_action_created();

create function public.decide_followup_action(
    p_action_id uuid, p_decision text, p_owner_user_id uuid default null,
    p_due_at timestamptz default null, p_reason text default null
) returns void language plpgsql security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); rec public.followup_actions%rowtype;
begin
    if actor is null or not private.is_demo_member() then
        raise exception 'Access denied';
    end if;
    select * into rec from public.followup_actions
        where action_id = p_action_id for update;
    if not found or rec.created_by <> actor or rec.decision <> 'pending' then
        raise exception 'Action is unavailable for this decision';
    end if;
    if p_decision = 'accepted' then
        if p_owner_user_id is null or p_due_at is null or not exists (
            select 1 from public.app_memberships m
            where m.user_id = p_owner_user_id and m.is_active
        ) then
            raise exception 'Choose an active owner and a due date';
        end if;
        update public.followup_actions set
            decision = 'accepted', status = 'assigned',
            owner_user_id = p_owner_user_id, due_at = p_due_at,
            decision_reason = p_reason, updated_at = now()
            where action_id = p_action_id;
        insert into public.action_events
            (action_id, actor_user_id, event_kind, old_status,
             new_status, new_owner_user_id, event_note)
        values (p_action_id, actor, 'accepted', 'draft', 'assigned',
                p_owner_user_id, p_reason);
    elsif p_decision = 'rejected' then
        if p_reason is null or btrim(p_reason) = '' then
            raise exception 'Rejection reason is required';
        end if;
        update public.followup_actions set
            decision = 'rejected', status = 'rejected',
            decision_reason = p_reason, updated_at = now()
            where action_id = p_action_id;
        insert into public.action_events
            (action_id, actor_user_id, event_kind, old_status,
             new_status, event_note)
        values (p_action_id, actor, 'rejected', 'draft', 'rejected', p_reason);
    else
        raise exception 'Decision must be accepted or rejected';
    end if;
end;
$$;

create function public.advance_followup_action(
    p_action_id uuid, p_new_status text, p_note text default null
) returns void language plpgsql security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); rec public.followup_actions%rowtype;
declare event_type text;
begin
    if actor is null or not private.is_demo_member() then
        raise exception 'Access denied';
    end if;
    select * into rec from public.followup_actions
        where action_id = p_action_id for update;
    if not found or rec.decision <> 'accepted'
       or rec.owner_user_id <> actor then
        raise exception 'Only the assigned owner can advance this action';
    end if;
    if rec.status = 'assigned' and p_new_status = 'in_progress' then
        event_type := 'started';
    elsif rec.status = 'in_progress' and p_new_status = 'completed' then
        event_type := 'completed';
    elsif rec.status in ('assigned', 'in_progress')
          and p_new_status = 'canceled' then
        event_type := 'canceled';
    else
        raise exception 'Invalid status transition';
    end if;
    update public.followup_actions set
        status = p_new_status, updated_at = now() where action_id = p_action_id;
    insert into public.action_events
        (action_id, actor_user_id, event_kind, old_status,
         new_status, event_note)
    values (p_action_id, actor, event_type, rec.status, p_new_status, p_note);
end;
$$;

create function public.reassign_followup_action(
    p_action_id uuid, p_new_owner_user_id uuid, p_note text default null
) returns void language plpgsql security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); rec public.followup_actions%rowtype;
begin
    if actor is null or not private.is_demo_member() then
        raise exception 'Access denied';
    end if;
    select * into rec from public.followup_actions
        where action_id = p_action_id for update;
    if not found or rec.created_by <> actor or rec.decision <> 'accepted'
       or rec.status not in ('assigned', 'in_progress') then
        raise exception 'Only the action author can reassign an active action';
    end if;
    if p_new_owner_user_id is null or p_new_owner_user_id = rec.owner_user_id
       or not exists (
           select 1 from public.app_memberships m
           where m.user_id = p_new_owner_user_id and m.is_active
       ) then
        raise exception 'Choose a different active owner';
    end if;
    update public.followup_actions set
        owner_user_id = p_new_owner_user_id, updated_at = now()
        where action_id = p_action_id;
    insert into public.action_events
        (action_id, actor_user_id, event_kind, old_status, new_status,
         old_owner_user_id, new_owner_user_id, event_note)
    values (p_action_id, actor, 'reassigned', rec.status, rec.status,
            rec.owner_user_id, p_new_owner_user_id, p_note);
end;
$$;

create function public.review_analysis(
    p_analysis_id uuid, p_review_status text, p_reason text default null
) returns void language plpgsql security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); rec public.analysis_records%rowtype;
begin
    if actor is null or not private.is_demo_member() then
        raise exception 'Access denied';
    end if;
    select * into rec from public.analysis_records
        where analysis_id = p_analysis_id for update;
    if not found or rec.review_status <> 'unreviewed'
       or p_review_status not in ('accepted', 'rejected') then
        raise exception 'Analysis review is unavailable';
    end if;
    if p_review_status = 'rejected'
       and (p_reason is null or btrim(p_reason) = '') then
        raise exception 'Rejection reason is required';
    end if;
    update public.analysis_records set review_status = p_review_status,
        reviewed_by = actor, reviewed_at = now(), review_reason = p_reason
        where analysis_id = p_analysis_id;
end;
$$;

create function public.resolve_review_flag(
    p_flag_id uuid, p_resolution text
) returns void language plpgsql security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); rec public.review_flags%rowtype;
begin
    if actor is null or not private.is_demo_member() then
        raise exception 'Access denied';
    end if;
    select * into rec from public.review_flags where flag_id = p_flag_id for update;
    if not found or rec.created_by <> actor or rec.resolution <> 'open'
       or p_resolution not in ('acknowledged', 'dismissed') then
        raise exception 'Only the author can resolve an open flag';
    end if;
    update public.review_flags set resolution = p_resolution,
        resolved_by = actor, resolved_at = now(), updated_at = now()
        where flag_id = p_flag_id;
end;
$$;

revoke all on function public.decide_followup_action(uuid, text, uuid, timestamptz, text)
    from public, anon;
revoke all on function public.advance_followup_action(uuid, text, text)
    from public, anon;
revoke all on function public.reassign_followup_action(uuid, uuid, text)
    from public, anon;
revoke all on function public.review_analysis(uuid, text, text)
    from public, anon;
revoke all on function public.resolve_review_flag(uuid, text)
    from public, anon;

grant execute on function public.decide_followup_action(uuid, text, uuid, timestamptz, text)
    to authenticated;
grant execute on function public.advance_followup_action(uuid, text, text)
    to authenticated;
grant execute on function public.reassign_followup_action(uuid, uuid, text)
    to authenticated;
grant execute on function public.review_analysis(uuid, text, text)
    to authenticated;
grant execute on function public.resolve_review_flag(uuid, text)
    to authenticated;

commit;
