-- Léo Family Office — Debt Engine V2
--
-- Le moteur de dette ne connaissait qu'un contrat minimal : capital, taux, mensualité,
-- nombre d'échéances. Assurance et frais étaient exposés dans le type mais toujours à
-- zéro, faute de colonnes pour les porter. Le différé, le remboursement anticipé et les
-- frais ponctuels n'existaient pas. Un échéancier bancaire réel ne pouvait pas primer sur
-- notre reconstruction, alors que c'est lui que la banque prélève.
--
-- Cette migration ajoute les termes manquants. Tout ce qui n'est pas renseigné reste NULL
-- ou absent : le moteur distingue « non déclaré » de « égal à zéro » pour signaler une
-- ambiguïté au lieu de produire un coût du crédit faussement précis.
--
-- Migration idempotente, rejouable sans risque.

-- 1. Termes optionnels du contrat.
alter table public.liabilities
  add column if not exists monthly_insurance numeric(20,6),
  add column if not exists recurring_fees numeric(20,6),
  add column if not exists payment_includes_insurance boolean,
  add column if not exists deferral_kind text not null default 'NONE',
  add column if not exists deferral_months integer not null default 0,
  add column if not exists deferral_interest_treatment text not null default 'UNKNOWN';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'liabilities_deferral_kind_ck') then
    alter table public.liabilities add constraint liabilities_deferral_kind_ck
      check (deferral_kind in ('NONE', 'PRINCIPAL_ONLY', 'TOTAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'liabilities_deferral_months_ck') then
    alter table public.liabilities add constraint liabilities_deferral_months_ck
      check (deferral_months >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'liabilities_deferral_interest_ck') then
    alter table public.liabilities add constraint liabilities_deferral_interest_ck
      check (deferral_interest_treatment in ('PAID', 'CAPITALISED', 'UNKNOWN'));
  end if;
end $$;

comment on column public.liabilities.monthly_insurance is
  'Assurance emprunteur par échéance. NULL = non renseignée, jamais supposée nulle.';
comment on column public.liabilities.recurring_fees is
  'Frais récurrents par échéance. NULL = non renseignés.';
comment on column public.liabilities.payment_includes_insurance is
  'true : monthly_payment contient déjà l''assurance, qui est retranchée de la part amortissante. false : elle s''ajoute. NULL : convention inconnue, signalée par le moteur.';
comment on column public.liabilities.deferral_interest_treatment is
  'Sort des intérêts pendant un différé TOTAL. UNKNOWN est une vraie valeur : le moteur suppose alors la capitalisation et marque l''échéancier en MODEL_ASSUMPTION.';

-- 2. Assurance et frais sur l'échéancier stocké.
--
-- Seules les lignes data_kind = 'ACTUAL' constituent un échéancier bancaire réel et
-- priment sur toute reconstruction. Une ligne DERIVED reste notre hypothèse : lui donner
-- priorité reviendrait à figer nos propres calculs en faits.
alter table public.loan_schedules
  add column if not exists insurance numeric(20,6) not null default 0,
  add column if not exists fees numeric(20,6) not null default 0;

comment on table public.loan_schedules is
  'Échéancier stocké. data_kind = ACTUAL : échéancier bancaire réel, prioritaire sur toute reconstruction. DERIVED : reconstruction du moteur, sans priorité.';

-- 3. Remboursements anticipés.
create table if not exists public.loan_early_repayments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  liability_id uuid not null references public.liabilities(id) on delete cascade,
  repayment_date date not null,
  amount numeric(20,6) not null,
  -- NULL = indemnité inconnue. Elle est alors exclue du décaissement et signalée, plutôt
  -- que supposée nulle : une indemnité oubliée fausse la comparaison rembourser/investir.
  penalty numeric(20,6),
  outcome text not null default 'UNKNOWN',
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loan_early_repayments_outcome_ck') then
    alter table public.loan_early_repayments add constraint loan_early_repayments_outcome_ck
      check (outcome in ('SHORTEN_TERM', 'REDUCE_PAYMENT', 'UNKNOWN'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loan_early_repayments_amount_ck') then
    alter table public.loan_early_repayments add constraint loan_early_repayments_amount_ck
      check (amount > 0);
  end if;
end $$;

comment on column public.loan_early_repayments.outcome is
  'Convention du prêteur après remboursement. UNKNOWN : le moteur maintient la mensualité et réduit la durée par hypothèse, en marquant l''échéancier MODEL_ASSUMPTION.';

create index if not exists loan_early_repayments_liability_idx
  on public.loan_early_repayments(liability_id, repayment_date);

-- 4. Frais ponctuels datés, hors échéancier : dossier, garantie, avenant.
create table if not exists public.loan_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  liability_id uuid not null references public.liabilities(id) on delete cascade,
  charge_date date not null,
  amount numeric(20,6) not null,
  label text not null,
  created_at timestamptz not null default now()
);

create index if not exists loan_charges_liability_idx
  on public.loan_charges(liability_id, charge_date);

-- 5. Isolation par utilisateur des deux nouvelles tables.
--
-- Le balayage RLS de la migration initiale ne couvre que les tables existant à SON
-- exécution. Toute table créée ensuite doit poser la sienne, sinon les grants ci-dessous
-- rendraient ses lignes lisibles et modifiables par n'importe quel utilisateur
-- authentifié, tous comptes confondus.
do $$
declare target text;
begin
  foreach target in array array['loan_early_repayments', 'loan_charges']
  loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists owner_all on public.%I', target);
    execute format(
      'create policy owner_all on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      target
    );
  end loop;
end $$;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
