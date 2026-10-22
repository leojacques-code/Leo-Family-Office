-- Dates d'observation et droits d'écriture sur les soldes de compte (arbitrages du
-- 25 septembre 2026). Migration ADDITIVE : aucune migration antérieure n'est réécrite.
--
--     DATE D'OBSERVATION ≠ DATE D'EFFET ≠ ÉCHÉANCE CONTRACTUELLE ≠ DATE DE PAIEMENT
--     FAIT OBSERVÉ ≠ PRÉVISION              HISTORIQUE CONSERVÉ ≠ HISTORIQUE RÉÉCRIT
--
--   * Un fait déclaré réellement observé ne peut pas être daté après aujourd'hui : une
--     opération, un revenu, un solde de compte ou un encours de dette observés demain ne sont
--     pas des faits. « Aujourd'hui » suit la convention opérationnelle du programme
--     (Europe/Paris, `operationalToday`), déjà retenue par `lfo_correct_net_income`.
--   * Les prévisions légitimes ne sont pas touchées : une échéance contractuelle, un flux
--     récurrent attendu (`recurring_cash_flow_rules`) ou une hypothèse (nature
--     `USER_ASSUMPTION` ou `MODEL_ASSUMPTION`) peuvent être futurs. Seules les natures de
--     FAIT sont contrôlées (`ACTUAL`, `EXTERNAL_DATA`, `DERIVED`, `MISSING`).
--   * Le contrôle vit au niveau où l'information se crée : un trigger par table
--     d'observation, commun à tous les chemins (saisie, RPC, import). Une ligne existante
--     n'est contrôlée que si sa date change : l'historique déjà persisté reste lisible et
--     modifiable sur ses autres champs, il n'est ni refusé ni réécrit.
--   * `account_balances` gardait INSERT, UPDATE et DELETE pour `authenticated`. Audit des
--     chemins d'écriture (25 septembre) : saisie manuelle de solde (serveur, `service_role`),
--     `lfo_add_account` et `lfo_add_transaction` (RPC réservées à `service_role`) ; aucun
--     import, aucune clôture ni aucun rapprochement n'y écrit, et le navigateur n'y écrit
--     jamais. Les droits d'écriture directe sont donc retirés ; la lecture et la RLS restent.

create or replace function public.lfo_guard_observation_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_column text := tg_argv[0];
  v_new date;
  v_old date;
  v_today date := (now() at time zone 'Europe/Paris')::date;
begin
  if (to_jsonb(new) ->> 'data_kind') in ('USER_ASSUMPTION', 'MODEL_ASSUMPTION') then
    return new;
  end if;
  v_new := (to_jsonb(new) ->> v_column)::date;
  if tg_op = 'UPDATE' then
    v_old := (to_jsonb(old) ->> v_column)::date;
    if v_new is not distinct from v_old then
      return new;
    end if;
  end if;
  if v_new > v_today then
    raise exception using
      errcode = 'LF425',
      message = 'Date d''observation future : un fait observé ne peut pas être daté après aujourd''hui';
  end if;
  return new;
end;
$$;
revoke all on function public.lfo_guard_observation_date() from public, anon, authenticated;

drop trigger if exists transactions_observation_date_guard on public.transactions;
create trigger transactions_observation_date_guard
  before insert or update on public.transactions
  for each row execute function public.lfo_guard_observation_date('transaction_date');

drop trigger if exists account_balances_observation_date_guard on public.account_balances;
create trigger account_balances_observation_date_guard
  before insert or update on public.account_balances
  for each row execute function public.lfo_guard_observation_date('balance_date');

drop trigger if exists liability_balance_observations_date_guard
  on public.liability_balance_observations;
create trigger liability_balance_observations_date_guard
  before insert or update on public.liability_balance_observations
  for each row execute function public.lfo_guard_observation_date('observed_at');

revoke insert, update, delete, truncate on table public.account_balances from anon, authenticated;
