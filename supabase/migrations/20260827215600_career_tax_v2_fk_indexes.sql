-- Cover the referencing side of every Career + Tax V2 foreign key in its declared order.
create index career_equity_grants_user_idx on public.career_equity_grants(user_id);
create index career_scenarios_user_idx on public.career_scenarios(user_id);
create index tax_income_items_user_idx on public.tax_income_items(user_id);
create index tax_observations_document_owner_idx on public.tax_observations(document_id,user_id)
  where document_id is not null;
