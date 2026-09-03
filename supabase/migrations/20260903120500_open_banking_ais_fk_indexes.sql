-- ---------------------------------------------------------------------------
-- Open Banking (AIS) — index de clés étrangères
-- ---------------------------------------------------------------------------
-- Une clé étrangère non couverte par un index dont elle est le PRÉFIXE fait balayer la
-- table référençante à chaque suppression de la ligne référencée, et l'advisor Supabase la
-- signale. Ce n'est pas une optimisation cosmétique : sur une cascade de consentement, le
-- balayage porte sur toutes les observations conservées.
--
-- L'ORDRE DES COLONNES DÉCIDE. Plusieurs unicités de la migration précédente portent bien
-- les deux colonnes d'une clé composée, mais dans l'ordre `(user_id, cible)` : elles servent
-- l'invariant qu'elles expriment, et NON la clé étrangère, dont la première colonne est la
-- cible. Un index `(user_id, x)` ne couvre pas une FK `(x, user_id)`.
--
-- Migration séparée, comme pour les autres verticales : les index de FK ne changent aucun
-- invariant et se relisent seuls.

-- Établissement canonique rattaché : clé à une seule colonne.
create index if not exists bank_institutions_canonical_fk_idx
  on public.bank_institutions(institution_id)
  where institution_id is not null;

-- `bank_provider_accounts_canonical_uidx` est `(user_id, account_id)` et PARTIEL : il porte
-- l'invariant « un compte canonique alimenté par au plus un compte fournisseur », pas la
-- clé étrangère.
create index if not exists bank_provider_accounts_account_fk_idx
  on public.bank_provider_accounts(account_id, user_id)
  where account_id is not null;

create index if not exists bank_sync_cursors_account_fk_idx
  on public.bank_sync_cursors(provider_account_id, user_id);

create index if not exists bank_sync_raw_pages_account_fk_idx
  on public.bank_sync_raw_pages(provider_account_id, user_id);

create index if not exists bank_sync_raw_pages_session_fk_idx
  on public.bank_sync_raw_pages(session_id, user_id);

create index if not exists bank_reconciliation_decisions_observation_fk_idx
  on public.bank_reconciliation_decisions(observation_id, user_id);

create index if not exists bank_reconciliation_decisions_transaction_fk_idx
  on public.bank_reconciliation_decisions(linked_transaction_id, user_id)
  where linked_transaction_id is not null;
