-- A fresh hosted project with automatic Data API exposure disabled does not give
-- service_role the legacy implicit table grants. BYPASSRLS does not grant SQL access.
-- Keep the server's existing persistence path usable without granting anon or
-- authenticated any new rights. Never reopen deletion of durable Goals/Decision audit.
grant usage on schema public to service_role;
grant select, insert, update on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

do $$
declare target record;
begin
  for target in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in (
        'goals', 'goal_versions', 'decision_cases', 'decision_case_versions', 'decision_runs'
      )
  loop
    execute format('grant delete on table public.%I to service_role', target.relname);
  end loop;
end $$;

-- Future migrations inherit server access only; each domain may restrict it further.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
