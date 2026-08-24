-- Léo Family Office — Debt Engine V2.1 : couverture contractuelle élargie
--
-- Debt V2 savait représenter un prêt amortissable mensuel à taux fixe, avec assurance,
-- frais, différés et remboursements anticipés. Il supposait implicitement que toute dette
-- est mensuelle, à taux constant, et amortie linéairement jusqu'à extinction.
--
-- Cette migration porte les termes qui manquaient pour représenter honnêtement un
-- interest-only, un in fine, un balloon, une échéance trimestrielle ou annuelle, un
-- paiement à paliers, une révision de taux et un frais incorporé au financement.
--
-- Tous les défauts reproduisent exactement le comportement antérieur : une dette déjà en
-- base reste un amortissable mensuel à taux fixe proportionnel, et aucun chiffre ne bouge.
--
-- Migration idempotente, rejouable sans risque.

-- 1. Forme du remboursement, périodicité, convention d'intérêt, regroupement.
alter table public.liabilities
  add column if not exists amortisation_profile text not null default 'AMORTIZING',
  add column if not exists balloon_amount numeric(20,6),
  add column if not exists payment_frequency text not null default 'MONTHLY',
  add column if not exists interest_convention text not null default 'PROPORTIONAL',
  add column if not exists facility_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'liabilities_amortisation_profile_ck') then
    alter table public.liabilities add constraint liabilities_amortisation_profile_ck
      check (amortisation_profile in ('AMORTIZING', 'INTEREST_ONLY', 'BULLET', 'BALLOON'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'liabilities_payment_frequency_ck') then
    alter table public.liabilities add constraint liabilities_payment_frequency_ck
      check (payment_frequency in ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'liabilities_interest_convention_ck') then
    alter table public.liabilities add constraint liabilities_interest_convention_ck
      check (interest_convention in ('PROPORTIONAL', 'ACTUAL_365'));
  end if;
  -- rate_type existait sans contrainte : une valeur libre y aurait laissé passer un
  -- « REVISABLE » que le moteur n'aurait pas reconnu, donc traité comme FIXED en silence.
  if not exists (select 1 from pg_constraint where conname = 'liabilities_rate_type_ck') then
    alter table public.liabilities add constraint liabilities_rate_type_ck
      check (rate_type in ('FIXED', 'VARIABLE'));
  end if;
end $$;

comment on column public.liabilities.amortisation_profile is
  'AMORTIZING / INTEREST_ONLY / BULLET / BALLOON. Décrit la forme d''ensemble du remboursement ; le différé, lui, décrit le début du prêt. Les deux se composent.';
comment on column public.liabilities.balloon_amount is
  'Solde final remboursé en une fois. Requis par le profil BALLOON, sans objet ailleurs.';
comment on column public.liabilities.payment_frequency is
  'Périodicité des échéances. payment_count compte des ÉCHÉANCES, pas des mois.';
comment on column public.liabilities.interest_convention is
  'PROPORTIONAL : taux annuel × mois de la période / 12, convention des prêts amortissables français. ACTUAL_365 : jours réels sur 365.';
comment on column public.liabilities.monthly_payment is
  'Paiement contractuel PAR ÉCHÉANCE, pas nécessairement par mois : voir payment_frequency. Le nom est conservé pour ne pas casser une persistance en place.';
comment on column public.liabilities.facility_id is
  'Regroupement de tranches d''un même concours. Une tranche reste une dette autonome avec son taux, sa maturité et son amortissement.';

-- 2. Frais incorporés au financement.
alter table public.loan_charges
  add column if not exists financed boolean not null default false;

comment on column public.loan_charges.financed is
  'true : le frais est incorporé au financement, aucune trésorerie ne sort mais l''encours augmente. Dans les deux cas c''est un coût économique.';

-- 3. Termes datés : taux et paiements qui changent à une date.
--
-- term_kind sépare une clause du contrat d'une hypothèse que nous posons. Les confondre
-- ferait lire une projection de taux comme un engagement du prêteur.
create table if not exists public.loan_rate_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  liability_id uuid not null references public.liabilities(id) on delete cascade,
  effective_from date not null,
  annual_rate numeric(12,8) not null,
  term_kind text not null default 'CONTRACTUAL',
  created_at timestamptz not null default now(),
  unique(liability_id, effective_from)
);

create table if not exists public.loan_payment_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  liability_id uuid not null references public.liabilities(id) on delete cascade,
  effective_from date not null,
  amount numeric(20,6) not null,
  term_kind text not null default 'CONTRACTUAL',
  created_at timestamptz not null default now(),
  unique(liability_id, effective_from)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loan_rate_changes_kind_ck') then
    alter table public.loan_rate_changes add constraint loan_rate_changes_kind_ck
      check (term_kind in ('CONTRACTUAL', 'ASSUMPTION'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loan_payment_changes_kind_ck') then
    alter table public.loan_payment_changes add constraint loan_payment_changes_kind_ck
      check (term_kind in ('CONTRACTUAL', 'ASSUMPTION'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loan_payment_changes_amount_ck') then
    alter table public.loan_payment_changes add constraint loan_payment_changes_amount_ck
      check (amount >= 0);
  end if;
end $$;

create index if not exists loan_rate_changes_liability_idx
  on public.loan_rate_changes(liability_id, effective_from);
create index if not exists loan_payment_changes_liability_idx
  on public.loan_payment_changes(liability_id, effective_from);

-- 4. Isolation par utilisateur des deux nouvelles tables.
--
-- Le balayage RLS de la migration initiale ne couvre que les tables existant à SON
-- exécution. Sans ce bloc, les grants ci-dessous rendraient ces lignes lisibles et
-- modifiables par n'importe quel utilisateur authentifié, tous comptes confondus.
do $$
declare target text;
begin
  foreach target in array array['loan_rate_changes', 'loan_payment_changes']
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
