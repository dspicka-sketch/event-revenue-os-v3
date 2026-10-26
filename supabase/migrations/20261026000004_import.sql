-- Owner-only re-import of an export (see src/lib/export.ts). Rows arrive with fresh ids and
-- remapped references; decision and approval history is restored verbatim.
create or replace function public.import_rows(p_project uuid, p_table text, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is not null and not public.is_owner(p_project) then
    raise exception 'only the project owner can import' using errcode = '42501';
  end if;
  if p_table not in ('sources','source_versions','claims','claim_sources','tasks','task_dependencies','risks','decisions',
                     'price_observations','property_checks','governance_options','stakeholders','interactions','opportunities',
                     'funding_commitments','receipts','financial_scenarios','financial_lines','drafts','approvals') then
    raise exception 'table % is not importable', p_table;
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where (r->>'project_id')::uuid is distinct from p_project) then
    raise exception 'every imported row must target the project';
  end if;
  perform set_config('app.importing', p_project::text, true);
  perform set_config('app.actor_kind', 'import', true);
  execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', p_table, p_table) using p_rows;
  get diagnostics n = row_count;
  perform set_config('app.importing', '', true);
  return n;
end $$;
revoke execute on function public.import_rows(uuid, text, jsonb) from public, anon;
grant execute on function public.import_rows(uuid, text, jsonb) to authenticated;
