-- Business Equity V2.1 — Valuation Engine.
--
-- V2 persistait le RÉSULTAT d'une valorisation (Enterprise Value, Equity Value) saisi par
-- l'utilisateur derrière un simple libellé de méthode. C'était une seconde vérité : le
-- moteur ne dérivait rien, il recopiait. V2.1 inverse la charge.
--
-- RÈGLE FONDATRICE DE CETTE MIGRATION
-- -----------------------------------
-- Une valorisation DÉRIVÉE n'est jamais persistée. Les tables ne portent plus que des
-- FAITS et des HYPOTHÈSES DÉCLARÉES : un multiple, une base financière, des ajustements
-- d'EBITDA, des éléments de bridge, des paramètres de DCF, les termes d'une levée. EV et
-- Equity Value ne restent stockables que sur les chemins où elles sont réellement
-- OBSERVÉES (appraisal externe, transaction, estimation utilisateur assumée comme telle),
-- et une contrainte de base l'impose : sur une méthode dérivée, les deux colonnes sont
-- obligatoirement nulles. PostgreSQL persiste, TypeScript calcule.
--
-- Migration strictement additive. Les contraintes remplacées le sont sous un nouveau nom,
-- et les données existantes sont mises en conformité sans perte : une ligne V2 qui portait
-- un montant saisi sous un libellé de méthode dérivée devient explicitement une estimation
-- utilisateur, son libellé d'origine conservé en note.

-- ─── 1. Sociétés : couverture d'historique et identité ──────────────────────────────────
-- L'absence d'événement de capital n'est pas un historique complet à zéro. Tant que
-- l'utilisateur n'a pas DÉCLARÉ que l'historique est exhaustif, un coût de revient ou un
-- cash retourné dérivé des seuls événements connus reste une borne, pas un fait.
alter table public.businesses
  add column if not exists capital_history_start date,
  add column if not exists capital_history_source text not null default 'UNKNOWN',
  add column if not exists sector text,
  add column if not exists country char(2),
  add column if not exists founded_on date;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='businesses_capital_history_source_ck') then
    alter table public.businesses add constraint businesses_capital_history_source_ck
      check (capital_history_source in ('DECLARED_COMPLETE','PARTIAL','UNKNOWN'));
  end if;
  if not exists(select 1 from pg_constraint where conname='businesses_capital_history_start_ck') then
    alter table public.businesses add constraint businesses_capital_history_start_ck
      check (capital_history_source <> 'DECLARED_COMPLETE' or capital_history_start is not null);
  end if;
end $$;

-- ─── 2. Détention : cap table réelle ────────────────────────────────────────────────────
-- Les taux restent la vérité minimale. Quand les nombres de titres sont connus, ils sont
-- la vérité PLUS FINE : le moteur en dérive le taux et signale toute contradiction plutôt
-- que d'arbitrer silencieusement.
alter table public.business_ownership
  add column if not exists shares_held numeric(24,6),
  add column if not exists shares_outstanding numeric(24,6),
  add column if not exists fully_diluted_shares numeric(24,6),
  add column if not exists share_class text,
  add column if not exists origin_event_id uuid,
  add column if not exists updated_at timestamptz not null default now();

-- Une cession totale porte la détention à 0. L'ancienne contrainte l'interdisait
-- (`> 0`), ce qui rendait une sortie complète INSAISISSABLE : le produit ne pouvait pas
-- représenter le fait le plus banal de la vie d'une participation.
alter table public.business_ownership drop constraint if exists business_ownership_rates_ck;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='business_ownership_rates_v2_ck') then
    alter table public.business_ownership add constraint business_ownership_rates_v2_ck check (
      ownership_rate >= 0 and ownership_rate <= 1 and
      (economic_rate is null or (economic_rate >= 0 and economic_rate <= 1)) and
      (voting_rate is null or (voting_rate >= 0 and voting_rate <= 1)) and
      (fully_diluted_rate is null or (fully_diluted_rate >= 0 and fully_diluted_rate <= 1))
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='business_ownership_shares_ck') then
    alter table public.business_ownership add constraint business_ownership_shares_ck check (
      (shares_held is null or shares_held >= 0) and
      (shares_outstanding is null or shares_outstanding > 0) and
      (fully_diluted_shares is null or fully_diluted_shares > 0) and
      (shares_held is null or shares_outstanding is null or shares_held <= shares_outstanding) and
      (fully_diluted_shares is null or shares_outstanding is null or fully_diluted_shares >= shares_outstanding)
    );
  end if;
end $$;

-- ─── 3. Historique financier : périodes qualifiées ──────────────────────────────────────
-- N-2, N-1, N et LTM ne sont pas la même grandeur. Une marge comparée entre un exercice de
-- douze mois et un cumul glissant sans le dire est une comparaison fausse.
alter table public.business_financials
  add column if not exists period_kind text not null default 'ANNUAL',
  add column if not exists period_start date,
  add column if not exists period_label text,
  add column if not exists gross_profit numeric(20,6),
  add column if not exists depreciation_amortisation numeric(20,6),
  add column if not exists interest_expense numeric(20,6),
  add column if not exists tax_expense numeric(20,6),
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists(select 1 from pg_constraint where conname='business_financials_period_kind_ck') then
    alter table public.business_financials add constraint business_financials_period_kind_ck
      check (period_kind in ('ANNUAL','LTM','INTERIM'));
  end if;
  if not exists(select 1 from pg_constraint where conname='business_financials_period_order_ck') then
    alter table public.business_financials add constraint business_financials_period_order_ck
      check (period_start is null or period_start < period_end);
  end if;
  if not exists(select 1 from pg_constraint where conname='business_financials_non_negative_ck') then
    alter table public.business_financials add constraint business_financials_non_negative_ck
      check (
        (cash is null or cash >= 0) and (debt is null or debt >= 0) and
        (capex is null or capex >= 0) and
        (depreciation_amortisation is null or depreciation_amortisation >= 0)
      );
  end if;
end $$;

-- ─── 4. Valorisation : des HYPOTHÈSES, plus un résultat ─────────────────────────────────
alter table public.business_valuations
  add column if not exists multiple_low numeric(20,8),
  add column if not exists multiple_high numeric(20,8),
  add column if not exists metric_basis text,
  add column if not exists metric_period_end date,
  add column if not exists pre_money_equity_value numeric(20,6),
  add column if not exists primary_new_money numeric(20,6),
  add column if not exists secondary_amount numeric(20,6),
  add column if not exists investor_contribution numeric(20,6),
  add column if not exists preferred_rights_known boolean,
  add column if not exists updated_at timestamptz not null default now();

-- Mise en conformité des données existantes AVANT la contrainte. Une ligne V2 portant un
-- montant saisi sous un libellé de méthode dérivée n'était pas une valorisation dérivée :
-- c'était une estimation utilisateur mal nommée. Elle est renommée pour ce qu'elle est,
-- son libellé d'origine conservé.
update public.business_valuations
set method = 'USER_ESTIMATE',
    data_kind = 'USER_ASSUMPTION',
    confidence = 'LOW',
    notes = trim(both from coalesce(notes || ' — ', '') ||
      'Méthode déclarée avant Business Equity V2.1 : ' || method ||
      '. Le montant saisi est conservé comme estimation utilisateur, jamais comme résultat de méthode.')
where method in ('EBITDA_MULTIPLE','REVENUE_MULTIPLE','DCF','FUNDING_ROUND','LOOK_THROUGH')
  and (enterprise_value is not null or equity_value is not null);

alter table public.business_valuations drop constraint if exists business_valuations_value_ck;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='business_valuations_method_ck') then
    alter table public.business_valuations add constraint business_valuations_method_ck
      check (method in ('EBITDA_MULTIPLE','REVENUE_MULTIPLE','DCF','FUNDING_ROUND',
                        'EXTERNAL_APPRAISAL','TRANSACTION','USER_ESTIMATE','LOOK_THROUGH'));
  end if;
  -- Le cœur de V2.1 : une méthode dérivée ne persiste JAMAIS son résultat.
  if not exists(select 1 from pg_constraint where conname='business_valuations_basis_v2_ck') then
    alter table public.business_valuations add constraint business_valuations_basis_v2_ck check (
      case
        when method in ('EBITDA_MULTIPLE','REVENUE_MULTIPLE') then
          valuation_multiple is not null and enterprise_value is null and equity_value is null
        when method in ('DCF','LOOK_THROUGH') then
          enterprise_value is null and equity_value is null
        when method = 'FUNDING_ROUND' then
          pre_money_equity_value is not null and primary_new_money is not null
          and enterprise_value is null and equity_value is null
        else
          enterprise_value is not null or equity_value is not null
      end
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='business_valuations_multiple_ck') then
    alter table public.business_valuations add constraint business_valuations_multiple_ck check (
      (valuation_multiple is null or valuation_multiple > 0) and
      (multiple_low is null or (multiple_low > 0 and valuation_multiple is not null and multiple_low <= valuation_multiple)) and
      (multiple_high is null or (valuation_multiple is not null and multiple_high >= valuation_multiple))
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='business_valuations_metric_basis_ck') then
    alter table public.business_valuations add constraint business_valuations_metric_basis_ck
      check (metric_basis is null or metric_basis in ('EBITDA','REVENUE','EBIT'));
  end if;
  if not exists(select 1 from pg_constraint where conname='business_valuations_round_ck') then
    alter table public.business_valuations add constraint business_valuations_round_ck check (
      (pre_money_equity_value is null or pre_money_equity_value >= 0) and
      (primary_new_money is null or primary_new_money >= 0) and
      (secondary_amount is null or secondary_amount >= 0) and
      (investor_contribution is null or investor_contribution >= 0)
    );
  end if;
end $$;

-- Deux valorisations peuvent coexister à la même date si elles viennent de MÉTHODES
-- différentes : c'est le cas réel d'un appraisal et d'une offre de transaction divergentes.
-- L'unicité par date seule les rendait mutuellement exclusives et effaçait le conflit.
drop index if exists public.business_valuations_effective_uk;
create unique index if not exists business_valuations_effective_method_uk
  on public.business_valuations(user_id, business_id, valuation_date, method);

-- ─── 5. Ajustements d'EBITDA ────────────────────────────────────────────────────────────
-- Un EBITDA ajusté sans traçabilité est un EBITDA inventé. Chaque retraitement est une
-- ligne datée, catégorisée, signée et justifiable.
create table if not exists public.business_ebitda_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null,
  period_end date not null,
  category text not null,
  label text not null,
  amount numeric(20,6) not null,
  currency char(3) not null,
  recurring boolean not null default false,
  data_kind text not null default 'USER_ASSUMPTION',
  confidence text not null default 'MEDIUM',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint business_ebitda_adjustments_business_fk
    foreign key (business_id, user_id) references public.businesses(id, user_id) on delete cascade,
  constraint business_ebitda_adjustments_category_ck
    check (category in ('OWNER_COMPENSATION','EXCEPTIONAL','NON_RECURRING','PRO_FORMA','OTHER')),
  constraint business_ebitda_adjustments_data_kind_ck
    check (data_kind in ('ACTUAL','USER_ASSUMPTION','MODEL_ASSUMPTION','EXTERNAL_DATA','DERIVED')),
  constraint business_ebitda_adjustments_label_uk unique (user_id, business_id, period_end, label)
);

-- ─── 6. Éléments de bridge EV → Equity ──────────────────────────────────────────────────
-- Cash et dette brute ne sont pas les seuls termes du pont. Les autres existent ou
-- n'existent pas : ils ne sont jamais supposés nuls, ils sont déclarés.
create table if not exists public.business_bridge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null,
  effective_date date not null,
  category text not null,
  label text not null,
  amount numeric(20,6) not null,
  currency char(3) not null,
  data_kind text not null default 'USER_ASSUMPTION',
  confidence text not null default 'MEDIUM',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint business_bridge_items_business_fk
    foreign key (business_id, user_id) references public.businesses(id, user_id) on delete cascade,
  constraint business_bridge_items_category_ck
    check (category in ('MINORITY_INTERESTS','PENSION_PROVISION','EARN_OUT','SHAREHOLDER_LOAN',
                        'SURPLUS_ASSET','TRANSACTION_COST','OTHER')),
  constraint business_bridge_items_data_kind_ck
    check (data_kind in ('ACTUAL','USER_ASSUMPTION','MODEL_ASSUMPTION','EXTERNAL_DATA','DERIVED')),
  constraint business_bridge_items_label_uk unique (user_id, business_id, effective_date, label)
);

-- ─── 7. DCF : hypothèses explicites, jamais implicites ──────────────────────────────────
create table if not exists public.business_dcf_assumptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null,
  valuation_date date not null,
  currency char(3) not null,
  wacc numeric(12,8) not null,
  tax_rate numeric(12,8) not null,
  terminal_method text not null,
  terminal_growth numeric(12,8),
  terminal_exit_multiple numeric(20,8),
  terminal_exit_metric text,
  discount_convention text not null default 'YEAR_END',
  data_kind text not null default 'USER_ASSUMPTION',
  confidence text not null default 'LOW',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_dcf_assumptions_business_fk
    foreign key (business_id, user_id) references public.businesses(id, user_id) on delete cascade,
  constraint business_dcf_assumptions_wacc_ck check (wacc > 0 and wacc < 1),
  constraint business_dcf_assumptions_tax_ck check (tax_rate >= 0 and tax_rate < 1),
  constraint business_dcf_assumptions_terminal_ck check (
    case terminal_method
      when 'PERPETUAL_GROWTH' then terminal_growth is not null and terminal_growth < wacc
      when 'EXIT_MULTIPLE' then terminal_exit_multiple is not null and terminal_exit_multiple > 0
                                and terminal_exit_metric in ('EBITDA','EBIT')
      else false
    end
  ),
  constraint business_dcf_assumptions_convention_ck
    check (discount_convention in ('YEAR_END','MID_YEAR')),
  constraint business_dcf_assumptions_effective_uk unique (user_id, business_id, valuation_date)
);

create table if not exists public.business_dcf_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dcf_id uuid not null references public.business_dcf_assumptions(id) on delete cascade,
  year_index integer not null,
  revenue numeric(20,6),
  ebitda numeric(20,6),
  ebit numeric(20,6),
  depreciation_amortisation numeric(20,6),
  capex numeric(20,6),
  working_capital_change numeric(20,6),
  notes text,
  created_at timestamptz not null default now(),
  constraint business_dcf_periods_year_ck check (year_index >= 1 and year_index <= 30),
  constraint business_dcf_periods_non_negative_ck check (
    (capex is null or capex >= 0) and
    (depreciation_amortisation is null or depreciation_amortisation >= 0)
  ),
  constraint business_dcf_periods_year_uk unique (user_id, dcf_id, year_index)
);

-- ─── 8. Événements de capital : distribution société ≠ cash reçu ────────────────────────
-- « Dividende » désignait indistinctement les deux. Un dividende de 100 k€ voté par une
-- société détenue à 30 % n'apporte pas 100 k€ à l'utilisateur : `amount_scope` dit
-- laquelle des deux grandeurs a été saisie, et le moteur ne confond plus jamais l'une
-- avec l'autre.
alter table public.business_capital_events
  add column if not exists amount_scope text not null default 'USER_CASH',
  add column if not exists fees numeric(20,6),
  add column if not exists ownership_rate_after numeric(12,8),
  add column if not exists shares_delta numeric(24,6),
  add column if not exists price_per_share numeric(20,8),
  add column if not exists label text;

alter table public.business_capital_events drop constraint if exists business_capital_events_type_ck;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='business_capital_events_type_v2_ck') then
    alter table public.business_capital_events add constraint business_capital_events_type_v2_ck
      check (event_type in ('OPENING_COST_BASIS','ACQUISITION','CAPITAL_INJECTION','SALE',
                            'BUYBACK','DIVIDEND','DISTRIBUTION','CAPITAL_RETURN'));
  end if;
  if not exists(select 1 from pg_constraint where conname='business_capital_events_amount_scope_ck') then
    alter table public.business_capital_events add constraint business_capital_events_amount_scope_ck
      check (amount_scope in ('USER_CASH','COMPANY_TOTAL'));
  end if;
  -- Le périmètre société n'a de sens que pour une distribution : un coût d'acquisition
  -- « au niveau société » ne veut rien dire.
  if not exists(select 1 from pg_constraint where conname='business_capital_events_scope_domain_ck') then
    alter table public.business_capital_events add constraint business_capital_events_scope_domain_ck
      check (amount_scope = 'USER_CASH' or event_type in ('DIVIDEND','DISTRIBUTION','CAPITAL_RETURN'));
  end if;
  if not exists(select 1 from pg_constraint where conname='business_capital_events_fees_ck') then
    alter table public.business_capital_events add constraint business_capital_events_fees_ck
      check (fees is null or fees >= 0);
  end if;
  if not exists(select 1 from pg_constraint where conname='business_capital_events_ownership_after_ck') then
    alter table public.business_capital_events add constraint business_capital_events_ownership_after_ck
      check (ownership_rate_after is null or (ownership_rate_after >= 0 and ownership_rate_after <= 1));
  end if;
end $$;

-- Cible composite de la FK de propriété : une ligne de détention ne peut être rattachée
-- qu'à un événement du MÊME propriétaire.
create unique index if not exists business_capital_events_id_user_uidx
  on public.business_capital_events(id, user_id);

do $$ begin
  if not exists(select 1 from pg_constraint where conname='business_ownership_origin_event_fk') then
    alter table public.business_ownership add constraint business_ownership_origin_event_fk
      foreign key (origin_event_id, user_id)
      references public.business_capital_events(id, user_id) on delete set null (origin_event_id);
  end if;
end $$;

-- ─── 9. RLS et droits ───────────────────────────────────────────────────────────────────
alter table public.business_ebitda_adjustments enable row level security;
alter table public.business_bridge_items enable row level security;
alter table public.business_dcf_assumptions enable row level security;
alter table public.business_dcf_periods enable row level security;

drop policy if exists owner_all on public.business_ebitda_adjustments;
create policy owner_all on public.business_ebitda_adjustments for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists owner_all on public.business_bridge_items;
create policy owner_all on public.business_bridge_items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists owner_all on public.business_dcf_assumptions;
create policy owner_all on public.business_dcf_assumptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists owner_all on public.business_dcf_periods;
create policy owner_all on public.business_dcf_periods for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.business_ebitda_adjustments, public.business_bridge_items,
  public.business_dcf_assumptions, public.business_dcf_periods from anon;
grant select, insert, update, delete on public.business_ebitda_adjustments,
  public.business_bridge_items, public.business_dcf_assumptions,
  public.business_dcf_periods to authenticated;

-- ─── 10. RPC : écritures composées, réservées à service_role ────────────────────────────
-- Ces fonctions ne calculent rien. Elles persistent des résultats déjà dérivés en
-- TypeScript et garantissent l'atomicité des écritures multi-tables.

create or replace function public.lfo_save_business(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid := nullif(p_payload->>'business_id','')::uuid;
begin
  if nullif(p_payload->>'name','') is null then raise exception 'Nom de société requis'; end if;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.businesses(
      id,user_id,name,legal_form,status,business_type,functional_currency,archived,
      sector,country,founded_on,capital_history_start,capital_history_source,
      data_kind,confidence,source,notes,updated_at
    ) values(
      v_id,p_user_id,p_payload->>'name',nullif(p_payload->>'legal_form',''),'ACTIVE',
      nullif(p_payload->>'business_type',''),upper(nullif(p_payload->>'functional_currency','')),false,
      nullif(p_payload->>'sector',''),upper(nullif(p_payload->>'country','')),
      nullif(p_payload->>'founded_on','')::date,nullif(p_payload->>'capital_history_start','')::date,
      coalesce(nullif(p_payload->>'capital_history_source',''),'UNKNOWN'),
      'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now()
    );
  else
    update public.businesses set
      name=p_payload->>'name',
      legal_form=nullif(p_payload->>'legal_form',''),
      business_type=nullif(p_payload->>'business_type',''),
      functional_currency=upper(nullif(p_payload->>'functional_currency','')),
      sector=nullif(p_payload->>'sector',''),
      country=upper(nullif(p_payload->>'country','')),
      founded_on=nullif(p_payload->>'founded_on','')::date,
      capital_history_start=nullif(p_payload->>'capital_history_start','')::date,
      capital_history_source=coalesce(nullif(p_payload->>'capital_history_source',''),'UNKNOWN'),
      notes=nullif(p_payload->>'notes',''),
      updated_at=now()
    where id=v_id and user_id=p_user_id;
    if not found then raise exception 'Société introuvable'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.lfo_record_business_ownership(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  insert into public.business_ownership(
    user_id,business_id,ownership_rate,economic_rate,voting_rate,fully_diluted_rate,
    shares_held,shares_outstanding,fully_diluted_shares,share_class,origin_event_id,
    effective_date,data_kind,confidence,source,notes,updated_at
  ) values(
    p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'legal_rate')::numeric,
    nullif(p_payload->>'economic_rate','')::numeric,nullif(p_payload->>'voting_rate','')::numeric,
    nullif(p_payload->>'fully_diluted_rate','')::numeric,
    nullif(p_payload->>'shares_held','')::numeric,nullif(p_payload->>'shares_outstanding','')::numeric,
    nullif(p_payload->>'fully_diluted_shares','')::numeric,nullif(p_payload->>'share_class',''),
    nullif(p_payload->>'origin_event_id','')::uuid,
    (p_payload->>'effective_date')::date,
    coalesce(nullif(p_payload->>'data_kind',''),'USER_ASSUMPTION'),
    coalesce(nullif(p_payload->>'confidence',''),'HIGH'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now()
  )
  on conflict(user_id,business_id,effective_date) do update set
    ownership_rate=excluded.ownership_rate, economic_rate=excluded.economic_rate,
    voting_rate=excluded.voting_rate, fully_diluted_rate=excluded.fully_diluted_rate,
    shares_held=excluded.shares_held, shares_outstanding=excluded.shares_outstanding,
    fully_diluted_shares=excluded.fully_diluted_shares, share_class=excluded.share_class,
    origin_event_id=excluded.origin_event_id, data_kind=excluded.data_kind,
    confidence=excluded.confidence, source=excluded.source, notes=excluded.notes, updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.lfo_delete_business_ownership(p_user_id uuid, p_ownership_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  delete from public.business_ownership where id=p_ownership_id and user_id=p_user_id;
  if not found then raise exception 'Détention introuvable'; end if;
  return p_ownership_id;
end $$;

create or replace function public.lfo_record_business_financials(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  insert into public.business_financials(
    id,user_id,business_id,period_end,period_start,period_kind,period_label,
    revenue,gross_profit,gross_margin,ebitda,ebit,net_income,cash,debt,
    working_capital,capex,free_cash_flow,depreciation_amortisation,interest_expense,tax_expense,
    currency,data_kind,confidence,source,notes
  ) values(
    gen_random_uuid(),p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'period_end')::date,
    nullif(p_payload->>'period_start','')::date,coalesce(nullif(p_payload->>'period_kind',''),'ANNUAL'),
    nullif(p_payload->>'period_label',''),
    nullif(p_payload->>'revenue','')::numeric,nullif(p_payload->>'gross_profit','')::numeric,null,
    nullif(p_payload->>'ebitda','')::numeric,nullif(p_payload->>'ebit','')::numeric,
    nullif(p_payload->>'net_income','')::numeric,nullif(p_payload->>'cash','')::numeric,
    nullif(p_payload->>'gross_debt','')::numeric,nullif(p_payload->>'working_capital','')::numeric,
    nullif(p_payload->>'capex','')::numeric,nullif(p_payload->>'free_cash_flow','')::numeric,
    nullif(p_payload->>'depreciation_amortisation','')::numeric,
    nullif(p_payload->>'interest_expense','')::numeric,nullif(p_payload->>'tax_expense','')::numeric,
    upper(nullif(p_payload->>'currency','')),coalesce(nullif(p_payload->>'data_kind',''),'ACTUAL'),
    coalesce(nullif(p_payload->>'confidence',''),'HIGH'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')
  )
  on conflict(user_id,business_id,period_end) do update set
    period_start=excluded.period_start, period_kind=excluded.period_kind,
    period_label=excluded.period_label, revenue=excluded.revenue,
    gross_profit=excluded.gross_profit, ebitda=excluded.ebitda, ebit=excluded.ebit,
    net_income=excluded.net_income, cash=excluded.cash, debt=excluded.debt,
    working_capital=excluded.working_capital, capex=excluded.capex,
    free_cash_flow=excluded.free_cash_flow,
    depreciation_amortisation=excluded.depreciation_amortisation,
    interest_expense=excluded.interest_expense, tax_expense=excluded.tax_expense,
    currency=excluded.currency, data_kind=excluded.data_kind, confidence=excluded.confidence,
    source=excluded.source, notes=excluded.notes, updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.lfo_delete_business_financials(p_user_id uuid, p_financials_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  delete from public.business_financials where id=p_financials_id and user_id=p_user_id;
  if not found then raise exception 'Période financière introuvable'; end if;
  return p_financials_id;
end $$;

create or replace function public.lfo_record_business_valuation(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  insert into public.business_valuations(
    id,user_id,business_id,valuation_date,method,enterprise_value,equity_value,assumptions,
    data_kind,currency,valuation_multiple,multiple_low,multiple_high,metric_basis,metric_period_end,
    pre_money_equity_value,primary_new_money,secondary_amount,investor_contribution,
    preferred_rights_known,confidence,source,notes,updated_at
  ) values(
    gen_random_uuid(),p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'valuation_date')::date,
    p_payload->>'method',nullif(p_payload->>'enterprise_value','')::numeric,
    nullif(p_payload->>'equity_value','')::numeric,coalesce(p_payload->'assumptions','{}'::jsonb),
    coalesce(nullif(p_payload->>'data_kind',''),'USER_ASSUMPTION'),
    upper(nullif(p_payload->>'currency','')),nullif(p_payload->>'valuation_multiple','')::numeric,
    nullif(p_payload->>'multiple_low','')::numeric,nullif(p_payload->>'multiple_high','')::numeric,
    nullif(p_payload->>'metric_basis',''),nullif(p_payload->>'metric_period_end','')::date,
    nullif(p_payload->>'pre_money_equity_value','')::numeric,
    nullif(p_payload->>'primary_new_money','')::numeric,
    nullif(p_payload->>'secondary_amount','')::numeric,
    nullif(p_payload->>'investor_contribution','')::numeric,
    (p_payload->>'preferred_rights_known')::boolean,
    coalesce(nullif(p_payload->>'confidence',''),'MEDIUM'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now()
  )
  on conflict(user_id,business_id,valuation_date,method) do update set
    enterprise_value=excluded.enterprise_value, equity_value=excluded.equity_value,
    assumptions=excluded.assumptions, data_kind=excluded.data_kind, currency=excluded.currency,
    valuation_multiple=excluded.valuation_multiple, multiple_low=excluded.multiple_low,
    multiple_high=excluded.multiple_high, metric_basis=excluded.metric_basis,
    metric_period_end=excluded.metric_period_end,
    pre_money_equity_value=excluded.pre_money_equity_value,
    primary_new_money=excluded.primary_new_money, secondary_amount=excluded.secondary_amount,
    investor_contribution=excluded.investor_contribution,
    preferred_rights_known=excluded.preferred_rights_known,
    confidence=excluded.confidence, source=excluded.source, notes=excluded.notes, updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.lfo_delete_business_valuation(p_user_id uuid, p_valuation_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  delete from public.business_valuations where id=p_valuation_id and user_id=p_user_id;
  if not found then raise exception 'Valorisation introuvable'; end if;
  return p_valuation_id;
end $$;

create or replace function public.lfo_record_business_capital_event(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.business_capital_events(
    id,user_id,business_id,event_type,event_date,amount,amount_scope,fees,currency,
    ownership_delta,ownership_rate_after,shares_delta,price_per_share,label,
    transaction_id,data_kind,confidence,source,notes
  ) values(
    v_id,p_user_id,(p_payload->>'business_id')::uuid,p_payload->>'event_type',
    (p_payload->>'event_date')::date,(p_payload->>'amount')::numeric,
    coalesce(nullif(p_payload->>'amount_scope',''),'USER_CASH'),
    nullif(p_payload->>'fees','')::numeric,upper(p_payload->>'currency'),
    nullif(p_payload->>'ownership_delta','')::numeric,
    nullif(p_payload->>'ownership_rate_after','')::numeric,
    nullif(p_payload->>'shares_delta','')::numeric,
    nullif(p_payload->>'price_per_share','')::numeric,
    nullif(p_payload->>'label',''),nullif(p_payload->>'transaction_id','')::uuid,
    coalesce(nullif(p_payload->>'data_kind',''),'ACTUAL'),
    coalesce(nullif(p_payload->>'confidence',''),'HIGH'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')
  );
  return v_id;
end $$;

create or replace function public.lfo_delete_business_capital_event(p_user_id uuid, p_event_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  delete from public.business_capital_events where id=p_event_id and user_id=p_user_id;
  if not found then raise exception 'Événement de capital introuvable'; end if;
  return p_event_id;
end $$;

create or replace function public.lfo_delete_business_holding(p_user_id uuid, p_holding_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  delete from public.business_holdings where id=p_holding_id and user_id=p_user_id;
  if not found then raise exception 'Rattachement holding introuvable'; end if;
  return p_holding_id;
end $$;

create or replace function public.lfo_record_business_ebitda_adjustment(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  insert into public.business_ebitda_adjustments(
    user_id,business_id,period_end,category,label,amount,currency,recurring,
    data_kind,confidence,source,notes
  ) values(
    p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'period_end')::date,
    p_payload->>'category',p_payload->>'label',(p_payload->>'amount')::numeric,
    upper(p_payload->>'currency'),coalesce((p_payload->>'recurring')::boolean,false),
    coalesce(nullif(p_payload->>'data_kind',''),'USER_ASSUMPTION'),
    coalesce(nullif(p_payload->>'confidence',''),'MEDIUM'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')
  )
  on conflict(user_id,business_id,period_end,label) do update set
    category=excluded.category, amount=excluded.amount, currency=excluded.currency,
    recurring=excluded.recurring, data_kind=excluded.data_kind, confidence=excluded.confidence,
    source=excluded.source, notes=excluded.notes
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.lfo_delete_business_ebitda_adjustment(p_user_id uuid, p_adjustment_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  delete from public.business_ebitda_adjustments where id=p_adjustment_id and user_id=p_user_id;
  if not found then raise exception 'Ajustement EBITDA introuvable'; end if;
  return p_adjustment_id;
end $$;

create or replace function public.lfo_record_business_bridge_item(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  insert into public.business_bridge_items(
    user_id,business_id,effective_date,category,label,amount,currency,
    data_kind,confidence,source,notes
  ) values(
    p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'effective_date')::date,
    p_payload->>'category',p_payload->>'label',(p_payload->>'amount')::numeric,
    upper(p_payload->>'currency'),
    coalesce(nullif(p_payload->>'data_kind',''),'USER_ASSUMPTION'),
    coalesce(nullif(p_payload->>'confidence',''),'MEDIUM'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes','')
  )
  on conflict(user_id,business_id,effective_date,label) do update set
    category=excluded.category, amount=excluded.amount, currency=excluded.currency,
    data_kind=excluded.data_kind, confidence=excluded.confidence,
    source=excluded.source, notes=excluded.notes
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.lfo_delete_business_bridge_item(p_user_id uuid, p_item_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  delete from public.business_bridge_items where id=p_item_id and user_id=p_user_id;
  if not found then raise exception 'Élément de bridge introuvable'; end if;
  return p_item_id;
end $$;

-- En-tête DCF et déroulé annuel écrits ENSEMBLE : un WACC sans périodes, ou des périodes
-- sans WACC, ne valorisent rien. Les deux moitiés entrent ou n'entrent pas.
create or replace function public.lfo_set_business_dcf(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_period jsonb;
begin
  insert into public.business_dcf_assumptions(
    user_id,business_id,valuation_date,currency,wacc,tax_rate,terminal_method,
    terminal_growth,terminal_exit_multiple,terminal_exit_metric,discount_convention,
    data_kind,confidence,source,notes,updated_at
  ) values(
    p_user_id,(p_payload->>'business_id')::uuid,(p_payload->>'valuation_date')::date,
    upper(p_payload->>'currency'),(p_payload->>'wacc')::numeric,(p_payload->>'tax_rate')::numeric,
    p_payload->>'terminal_method',nullif(p_payload->>'terminal_growth','')::numeric,
    nullif(p_payload->>'terminal_exit_multiple','')::numeric,
    nullif(p_payload->>'terminal_exit_metric',''),
    coalesce(nullif(p_payload->>'discount_convention',''),'YEAR_END'),
    'USER_ASSUMPTION',coalesce(nullif(p_payload->>'confidence',''),'LOW'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now()
  )
  on conflict(user_id,business_id,valuation_date) do update set
    currency=excluded.currency, wacc=excluded.wacc, tax_rate=excluded.tax_rate,
    terminal_method=excluded.terminal_method, terminal_growth=excluded.terminal_growth,
    terminal_exit_multiple=excluded.terminal_exit_multiple,
    terminal_exit_metric=excluded.terminal_exit_metric,
    discount_convention=excluded.discount_convention, confidence=excluded.confidence,
    source=excluded.source, notes=excluded.notes, updated_at=now()
  returning id into v_id;

  delete from public.business_dcf_periods where dcf_id=v_id and user_id=p_user_id;
  for v_period in select * from jsonb_array_elements(coalesce(p_payload->'periods','[]'::jsonb)) loop
    insert into public.business_dcf_periods(
      user_id,dcf_id,year_index,revenue,ebitda,ebit,depreciation_amortisation,
      capex,working_capital_change,notes
    ) values(
      p_user_id,v_id,(v_period->>'year_index')::integer,
      nullif(v_period->>'revenue','')::numeric,nullif(v_period->>'ebitda','')::numeric,
      nullif(v_period->>'ebit','')::numeric,
      nullif(v_period->>'depreciation_amortisation','')::numeric,
      nullif(v_period->>'capex','')::numeric,
      nullif(v_period->>'working_capital_change','')::numeric,
      nullif(v_period->>'notes','')
    );
  end loop;
  return v_id;
end $$;

create or replace function public.lfo_delete_business_dcf(p_user_id uuid, p_dcf_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  delete from public.business_dcf_assumptions where id=p_dcf_id and user_id=p_user_id;
  if not found then raise exception 'Hypothèses DCF introuvables'; end if;
  return p_dcf_id;
end $$;

-- Une levée de fonds est UN fait économique, pas trois saisies indépendantes. La RPC écrit
-- ensemble les termes du tour, l'éventuelle souscription de l'utilisateur et la détention
-- qui en résulte — dont le taux a été DÉRIVÉ en TypeScript, jamais ressaisi à la main.
create or replace function public.lfo_apply_business_funding_round(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_date date := (p_payload->>'round_date')::date;
  v_currency char(3) := upper(p_payload->>'currency');
  v_contribution numeric := nullif(p_payload->>'investor_contribution','')::numeric;
  v_valuation uuid; v_event uuid;
begin
  insert into public.business_valuations(
    id,user_id,business_id,valuation_date,method,assumptions,data_kind,currency,
    pre_money_equity_value,primary_new_money,secondary_amount,investor_contribution,
    preferred_rights_known,confidence,source,notes,updated_at
  ) values(
    gen_random_uuid(),p_user_id,v_business,v_date,'FUNDING_ROUND','{}'::jsonb,'EXTERNAL_DATA',v_currency,
    (p_payload->>'pre_money_equity_value')::numeric,(p_payload->>'primary_new_money')::numeric,
    nullif(p_payload->>'secondary_amount','')::numeric,v_contribution,
    (p_payload->>'preferred_rights_known')::boolean,
    coalesce(nullif(p_payload->>'confidence',''),'MEDIUM'),
    nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now()
  )
  on conflict(user_id,business_id,valuation_date,method) do update set
    currency=excluded.currency, pre_money_equity_value=excluded.pre_money_equity_value,
    primary_new_money=excluded.primary_new_money, secondary_amount=excluded.secondary_amount,
    investor_contribution=excluded.investor_contribution,
    preferred_rights_known=excluded.preferred_rights_known,
    confidence=excluded.confidence, source=excluded.source, notes=excluded.notes, updated_at=now()
  returning id into v_valuation;

  if coalesce(v_contribution,0) > 0 then
    insert into public.business_capital_events(
      id,user_id,business_id,event_type,event_date,amount,amount_scope,currency,
      ownership_rate_after,label,data_kind,confidence,source,notes
    ) values(
      gen_random_uuid(),p_user_id,v_business,'CAPITAL_INJECTION',v_date,v_contribution,'USER_CASH',
      v_currency,nullif(p_payload->>'post_ownership_rate','')::numeric,
      'Souscription au tour de table','ACTUAL','HIGH',nullif(p_payload->>'source',''),
      nullif(p_payload->>'notes','')
    ) returning id into v_event;
  end if;

  if nullif(p_payload->>'post_ownership_rate','') is not null then
    insert into public.business_ownership(
      user_id,business_id,ownership_rate,economic_rate,voting_rate,fully_diluted_rate,
      effective_date,origin_event_id,data_kind,confidence,source,notes,updated_at
    ) values(
      p_user_id,v_business,(p_payload->>'post_ownership_rate')::numeric,
      (p_payload->>'post_ownership_rate')::numeric,
      nullif(p_payload->>'post_voting_rate','')::numeric,
      nullif(p_payload->>'post_fully_diluted_rate','')::numeric,
      v_date,v_event,'DERIVED',coalesce(nullif(p_payload->>'confidence',''),'MEDIUM'),
      nullif(p_payload->>'source',''),
      'Détention dérivée du tour de table du ' || to_char(v_date,'DD/MM/YYYY'),now()
    )
    on conflict(user_id,business_id,effective_date) do update set
      ownership_rate=excluded.ownership_rate, economic_rate=excluded.economic_rate,
      voting_rate=excluded.voting_rate, fully_diluted_rate=excluded.fully_diluted_rate,
      origin_event_id=excluded.origin_event_id, data_kind=excluded.data_kind,
      confidence=excluded.confidence, source=excluded.source, notes=excluded.notes, updated_at=now();
  end if;

  return v_valuation;
end $$;

revoke all on function
  public.lfo_save_business(uuid,jsonb),
  public.lfo_record_business_ownership(uuid,jsonb),
  public.lfo_delete_business_ownership(uuid,uuid),
  public.lfo_record_business_financials(uuid,jsonb),
  public.lfo_delete_business_financials(uuid,uuid),
  public.lfo_record_business_valuation(uuid,jsonb),
  public.lfo_delete_business_valuation(uuid,uuid),
  public.lfo_record_business_capital_event(uuid,jsonb),
  public.lfo_delete_business_capital_event(uuid,uuid),
  public.lfo_delete_business_holding(uuid,uuid),
  public.lfo_record_business_ebitda_adjustment(uuid,jsonb),
  public.lfo_delete_business_ebitda_adjustment(uuid,uuid),
  public.lfo_record_business_bridge_item(uuid,jsonb),
  public.lfo_delete_business_bridge_item(uuid,uuid),
  public.lfo_set_business_dcf(uuid,jsonb),
  public.lfo_delete_business_dcf(uuid,uuid),
  public.lfo_apply_business_funding_round(uuid,jsonb)
from public, anon, authenticated;

grant execute on function
  public.lfo_save_business(uuid,jsonb),
  public.lfo_record_business_ownership(uuid,jsonb),
  public.lfo_delete_business_ownership(uuid,uuid),
  public.lfo_record_business_financials(uuid,jsonb),
  public.lfo_delete_business_financials(uuid,uuid),
  public.lfo_record_business_valuation(uuid,jsonb),
  public.lfo_delete_business_valuation(uuid,uuid),
  public.lfo_record_business_capital_event(uuid,jsonb),
  public.lfo_delete_business_capital_event(uuid,uuid),
  public.lfo_delete_business_holding(uuid,uuid),
  public.lfo_record_business_ebitda_adjustment(uuid,jsonb),
  public.lfo_delete_business_ebitda_adjustment(uuid,uuid),
  public.lfo_record_business_bridge_item(uuid,jsonb),
  public.lfo_delete_business_bridge_item(uuid,uuid),
  public.lfo_set_business_dcf(uuid,jsonb),
  public.lfo_delete_business_dcf(uuid,uuid),
  public.lfo_apply_business_funding_round(uuid,jsonb)
to service_role;

comment on table public.business_ebitda_adjustments is
  'Retraitements d''EBITDA déclarés, datés et catégorisés. Un EBITDA ajusté sans ligne ici est un EBITDA inventé.';
comment on table public.business_bridge_items is
  'Éléments du pont EV → Equity autres que cash et dette brute. Absents = non déclarés, jamais nuls.';
comment on table public.business_dcf_assumptions is
  'Paramètres de DCF DÉCLARÉS par l''utilisateur. Aucun taux ni croissance n''est fourni par LFO.';
comment on table public.business_dcf_periods is
  'Déroulé annuel projeté et déclaré. Aucune extrapolation n''est faite à partir de l''historique.';
comment on column public.business_capital_events.amount_scope is
  'USER_CASH : montant réellement reçu ou versé par l''utilisateur. COMPANY_TOTAL : montant distribué par la société, dont la part utilisateur est dérivée au prorata et signalée comme telle.';
comment on column public.businesses.capital_history_source is
  'Couverture DÉCLARÉE de l''historique de capital. Seul DECLARED_COMPLETE autorise à lire une absence d''événement comme un zéro.';

-- ─── 11. Démarrage rapide : une société valorisable en UN acte ──────────────────────────
-- Créer une société, déclarer sa détention, saisir une période financière et choisir une
-- méthode de valorisation sont QUATRE écritures, mais UN SEUL acte économique. Les séparer
-- laisserait l'utilisateur avec une société sans détention ni base de valorisation dès que
-- l'une des quatre échoue, c'est-à-dire avec un patrimoine non calculable créé par le
-- produit lui-même.
--
-- Cette RPC ne calcule toujours rien : la valorisation reste dérivée en TypeScript à la
-- lecture, à partir des faits et du multiple que cette écriture persiste.
create or replace function public.lfo_create_business_quick_start(p_user_id uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid := gen_random_uuid();
  v_currency char(3) := upper(coalesce(nullif(p_payload->>'currency',''),'EUR'));
  v_period date := (p_payload->>'period_end')::date;
  v_method text := p_payload->>'method';
begin
  if nullif(p_payload->>'name','') is null then raise exception 'Nom de société requis'; end if;
  if v_method not in ('EBITDA_MULTIPLE','REVENUE_MULTIPLE') then
    raise exception 'Le démarrage rapide ne couvre que les méthodes par multiple';
  end if;

  insert into public.businesses(
    id,user_id,name,legal_form,status,business_type,functional_currency,archived,
    sector,country,capital_history_start,capital_history_source,
    data_kind,confidence,source,notes,updated_at
  ) values(
    v_id,p_user_id,p_payload->>'name',nullif(p_payload->>'legal_form',''),'ACTIVE',
    nullif(p_payload->>'business_type',''),v_currency,false,
    nullif(p_payload->>'sector',''),upper(nullif(p_payload->>'country','')),
    nullif(p_payload->>'capital_history_start','')::date,
    coalesce(nullif(p_payload->>'capital_history_source',''),'UNKNOWN'),
    'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),now()
  );

  insert into public.business_ownership(
    user_id,business_id,ownership_rate,economic_rate,effective_date,data_kind,confidence,source
  ) values(
    p_user_id,v_id,(p_payload->>'legal_rate')::numeric,(p_payload->>'economic_rate')::numeric,
    v_period,'USER_ASSUMPTION','HIGH',nullif(p_payload->>'source','')
  );

  insert into public.business_financials(
    id,user_id,business_id,period_end,period_kind,period_label,revenue,ebitda,cash,debt,
    currency,data_kind,confidence,source
  ) values(
    gen_random_uuid(),p_user_id,v_id,v_period,
    coalesce(nullif(p_payload->>'period_kind',''),'ANNUAL'),nullif(p_payload->>'period_label',''),
    nullif(p_payload->>'revenue','')::numeric,nullif(p_payload->>'ebitda','')::numeric,
    nullif(p_payload->>'cash','')::numeric,nullif(p_payload->>'gross_debt','')::numeric,
    v_currency,'ACTUAL','HIGH',nullif(p_payload->>'source','')
  );

  insert into public.business_valuations(
    id,user_id,business_id,valuation_date,method,assumptions,data_kind,currency,
    valuation_multiple,multiple_low,multiple_high,metric_basis,metric_period_end,
    confidence,source,updated_at
  ) values(
    gen_random_uuid(),p_user_id,v_id,(p_payload->>'valuation_date')::date,v_method,'{}'::jsonb,
    'USER_ASSUMPTION',v_currency,(p_payload->>'multiple')::numeric,
    nullif(p_payload->>'multiple_low','')::numeric,nullif(p_payload->>'multiple_high','')::numeric,
    case when v_method='REVENUE_MULTIPLE' then 'REVENUE' else 'EBITDA' end,v_period,
    'MEDIUM',nullif(p_payload->>'source',''),now()
  );

  return v_id;
end $$;

revoke all on function public.lfo_create_business_quick_start(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.lfo_create_business_quick_start(uuid,jsonb) to service_role;
