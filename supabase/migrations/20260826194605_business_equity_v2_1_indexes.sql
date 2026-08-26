-- Business Equity V2.1 — index couvrants des clés étrangères introduites par la migration
-- de fond. Même schéma que Portfolio Data Foundation et Real Estate V2 : une migration de
-- fond, puis les index que les advisors révèlent.
--
-- Les index sont écrits dans l'ORDRE des FK composites `(business_id, user_id)` : un index
-- en `(user_id, business_id)` ne sert ni à vérifier la clé étrangère ni à la cascader, et
-- chaque suppression de société balaierait la table entière.

create index if not exists business_ebitda_adjustments_business_owner_idx
  on public.business_ebitda_adjustments(business_id, user_id);
create index if not exists business_ebitda_adjustments_user_idx
  on public.business_ebitda_adjustments(user_id);

create index if not exists business_bridge_items_business_owner_idx
  on public.business_bridge_items(business_id, user_id);
create index if not exists business_bridge_items_user_idx
  on public.business_bridge_items(user_id);

create index if not exists business_dcf_assumptions_business_owner_idx
  on public.business_dcf_assumptions(business_id, user_id);
create index if not exists business_dcf_assumptions_user_idx
  on public.business_dcf_assumptions(user_id);

create index if not exists business_dcf_periods_dcf_idx
  on public.business_dcf_periods(dcf_id);
create index if not exists business_dcf_periods_user_idx
  on public.business_dcf_periods(user_id);

-- FK `business_ownership.origin_event_id` → `business_capital_events(id, user_id)`.
create index if not exists business_ownership_origin_event_idx
  on public.business_ownership(origin_event_id, user_id)
  where origin_event_id is not null;

create index if not exists business_holdings_user_idx on public.business_holdings(user_id);
create index if not exists business_ownership_user_idx on public.business_ownership(user_id);
