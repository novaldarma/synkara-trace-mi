-- SYNKARA TRACE-MI | 008: eligible demo action owners.
-- Apply after 001-007. Keep app_memberships self-readable under RLS; this
-- function returns only active demo members, and only to an active member.

begin;

alter table public.app_memberships
    add column display_label text,
    add constraint membership_display_label_check check (
        display_label is null or
        (length(btrim(display_label)) between 2 and 80)
    );

comment on column public.app_memberships.display_label is
  'Optional administrator-provided demo name for choosing an action owner. Do not store passwords, emails, or secret keys here.';

create function public.list_demo_action_owners()
returns table (
    owner_user_id uuid,
    owner_role text,
    owner_label text
)
language sql stable security definer
set search_path = ''
as $$
    select m.user_id, m.access_level,
        coalesce(
            nullif(btrim(m.display_label), ''),
            case when m.user_id = (select auth.uid()) then 'My account'
                 else initcap(m.access_level) || ' (' || left(m.user_id::text, 8) || ')'
            end
        )
    from public.app_memberships m
    where m.is_active
      and (select private.is_demo_member())
    order by (m.user_id = (select auth.uid())) desc, m.access_level, m.user_id;
$$;

comment on function public.list_demo_action_owners() is
  'Active account IDs and optional demo labels for assignment. Callable only by an active authenticated member; does not expose email or passwords.';

revoke all on function public.list_demo_action_owners() from public, anon;
grant execute on function public.list_demo_action_owners() to authenticated;

commit;
