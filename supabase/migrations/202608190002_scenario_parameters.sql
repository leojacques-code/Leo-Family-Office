-- Léo Family Office — complément à 202608190001_initial_family_office.sql
--
-- La migration initiale crée public.scenarios sans les paramètres numériques du modèle,
-- alors que le type Scenario du domaine (src/lib/types.ts) et le moteur Monte-Carlo
-- (src/lib/engine/monte-carlo.ts) en dépendent. Sans ces colonnes, getScenarios,
-- update_scenario, duplicate_scenario et toute projection sont impossibles côté Supabase.
--
-- Choix retenu : colonnes dédiées plutôt que public.scenario_assumptions (clé/valeur jsonb).
-- Le modèle TypeScript est plat, l'adapter reste identique entre SQLite et Supabase, et
-- la lecture n'exige aucun pivot. scenario_assumptions reste disponible pour des clés
-- arbitraires ultérieures.
--
-- Cette migration est idempotente et peut être rejouée sans risque.

alter table public.scenarios
  add column if not exists annual_return numeric(12,8) not null default 0,
  add column if not exists annual_volatility numeric(12,8) not null default 0,
  add column if not exists annual_inflation numeric(12,8) not null default 0,
  add column if not exists monthly_savings numeric(20,6) not null default 0,
  add column if not exists salary_growth numeric(12,8) not null default 0,
  add column if not exists stress_probability numeric(12,8) not null default 0,
  add column if not exists shock_year integer,
  add column if not exists shock_magnitude numeric(12,8);

comment on column public.scenarios.annual_return is 'Rendement annuel espéré, décimal (0.055 = 5,5 %).';
comment on column public.scenarios.annual_volatility is 'Volatilité annualisée, décimal.';
comment on column public.scenarios.monthly_savings is 'Épargne mensuelle en devise de reporting.';
comment on column public.scenarios.shock_year is 'Année du choc daté optionnel, 1 = première année projetée.';
comment on column public.scenarios.shock_magnitude is 'Amplitude du choc, décimal signé (-0.35 = -35 %).';

-- Contraintes de cohérence alignées sur src/lib/validation/mutations.ts.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scenarios_shock_pair_ck') then
    alter table public.scenarios add constraint scenarios_shock_pair_ck
      check ((shock_year is null and shock_magnitude is null) or (shock_year is not null and shock_magnitude is not null));
  end if;
end $$;

-- Index de lecture du cockpit : une seule requête par table, filtrée par propriétaire.
create index if not exists scenarios_user_idx on public.scenarios(user_id);
create index if not exists goals_user_priority_idx on public.goals(user_id, priority);
create index if not exists alerts_user_status_idx on public.alerts(user_id, status);
create index if not exists documents_user_uploaded_idx on public.documents(user_id, uploaded_at desc);
create index if not exists monthly_closes_user_date_idx on public.monthly_closes(user_id, close_date desc);
create index if not exists budgets_user_category_idx on public.budgets(user_id, category_id, lifestyle);

-- Les tables créées ci-dessus héritent des grants explicites de la migration initiale ;
-- on les réapplique pour couvrir tout ajout futur et garantir qu'anon reste sans accès.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
