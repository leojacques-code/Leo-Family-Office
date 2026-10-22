-- Pré-contrôles des migrations non appliquées en production (12 octobre 2026).
--
-- LECTURE SEULE. À exécuter par un humain, hors environnement d'agent, dans une transaction
-- `begin read only;` ... `rollback;`, AVANT toute application des migrations 20260914191901 à
-- 20261012090000 sur une base peuplée. Aucune requête n'écrit. Source : audit des migrations
-- de la PR #52 (12 octobre 2026). Une ligne trouvée se DOCUMENTE (CLAUDE.md §5), elle ne se
-- corrige pas en silence.

begin read only;

-- P0 historique
select version from supabase_migrations.schema_migrations order by version desc limit 3;
-- attendu : 20260909190841 en tête, aucune des 18 versions du dépôt postérieures

-- P1 B13 (20260915064740:4-77) : 24 références, attendu 0 partout
select 'account_balances.account_id' ref, count(*) from public.account_balances c join public.financial_accounts p on p.id=c.account_id where c.user_id is distinct from p.user_id
union all select 'asset_classes.parent_id', count(*) from public.asset_classes c join public.asset_classes p on p.id=c.parent_id where c.user_id is distinct from p.user_id
union all select 'bank_institutions.institution_id', count(*) from public.bank_institutions c join public.institutions p on p.id=c.institution_id where c.user_id is distinct from p.user_id
union all select 'budgets.category_id', count(*) from public.budgets c join public.expense_categories p on p.id=c.category_id where c.user_id is distinct from p.user_id
union all select 'business_dcf_periods.dcf_id', count(*) from public.business_dcf_periods c join public.business_dcf_assumptions p on p.id=c.dcf_id where c.user_id is distinct from p.user_id
union all select 'document_metadata.document_id', count(*) from public.document_metadata c join public.documents p on p.id=c.document_id where c.user_id is distinct from p.user_id
union all select 'financial_accounts.institution_id', count(*) from public.financial_accounts c join public.institutions p on p.id=c.institution_id where c.user_id is distinct from p.user_id
union all select 'liability_balance_observations.liability_id', count(*) from public.liability_balance_observations c join public.liabilities p on p.id=c.liability_id where c.user_id is distinct from p.user_id
union all select 'loan_charges.liability_id', count(*) from public.loan_charges c join public.liabilities p on p.id=c.liability_id where c.user_id is distinct from p.user_id
union all select 'loan_early_repayments.liability_id', count(*) from public.loan_early_repayments c join public.liabilities p on p.id=c.liability_id where c.user_id is distinct from p.user_id
union all select 'loan_payment_changes.liability_id', count(*) from public.loan_payment_changes c join public.liabilities p on p.id=c.liability_id where c.user_id is distinct from p.user_id
union all select 'loan_rate_changes.liability_id', count(*) from public.loan_rate_changes c join public.liabilities p on p.id=c.liability_id where c.user_id is distinct from p.user_id
union all select 'loan_schedules.liability_id', count(*) from public.loan_schedules c join public.liabilities p on p.id=c.liability_id where c.user_id is distinct from p.user_id
union all select 'market_assumptions.asset_class_id', count(*) from public.market_assumptions c join public.asset_classes p on p.id=c.asset_class_id where c.user_id is distinct from p.user_id
union all select 'mortgages.property_id', count(*) from public.mortgages c join public.properties p on p.id=c.property_id where c.user_id is distinct from p.user_id
union all select 'position_snapshots.position_id', count(*) from public.position_snapshots c join public.positions p on p.id=c.position_id where c.user_id is distinct from p.user_id
union all select 'positions.account_id', count(*) from public.positions c join public.financial_accounts p on p.id=c.account_id where c.user_id is distinct from p.user_id
union all select 'positions.security_id', count(*) from public.positions c join public.securities p on p.id=c.security_id where c.user_id is distinct from p.user_id
union all select 'real_estate_cashflows.property_id', count(*) from public.real_estate_cashflows c join public.properties p on p.id=c.property_id where c.user_id is distinct from p.user_id
union all select 'recurring_cash_flow_rules.account_id', count(*) from public.recurring_cash_flow_rules c join public.financial_accounts p on p.id=c.account_id where c.user_id is distinct from p.user_id
union all select 'recurring_cash_flow_rules.category_id', count(*) from public.recurring_cash_flow_rules c join public.expense_categories p on p.id=c.category_id where c.user_id is distinct from p.user_id
union all select 'securities.asset_class_id', count(*) from public.securities c join public.asset_classes p on p.id=c.asset_class_id where c.user_id is distinct from p.user_id
union all select 'transactions.account_id', count(*) from public.transactions c join public.financial_accounts p on p.id=c.account_id where c.user_id is distinct from p.user_id
union all select 'transactions.category_id', count(*) from public.transactions c join public.expense_categories p on p.id=c.category_id where c.user_id is distinct from p.user_id;

-- P2 B13 : les 24 noms de FK supprimés doivent exister tels quels (attendu 24 lignes)
select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
 where contype='f' and connamespace='public'::regnamespace and conname in (
 'account_balances_account_id_fkey','asset_classes_parent_id_fkey','bank_institutions_institution_fk',
 'budgets_category_id_fkey','business_dcf_periods_dcf_id_fkey','document_metadata_document_id_fkey',
 'financial_accounts_institution_id_fkey','liability_balance_observations_liability_id_fkey',
 'loan_charges_liability_id_fkey','loan_early_repayments_liability_id_fkey','loan_payment_changes_liability_id_fkey',
 'loan_rate_changes_liability_id_fkey','loan_schedules_liability_id_fkey','market_assumptions_asset_class_id_fkey',
 'mortgages_property_id_fkey','position_snapshots_position_id_fkey','positions_account_id_fkey',
 'positions_security_id_fkey','real_estate_cashflows_property_id_fkey','recurring_cash_flow_rules_account_id_fkey',
 'recurring_cash_flow_rules_category_id_fkey','securities_asset_class_id_fkey','transactions_account_id_fkey',
 'transactions_category_id_fkey');

-- P3 cibles composites présentes (attendu 6 lignes)
select indexname from pg_indexes where schemaname='public' and indexname in
 ('financial_accounts_id_user_uidx','securities_id_user_uidx','properties_id_user_uidx',
  'liabilities_id_user_uidx','positions_id_user_uidx','documents_id_user_uidx');

-- P4 liabilities (081000:43, 170000:29 et 76-82) : attendu 0 / 0 / 0
select
 count(*) filter (where lender is null or principal is null or annual_rate is null or first_payment_date is null
   or rate_type is null or deferral_kind is null or deferral_months is null or deferral_interest_treatment is null
   or amortisation_profile is null or payment_frequency is null or interest_convention is null
   or monthly_payment is null or payment_count is null or maturity_date is null) as completude_ko,
 count(*) filter (where payment_count < 1) as payment_count_ko,
 count(*) filter (where maturity_date < first_payment_date) as dates_ko
from public.liabilities;

-- P5 faits déjà datés dans le futur (110000) : informatif, pas bloquant
select 'transactions', count(*) from public.transactions where transaction_date > (now() at time zone 'Europe/Paris')::date and data_kind not in ('USER_ASSUMPTION','MODEL_ASSUMPTION')
union all select 'account_balances', count(*) from public.account_balances where balance_date > (now() at time zone 'Europe/Paris')::date and data_kind not in ('USER_ASSUMPTION','MODEL_ASSUMPTION')
union all select 'liability_balance_observations', count(*) from public.liability_balance_observations where observed_at > (now() at time zone 'Europe/Paris')::date and data_kind not in ('USER_ASSUMPTION','MODEL_ASSUMPTION');

-- P6 lecture Auth par le propriétaire de la fonction SECURITY DEFINER (191901)
select current_user, has_schema_privilege('auth','usage'),
 has_table_privilege('auth.sessions','select'), has_table_privilege('auth.users','select');
select table_name, column_name from information_schema.columns
 where table_schema='auth' and ((table_name='sessions' and column_name in ('id','user_id','not_after'))
  or (table_name='users' and column_name in ('deleted_at','banned_until')));

-- P7 collisions de noms (attendu : aucune ligne / nulls)
select nspname from pg_namespace where nspname='lfo_private';
select to_regclass('public.transaction_corrections'), to_regclass('public.liability_terms_transitions'),
 to_regclass('public.loan_insurance_policies'), to_regclass('public.form_drafts'),
 to_regclass('public.liability_events'), to_regclass('public.liability_contract_versions');
select column_name from information_schema.columns where table_schema='public'
 and ((table_name='profiles' and column_name in ('first_intent','residence_country','context_date'))
  or (table_name='liabilities' and column_name in ('terms_status','insurance_mode')));
select conname from pg_constraint where conname like 'liabilities_%' and conname in
 ('liabilities_terms_status_ck','liabilities_terms_completeness_ck','liabilities_terms_completeness_v2_ck',
  'liabilities_contract_dates_ck','liabilities_payment_count_ck','liabilities_insurance_mode_ck','liabilities_insurance_consistency_ck');


rollback;
