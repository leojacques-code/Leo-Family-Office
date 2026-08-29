-- Index couvrants des clés étrangères composites introduites par Scenarios V2 et Goals V2.
-- L'ordre reproduit exactement celui des colonnes de chaque FK.

create index if not exists scenario_versions_scenario_owner_fk_idx
  on public.scenario_versions(scenario_id, user_id);

create index if not exists scenario_assumptions_scenario_owner_fk_idx
  on public.scenario_assumptions(scenario_id, user_id);

create index if not exists simulation_runs_scenario_owner_fk_idx
  on public.simulation_runs(scenario_id, user_id);

create index if not exists simulation_results_run_owner_fk_idx
  on public.simulation_results(run_id, user_id);

create index if not exists goal_versions_goal_owner_fk_idx
  on public.goal_versions(goal_id, user_id);
