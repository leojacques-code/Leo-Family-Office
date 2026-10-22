-- B13 : même propriétaire aux deux extrémités des 24 références historiques.
-- Aucune correction automatique de données ; une incohérence bloque la migration.
-- Les noms et actions des FK sont conservés. MATCH SIMPLE garde les liens facultatifs.
do $$ begin
  if exists (select 1 from public.account_balances c join public.financial_accounts p on p.id = c.account_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : account_balances.account_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.asset_classes c join public.asset_classes p on p.id = c.parent_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : asset_classes.parent_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.bank_institutions c join public.institutions p on p.id = c.institution_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : bank_institutions.institution_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.budgets c join public.expense_categories p on p.id = c.category_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : budgets.category_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.business_dcf_periods c join public.business_dcf_assumptions p on p.id = c.dcf_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : business_dcf_periods.dcf_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.document_metadata c join public.documents p on p.id = c.document_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : document_metadata.document_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.financial_accounts c join public.institutions p on p.id = c.institution_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : financial_accounts.institution_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.liability_balance_observations c join public.liabilities p on p.id = c.liability_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : liability_balance_observations.liability_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.loan_charges c join public.liabilities p on p.id = c.liability_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : loan_charges.liability_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.loan_early_repayments c join public.liabilities p on p.id = c.liability_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : loan_early_repayments.liability_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.loan_payment_changes c join public.liabilities p on p.id = c.liability_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : loan_payment_changes.liability_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.loan_rate_changes c join public.liabilities p on p.id = c.liability_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : loan_rate_changes.liability_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.loan_schedules c join public.liabilities p on p.id = c.liability_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : loan_schedules.liability_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.market_assumptions c join public.asset_classes p on p.id = c.asset_class_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : market_assumptions.asset_class_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.mortgages c join public.properties p on p.id = c.property_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : mortgages.property_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.position_snapshots c join public.positions p on p.id = c.position_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : position_snapshots.position_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.positions c join public.financial_accounts p on p.id = c.account_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : positions.account_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.positions c join public.securities p on p.id = c.security_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : positions.security_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.real_estate_cashflows c join public.properties p on p.id = c.property_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : real_estate_cashflows.property_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.recurring_cash_flow_rules c join public.financial_accounts p on p.id = c.account_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : recurring_cash_flow_rules.account_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.recurring_cash_flow_rules c join public.expense_categories p on p.id = c.category_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : recurring_cash_flow_rules.category_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.securities c join public.asset_classes p on p.id = c.asset_class_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : securities.asset_class_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.transactions c join public.financial_accounts p on p.id = c.account_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : transactions.account_id. Corriger explicitement les données avant migration.';
  end if;
  if exists (select 1 from public.transactions c join public.expense_categories p on p.id = c.category_id where c.user_id is distinct from p.user_id) then
    raise exception 'Isolation non conforme : transactions.category_id. Corriger explicitement les données avant migration.';
  end if;
end $$;

create unique index asset_classes_id_user_b13_uidx on public.asset_classes(id, user_id);
create unique index business_dcf_assumptions_id_user_b13_uidx on public.business_dcf_assumptions(id, user_id);
create unique index expense_categories_id_user_b13_uidx on public.expense_categories(id, user_id);
create unique index institutions_id_user_b13_uidx on public.institutions(id, user_id);

alter table public.account_balances
  drop constraint account_balances_account_id_fkey,
  add constraint account_balances_account_id_fkey foreign key (account_id, user_id)
    references public.financial_accounts(id, user_id) match simple on delete cascade;

alter table public.asset_classes
  drop constraint asset_classes_parent_id_fkey,
  add constraint asset_classes_parent_id_fkey foreign key (parent_id, user_id)
    references public.asset_classes(id, user_id) match simple;
create index asset_classes_parent_id_owner_idx on public.asset_classes(parent_id, user_id);

alter table public.bank_institutions
  drop constraint bank_institutions_institution_fk,
  add constraint bank_institutions_institution_fk foreign key (institution_id, user_id)
    references public.institutions(id, user_id) match simple on delete set null (institution_id);
create index bank_institutions_institution_id_owner_idx on public.bank_institutions(institution_id, user_id);

alter table public.budgets
  drop constraint budgets_category_id_fkey,
  add constraint budgets_category_id_fkey foreign key (category_id, user_id)
    references public.expense_categories(id, user_id) match simple;

alter table public.business_dcf_periods
  drop constraint business_dcf_periods_dcf_id_fkey,
  add constraint business_dcf_periods_dcf_id_fkey foreign key (dcf_id, user_id)
    references public.business_dcf_assumptions(id, user_id) match simple on delete cascade;

alter table public.document_metadata
  drop constraint document_metadata_document_id_fkey,
  add constraint document_metadata_document_id_fkey foreign key (document_id, user_id)
    references public.documents(id, user_id) match simple on delete cascade;
create index document_metadata_document_id_owner_idx on public.document_metadata(document_id, user_id);

alter table public.financial_accounts
  drop constraint financial_accounts_institution_id_fkey,
  add constraint financial_accounts_institution_id_fkey foreign key (institution_id, user_id)
    references public.institutions(id, user_id) match simple;
create index financial_accounts_institution_id_owner_idx on public.financial_accounts(institution_id, user_id);

alter table public.liability_balance_observations
  drop constraint liability_balance_observations_liability_id_fkey,
  add constraint liability_balance_observations_liability_id_fkey foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) match simple on delete cascade;
create index liability_balance_observations_liability_id_owner_idx on public.liability_balance_observations(liability_id, user_id);

alter table public.loan_charges
  drop constraint loan_charges_liability_id_fkey,
  add constraint loan_charges_liability_id_fkey foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) match simple on delete cascade;
create index loan_charges_liability_id_owner_idx on public.loan_charges(liability_id, user_id);

alter table public.loan_early_repayments
  drop constraint loan_early_repayments_liability_id_fkey,
  add constraint loan_early_repayments_liability_id_fkey foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) match simple on delete cascade;
create index loan_early_repayments_liability_id_owner_idx on public.loan_early_repayments(liability_id, user_id);

alter table public.loan_payment_changes
  drop constraint loan_payment_changes_liability_id_fkey,
  add constraint loan_payment_changes_liability_id_fkey foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) match simple on delete cascade;
create index loan_payment_changes_liability_id_owner_idx on public.loan_payment_changes(liability_id, user_id);

alter table public.loan_rate_changes
  drop constraint loan_rate_changes_liability_id_fkey,
  add constraint loan_rate_changes_liability_id_fkey foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) match simple on delete cascade;
create index loan_rate_changes_liability_id_owner_idx on public.loan_rate_changes(liability_id, user_id);

alter table public.loan_schedules
  drop constraint loan_schedules_liability_id_fkey,
  add constraint loan_schedules_liability_id_fkey foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) match simple on delete cascade;
create index loan_schedules_liability_id_owner_idx on public.loan_schedules(liability_id, user_id);

alter table public.market_assumptions
  drop constraint market_assumptions_asset_class_id_fkey,
  add constraint market_assumptions_asset_class_id_fkey foreign key (asset_class_id, user_id)
    references public.asset_classes(id, user_id) match simple;
create index market_assumptions_asset_class_id_owner_idx on public.market_assumptions(asset_class_id, user_id);

alter table public.mortgages
  drop constraint mortgages_property_id_fkey,
  add constraint mortgages_property_id_fkey foreign key (property_id, user_id)
    references public.properties(id, user_id) match simple on delete cascade;
create index mortgages_property_id_owner_idx on public.mortgages(property_id, user_id);

alter table public.position_snapshots
  drop constraint position_snapshots_position_id_fkey,
  add constraint position_snapshots_position_id_fkey foreign key (position_id, user_id)
    references public.positions(id, user_id) match simple on delete cascade;

alter table public.positions
  drop constraint positions_account_id_fkey,
  add constraint positions_account_id_fkey foreign key (account_id, user_id)
    references public.financial_accounts(id, user_id) match simple on delete cascade;

alter table public.positions
  drop constraint positions_security_id_fkey,
  add constraint positions_security_id_fkey foreign key (security_id, user_id)
    references public.securities(id, user_id) match simple;
create index positions_security_id_owner_idx on public.positions(security_id, user_id);

alter table public.real_estate_cashflows
  drop constraint real_estate_cashflows_property_id_fkey,
  add constraint real_estate_cashflows_property_id_fkey foreign key (property_id, user_id)
    references public.properties(id, user_id) match simple on delete cascade;
create index real_estate_cashflows_property_id_owner_idx on public.real_estate_cashflows(property_id, user_id);

alter table public.recurring_cash_flow_rules
  drop constraint recurring_cash_flow_rules_account_id_fkey,
  add constraint recurring_cash_flow_rules_account_id_fkey foreign key (account_id, user_id)
    references public.financial_accounts(id, user_id) match simple;
create index recurring_cash_flow_rules_account_id_owner_idx on public.recurring_cash_flow_rules(account_id, user_id);

alter table public.recurring_cash_flow_rules
  drop constraint recurring_cash_flow_rules_category_id_fkey,
  add constraint recurring_cash_flow_rules_category_id_fkey foreign key (category_id, user_id)
    references public.expense_categories(id, user_id) match simple;
create index recurring_cash_flow_rules_category_id_owner_idx on public.recurring_cash_flow_rules(category_id, user_id);

alter table public.securities
  drop constraint securities_asset_class_id_fkey,
  add constraint securities_asset_class_id_fkey foreign key (asset_class_id, user_id)
    references public.asset_classes(id, user_id) match simple;
create index securities_asset_class_id_owner_idx on public.securities(asset_class_id, user_id);

alter table public.transactions
  drop constraint transactions_account_id_fkey,
  add constraint transactions_account_id_fkey foreign key (account_id, user_id)
    references public.financial_accounts(id, user_id) match simple;
create index transactions_account_id_owner_idx on public.transactions(account_id, user_id);

alter table public.transactions
  drop constraint transactions_category_id_fkey,
  add constraint transactions_category_id_fkey foreign key (category_id, user_id)
    references public.expense_categories(id, user_id) match simple;
create index transactions_category_id_owner_idx on public.transactions(category_id, user_id);
