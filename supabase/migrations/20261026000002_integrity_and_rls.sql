-- Protect 104: integrity triggers, audit trail, and row-level security.

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer so policies don't recurse)
-- ---------------------------------------------------------------------------
create or replace function public.member_role(p_project uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.project_members m
  where m.project_id = p_project and m.user_id = auth.uid() and m.access_state = 'active'
$$;

create or replace function public.is_member(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.member_role(p_project) is not null
$$;

create or replace function public.can_edit(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.member_role(p_project) in ('owner','editor'), false)
$$;

create or replace function public.is_owner(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.member_role(p_project) = 'owner', false)
$$;

-- True only inside import_rows() run by a project owner (restores history verbatim).
create or replace function public.importing(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(current_setting('app.importing', true), '') = p_project::text
$$;

-- ---------------------------------------------------------------------------
-- Row version + updated_at. A writer must present the version it read
-- (or leave it unchanged); a stale version is rejected.
-- ---------------------------------------------------------------------------
create or replace function public.touch_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.row_version is distinct from old.row_version then
    raise exception 'stale_version: % expected %, got %', tg_table_name, old.row_version, new.row_version
      using errcode = '40001';
  end if;
  new.row_version := old.row_version + 1;
  new.updated_at := now();
  if (to_jsonb(new)->>'project_id') is distinct from (to_jsonb(old)->>'project_id') then
    raise exception 'project_id is immutable';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Append-only audit trail
-- ---------------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_id uuid;
  v_version int;
begin
  if tg_op = 'DELETE' then
    v_project := coalesce((to_jsonb(old)->>'project_id')::uuid, old.id);
    v_id := old.id; v_version := old.row_version;
  else
    v_project := coalesce((to_jsonb(new)->>'project_id')::uuid, new.id);
    v_id := new.id; v_version := new.row_version;
  end if;
  insert into public.audit_events (project_id, actor, actor_kind, action, table_name, record_id, record_version, before, after)
  values (
    v_project,
    auth.uid(),
    case when auth.uid() is null then coalesce(nullif(current_setting('app.actor_kind', true), ''), 'system') else 'user' end,
    lower(tg_op),
    tg_table_name,
    v_id,
    v_version,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) - 'extracted_text' end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) - 'extracted_text' end
  );
  return null;
end $$;

create or replace function public.audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end $$;

create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function public.audit_immutable();

-- Apply touch + audit triggers to every business table.
do $$
declare t text;
begin
  foreach t in array array[
    'projects','project_members','stage_transitions','sources','source_versions','claims','claim_sources',
    'tasks','task_dependencies','risks','decisions','price_observations','property_checks',
    'governance_options','stakeholders','interactions','opportunities','funding_commitments','receipts',
    'financial_scenarios','financial_lines','agent_runs','agent_jobs','proposals','drafts','approvals','integrations'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_row()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;
-- run_events are high-volume and already append-only; they get the version trigger only.
create trigger run_events_touch before update on public.run_events for each row execute function public.touch_row();

-- ---------------------------------------------------------------------------
-- Evidence rules
-- ---------------------------------------------------------------------------
-- An accepted claim must cite at least one source (user instructions cite the recorded
-- user-instruction source). verified_current additionally needs a named verifier.
create or replace function public.check_claim_evidence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.review_state = 'accepted' then
    if not exists (select 1 from public.claim_sources cs where cs.claim_id = new.id) then
      raise exception 'claim % cannot be accepted without a source link', coalesce(new.code, new.id::text)
        using errcode = '23514';
    end if;
  end if;
  if new.evidence_class = 'verified_current' and (new.verified_by is null or new.verified_at is null) then
    raise exception 'verified_current requires verified_by and verified_at' using errcode = '23514';
  end if;
  if new.evidence_class = 'verified_current' and new.inherited_unverified then
    raise exception 'inherited findings cannot be verified_current until independently retrieved' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger claims_evidence after insert or update on public.claims
  deferrable initially deferred for each row execute function public.check_claim_evidence();

create or replace function public.claim_source_same_project()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.claims c where c.id = new.claim_id and c.project_id = new.project_id)
     or not exists (select 1 from public.sources s where s.id = new.source_id and s.project_id = new.project_id) then
    raise exception 'claim and source must belong to the same project' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger claim_sources_scope before insert or update on public.claim_sources
  for each row execute function public.claim_source_same_project();

-- ---------------------------------------------------------------------------
-- Task dependency cycle prevention
-- ---------------------------------------------------------------------------
create or replace function public.prevent_task_cycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    with recursive chain(id) as (
      select new.depends_on_id
      union
      select d.depends_on_id from public.task_dependencies d join chain on d.task_id = chain.id
    )
    select 1 from chain where id = new.task_id
  ) then
    raise exception 'task dependency would create a cycle' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger task_dependencies_cycle before insert or update on public.task_dependencies
  for each row execute function public.prevent_task_cycle();

-- ---------------------------------------------------------------------------
-- Decisions: only a project owner can record a decision; it binds the actor.
-- ---------------------------------------------------------------------------
create or replace function public.guard_decision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'open' and not public.importing(new.project_id) then
      raise exception 'decisions are created open; record the decision separately' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.state is distinct from old.state or new.chosen_alternative is distinct from old.chosen_alternative then
    if auth.uid() is null or not public.is_owner(new.project_id) then
      raise exception 'only a project owner can record a decision' using errcode = '42501';
    end if;
    if new.state <> 'open' then
      new.decided_by := auth.uid();
      new.decided_at := now();
    end if;
  end if;
  return new;
end $$;

create trigger decisions_guard before insert or update on public.decisions
  for each row execute function public.guard_decision();

-- Governance options can be "selected" only by an accepted decision.
create or replace function public.guard_governance_selection()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state = 'selected' and not exists (
    select 1 from public.decisions d where d.id = new.decision_id and d.state = 'accepted' and d.project_id = new.project_id
  ) then
    raise exception 'a governance option can be selected only through an accepted decision' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger governance_selection before insert or update on public.governance_options
  for each row execute function public.guard_governance_selection();

-- ---------------------------------------------------------------------------
-- Stage advancement: only through a signed-off stage transition.
-- ---------------------------------------------------------------------------
create or replace function public.guard_project_stage()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.stage is distinct from old.stage and coalesce(current_setting('app.stage_tx', true), '') <> '1' then
    raise exception 'project stage changes only through a signed-off stage transition' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger projects_stage_guard before update on public.projects
  for each row execute function public.guard_project_stage();

create or replace function public.apply_stage_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_owner(new.project_id) or new.signed_off_by <> auth.uid() then
    raise exception 'stage signoff requires the project owner' using errcode = '42501';
  end if;
  if coalesce(array_length(new.criteria_claim_ids, 1), 0) = 0 then
    raise exception 'stage transition requires evidence-backed criteria' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(new.criteria_claim_ids) cid
    where not exists (select 1 from public.claims c where c.id = cid and c.project_id = new.project_id and c.review_state = 'accepted')
  ) then
    raise exception 'every stage criterion must be an accepted claim' using errcode = '23514';
  end if;
  perform set_config('app.stage_tx', '1', true);
  update public.projects set stage = new.to_stage where id = new.project_id;
  perform set_config('app.stage_tx', '', true);
  return new;
end $$;

create trigger stage_transitions_apply before insert on public.stage_transitions
  for each row execute function public.apply_stage_transition();

-- ---------------------------------------------------------------------------
-- Drafts and approvals
-- ---------------------------------------------------------------------------
create or replace function public.draft_hash(p_title text, p_audience text, p_body text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(coalesce(p_title,'') || E'\x1f' || coalesce(p_audience,'') || E'\x1f' || coalesce(p_body,''), 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.guard_draft()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.content_hash := public.draft_hash(new.title, new.audience, new.body);
  if tg_op = 'UPDATE' and new.content_hash <> old.content_hash then
    -- Editing approved content invalidates every approval bound to the old content.
    update public.approvals set state = 'invalidated', note = 'content changed after approval'
      where record_table = 'drafts' and record_id = new.id and state in ('requested','approved');
    new.state := 'draft';
  end if;
  if tg_op = 'UPDATE' and new.state = 'approved' and old.state <> 'approved' then
    if not exists (
      select 1 from public.approvals a
      where a.record_table = 'drafts' and a.record_id = new.id and a.state = 'approved'
        and a.content_hash = new.content_hash and a.expires_at > now()
    ) then
      raise exception 'draft can be marked approved only by a matching approval record' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger drafts_guard before insert or update on public.drafts
  for each row execute function public.guard_draft();

create or replace function public.guard_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'requested' and not public.importing(new.project_id) then
      raise exception 'approvals start as requested' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Bound fields are immutable: nobody can widen or retarget an approval.
  if new.action_kind <> old.action_kind or new.target <> old.target or new.content_hash <> old.content_hash
     or new.scope <> old.scope or new.record_table <> old.record_table or new.record_id <> old.record_id
     or new.record_version <> old.record_version then
    raise exception 'approval scope is immutable; request a new approval' using errcode = '42501';
  end if;
  if new.state = 'approved' and old.state <> 'approved' then
    if old.state <> 'requested' then
      raise exception 'only a requested approval can be approved' using errcode = '42501';
    end if;
    if auth.uid() is null or not public.is_owner(new.project_id) then
      raise exception 'approval requires a project owner (agents cannot approve)' using errcode = '42501';
    end if;
    if new.record_table = 'drafts' then
      select d.content_hash into v_hash from public.drafts d where d.id = new.record_id;
      if v_hash is distinct from new.content_hash then
        raise exception 'approval content hash no longer matches the draft' using errcode = '40001';
      end if;
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
    new.expires_at := coalesce(new.expires_at, now() + interval '14 days');
  end if;
  return new;
end $$;

create trigger approvals_guard before insert or update on public.approvals
  for each row execute function public.guard_approval();

-- Project creation helper: creator becomes owner.
create or replace function public.create_project(p_name text, p_mission text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  insert into public.projects (name, mission) values (p_name, p_mission) returning id into v_id;
  insert into public.project_members (project_id, user_id, role, access_state) values (v_id, auth.uid(), 'owner', 'active');
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'projects','project_members','stage_transitions','sources','source_versions','claims','claim_sources',
    'tasks','task_dependencies','risks','decisions','price_observations','property_checks',
    'governance_options','stakeholders','interactions','opportunities','funding_commitments','receipts',
    'financial_scenarios','financial_lines','agent_runs','agent_jobs','run_events','proposals','drafts',
    'approvals','integrations','audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Standard business tables: members read, owners/editors write.
do $$
declare t text;
begin
  foreach t in array array[
    'claims','claim_sources','tasks','task_dependencies','risks','price_observations','property_checks',
    'governance_options','interactions','opportunities','funding_commitments','receipts',
    'financial_scenarios','financial_lines','source_versions','decisions'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(project_id))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit(project_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit(project_id)) with check (public.can_edit(project_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_edit(project_id))', t || '_delete', t);
  end loop;
end $$;

-- Sensitivity-aware reads.
create policy sources_read on public.sources for select to authenticated
  using (public.is_member(project_id) and (access_classification <> 'restricted' or public.is_owner(project_id)));
create policy sources_insert on public.sources for insert to authenticated with check (public.can_edit(project_id));
create policy sources_update on public.sources for update to authenticated using (public.can_edit(project_id)) with check (public.can_edit(project_id));

create policy stakeholders_read on public.stakeholders for select to authenticated
  using (public.is_member(project_id) and (privacy <> 'private' or public.can_edit(project_id)));
create policy stakeholders_insert on public.stakeholders for insert to authenticated with check (public.can_edit(project_id));
create policy stakeholders_update on public.stakeholders for update to authenticated using (public.can_edit(project_id)) with check (public.can_edit(project_id));
create policy stakeholders_delete on public.stakeholders for delete to authenticated using (public.can_edit(project_id));

create policy drafts_read on public.drafts for select to authenticated
  using (public.is_member(project_id) and (not contains_confidential or public.can_edit(project_id)));
create policy drafts_insert on public.drafts for insert to authenticated with check (public.can_edit(project_id));
create policy drafts_update on public.drafts for update to authenticated using (public.can_edit(project_id)) with check (public.can_edit(project_id));

-- Projects and membership.
create policy projects_read on public.projects for select to authenticated using (public.is_member(id));
create policy projects_update on public.projects for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));

create policy members_read on public.project_members for select to authenticated using (public.is_member(project_id));
create policy members_insert on public.project_members for insert to authenticated with check (public.is_owner(project_id));
create policy members_update on public.project_members for update to authenticated using (public.is_owner(project_id)) with check (public.is_owner(project_id));
create policy members_delete on public.project_members for delete to authenticated using (public.is_owner(project_id));

create policy stage_read on public.stage_transitions for select to authenticated using (public.is_member(project_id));
create policy stage_insert on public.stage_transitions for insert to authenticated with check (public.is_owner(project_id));

-- Approvals: editors may request; only owners may approve (enforced again in trigger).
create policy approvals_read on public.approvals for select to authenticated using (public.is_member(project_id));
create policy approvals_insert on public.approvals for insert to authenticated with check (public.can_edit(project_id));
create policy approvals_update on public.approvals for update to authenticated using (public.is_owner(project_id)) with check (public.is_owner(project_id));

-- Agent runtime: members read; editors start/cancel runs and review proposals.
-- Jobs and events are written only by the server worker after scoped authorization.
create policy runs_read on public.agent_runs for select to authenticated using (public.is_member(project_id));
create policy runs_insert on public.agent_runs for insert to authenticated
  with check (public.can_edit(project_id) and initiator = auth.uid());
create policy runs_update on public.agent_runs for update to authenticated using (public.can_edit(project_id)) with check (public.can_edit(project_id));
create policy jobs_read on public.agent_jobs for select to authenticated using (public.is_member(project_id));
create policy events_read on public.run_events for select to authenticated using (public.is_member(project_id));
create policy proposals_read on public.proposals for select to authenticated using (public.is_member(project_id));
create policy proposals_update on public.proposals for update to authenticated using (public.can_edit(project_id)) with check (public.can_edit(project_id));

create policy integrations_read on public.integrations for select to authenticated using (public.is_member(project_id));
create policy integrations_write on public.integrations for update to authenticated using (public.is_owner(project_id)) with check (public.is_owner(project_id));

create policy audit_read on public.audit_events for select to authenticated using (public.can_edit(project_id));

-- ---------------------------------------------------------------------------
-- Private Storage: objects live under <project_id>/... in the private `sources` bucket.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('sources', 'sources', false, 26214400,
            array['application/pdf','text/plain','text/markdown','text/html','message/rfc822','image/png','image/jpeg',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
    on conflict (id) do update set public = false;

    execute $p$create policy sources_objects_read on storage.objects for select to authenticated
      using (bucket_id = 'sources' and public.is_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy sources_objects_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'sources' and public.can_edit(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;
