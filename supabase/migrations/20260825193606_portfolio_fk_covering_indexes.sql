-- Léo Family Office — Portfolio foreign-key covering indexes
--
-- PostgreSQL n'indexe pas automatiquement le côté référençant d'une clé étrangère.
-- Ces deux index couvrent exactement les colonnes des FK ajoutées par la fondation
-- Portfolio afin que les contrôles de suppression/mise à jour ne balayent pas le ledger.

create index if not exists portfolio_events_account_owner_idx
  on public.portfolio_events(account_id, user_id);

create index if not exists portfolio_events_matched_lot_covering_idx
  on public.portfolio_events(
    matched_acquisition_event_id,
    user_id,
    account_id,
    security_id,
    matched_lot_is_opening
  )
  where matched_acquisition_event_id is not null;
