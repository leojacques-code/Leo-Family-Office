-- Léo Family Office — Real Estate, index couvrants des clés étrangères
--
-- Les trois tables de faits immobiliers portent une clé étrangère composite
-- `(property_id, user_id)` vers `properties(id, user_id)`. La migration Real Estate V2 les
-- avait dotées d'un index `(user_id, property_id)`, dans l'ordre inverse : PostgreSQL ne
-- peut pas s'en servir pour vérifier la clé étrangère, ni pour la mettre à jour ou la
-- supprimer en cascade. Chaque suppression de bien déclenchait donc un balayage complet.
--
-- Cette migration ne fait qu'ajouter les index dans l'ordre de la clé étrangère. Aucune
-- table, colonne, contrainte, policy ni RPC n'est touchée, et les index existants sont
-- conservés : ils servent les lectures par propriétaire.

create index if not exists real_estate_valuations_property_owner_idx
  on public.real_estate_valuations(property_id, user_id);

create index if not exists real_estate_capital_events_property_owner_idx
  on public.real_estate_capital_events(property_id, user_id);

create index if not exists real_estate_operating_terms_property_owner_idx
  on public.real_estate_operating_terms(property_id, user_id);
