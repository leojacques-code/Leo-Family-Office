-- Léo Family Office — hypothèse d'allocation de l'épargne du Personal Monthly Financial Model
--
-- Jusqu'ici, la projection appliquait implicitement le rendement de marché à la totalité
-- des contributions futures : toute l'épargne était supposée investie, sans que cette
-- hypothèse apparaisse nulle part. Elle devient explicite, versionnée et modifiable.
--
-- Valeur par défaut 1 : elle reproduit exactement le comportement antérieur, de sorte que
-- la migration ne change aucune trajectoire existante. Sa provenance est MODEL_ASSUMPTION,
-- ce que l'interface Scenarios affiche.
--
-- Rappel de convention, portée par le même sprint : scenarios.monthly_savings est désormais
-- lu comme un surplus mensuel AVANT service de dette. La colonne n'est pas renommée pour
-- éviter une migration de persistance sans effet fonctionnel ; le sens est porté par le
-- moteur, par l'interface et par le commentaire ci-dessous.
--
-- Cette migration est idempotente et peut être rejouée sans risque.

alter table public.scenarios
  add column if not exists investment_allocation_rate numeric(6,5) not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scenarios_investment_allocation_rate_ck') then
    alter table public.scenarios add constraint scenarios_investment_allocation_rate_ck
      check (investment_allocation_rate >= 0 and investment_allocation_rate <= 1);
  end if;
end $$;

comment on column public.scenarios.investment_allocation_rate is
  'Part du surplus mensuel post-service-de-dette dirigée vers les actifs exposés au marché, entre 0 et 1. MODEL_ASSUMPTION.';

comment on column public.scenarios.monthly_savings is
  'Surplus mensuel AVANT service de dette : après revenus, fiscalité et dépenses de vie, avant intérêts, principal, assurance et frais. Le moteur mensuel retranche le service de dette explicitement.';

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
