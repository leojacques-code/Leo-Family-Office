-- Léo Family Office — Cash Flow Engine V2
--
-- Le moteur de flux déduisait jusqu'ici la nature économique d'une transaction du nom
-- français de son groupe de catégorie ("Revenus", "Épargne"). Ce n'est pas robuste : un
-- renommage cassait silencieusement les agrégats, et la taxonomie ne pouvait pas
-- distinguer un transfert interne, un service de dette, un impôt ou un remboursement.
--
-- Cette migration introduit les champs STRUCTURELS que le moteur lit désormais, la
-- persistance des règles de flux récurrents et la clôture mensuelle du périmètre Cash Flow.
-- Le libellé des catégories reste libre et en français : il n'a plus aucun rôle de calcul.
--
-- Migration idempotente, rejouable sans risque.

-- 1. Taxonomie canonique portée par la catégorie.
alter table public.expense_categories
  add column if not exists cash_flow_kind text not null default 'EXPENSE',
  add column if not exists essentiality text not null default 'UNKNOWN',
  add column if not exists expense_behavior text not null default 'UNKNOWN',
  add column if not exists archived boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expense_categories_cash_flow_kind_ck') then
    alter table public.expense_categories add constraint expense_categories_cash_flow_kind_ck
      check (cash_flow_kind in ('INCOME','EXPENSE','INTERNAL_TRANSFER','INVESTMENT','SAVING',
                                'DEBT_SERVICE','TAX','REFUND','OTHER_INFLOW','OTHER_OUTFLOW','UNCLASSIFIED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expense_categories_essentiality_ck') then
    alter table public.expense_categories add constraint expense_categories_essentiality_ck
      check (essentiality in ('ESSENTIAL','NON_ESSENTIAL','UNKNOWN'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expense_categories_behavior_ck') then
    alter table public.expense_categories add constraint expense_categories_behavior_ck
      check (expense_behavior in ('FIXED','VARIABLE','DISCRETIONARY','UNKNOWN'));
  end if;
end $$;

-- Reprise des données existantes : le booléen `essential` devient une essentialité à trois
-- états, et les deux seuls groupes qui portaient une sémantique de calcul sont convertis.
update public.expense_categories set essentiality = 'ESSENTIAL' where essential and essentiality = 'UNKNOWN';
update public.expense_categories set essentiality = 'NON_ESSENTIAL' where not essential and essentiality = 'UNKNOWN';
update public.expense_categories set cash_flow_kind = 'INCOME' where group_name = 'Revenus' and cash_flow_kind = 'EXPENSE';
update public.expense_categories set cash_flow_kind = 'INVESTMENT' where group_name = 'Épargne' and cash_flow_kind = 'EXPENSE';

comment on column public.expense_categories.cash_flow_kind is
  'Nature économique canonique des flux de la catégorie. Seule source de vérité du moteur : le libellé n''a aucun rôle de calcul.';
comment on column public.expense_categories.essentiality is 'ESSENTIAL / NON_ESSENTIAL / UNKNOWN. Alimente la couverture de liquidité.';
comment on column public.expense_categories.expense_behavior is 'FIXED / VARIABLE / DISCRETIONARY / UNKNOWN.';

-- 2. Override de nature et rapprochement des transferts, au niveau de la transaction.
alter table public.transactions
  add column if not exists kind_override text,
  add column if not exists transfer_group_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_kind_override_ck') then
    alter table public.transactions add constraint transactions_kind_override_ck
      check (kind_override is null or kind_override in ('INCOME','EXPENSE','INTERNAL_TRANSFER','INVESTMENT','SAVING',
                                'DEBT_SERVICE','TAX','REFUND','OTHER_INFLOW','OTHER_OUTFLOW','UNCLASSIFIED'));
  end if;
end $$;

create index if not exists transactions_transfer_group_idx on public.transactions(transfer_group_id)
  where transfer_group_id is not null;

comment on column public.transactions.kind_override is
  'Nature imposée à cette ligne, prioritaire sur celle de sa catégorie. Sert notamment à marquer un transfert interne.';
comment on column public.transactions.transfer_group_id is
  'Relie les deux jambes d''un transfert interne. Un groupe dont les jambes ne s''annulent pas est signalé comme non rapproché.';

-- 3. Règles de flux récurrents. Aucune récurrence n'est jamais déduite en silence.
create table if not exists public.recurring_cash_flow_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cash_flow_kind text not null,
  category_id uuid not null references public.expense_categories(id),
  account_id uuid references public.financial_accounts(id),
  amount numeric(20,6) not null,
  frequency text not null,
  start_date date not null,
  end_date date,
  day_of_month integer,
  active boolean not null default true,
  data_kind text not null,
  confidence text not null,
  source text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recurring_rules_frequency_ck') then
    alter table public.recurring_cash_flow_rules add constraint recurring_rules_frequency_ck
      check (frequency in ('MONTHLY','QUARTERLY','ANNUAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recurring_rules_day_ck') then
    alter table public.recurring_cash_flow_rules add constraint recurring_rules_day_ck
      check (day_of_month is null or (day_of_month between 1 and 31));
  end if;
end $$;

create index if not exists recurring_rules_user_idx on public.recurring_cash_flow_rules(user_id, active);

-- 4. Clôture mensuelle du périmètre Cash Flow, versionnée : jamais d'écrasement silencieux.
create table if not exists public.cash_flow_monthly_closes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  version integer not null,
  income numeric(20,6) not null,
  consumer_expenses numeric(20,6) not null,
  essential_expenses numeric(20,6) not null,
  taxes_paid numeric(20,6) not null,
  debt_service_paid numeric(20,6) not null,
  investment_flows numeric(20,6) not null,
  internal_transfers numeric(20,6) not null,
  operating_surplus_before_debt numeric(20,6) not null,
  post_debt_surplus numeric(20,6) not null,
  unclassified_transaction_count integer not null,
  closed_at timestamptz not null default now(),
  unique(user_id, month, version)
);

create index if not exists cash_flow_closes_user_month_idx on public.cash_flow_monthly_closes(user_id, month desc, version desc);

-- 5. Isolation par utilisateur des deux nouvelles tables.
--
-- La migration initiale posait RLS et la politique `owner_all` en balayant les tables
-- portant une colonne `user_id`. Ce balayage ne s'est exécuté qu'une fois : toute table
-- créée après lui doit poser sa propre isolation, sinon les seuls grants ci-dessous
-- rendraient ses lignes lisibles et modifiables par n'importe quel utilisateur
-- authentifié, tous comptes confondus.
do $$
declare target text;
begin
  foreach target in array array['recurring_cash_flow_rules', 'cash_flow_monthly_closes']
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
