-- ---------------------------------------------------------------------------------------
-- FEC / CORPORATE DATA ACQUISITION — INDEX COUVRANTS DES CLÉS ÉTRANGÈRES COMPOSITES
--
-- Même doctrine que les migrations d'index de Portfolio, Real Estate, Business Equity V2.1
-- et Career + Tax : une clé étrangère composite `(cible, propriétaire)` ne bénéficie d'un
-- index que si celui-ci porte ses colonnes DANS CET ORDRE. Sans lui, PostgreSQL doit
-- balayer la table fille à chaque suppression du parent, et l'advisor Supabase le signale
-- comme une clé étrangère non couverte.
--
-- Migration strictement additive : aucun objet applicatif, aucune contrainte, aucune RPC.
-- ---------------------------------------------------------------------------------------

-- `fec_entry_lines_business_fk` référence `businesses(id, user_id)`. L'index existant
-- `fec_entry_lines_business_idx` est PARTIEL sur `commit_state = 'COMMITTED'` et commence
-- par `user_id` : il sert la lecture du domaine, il ne couvre pas la clé étrangère.
create index if not exists fec_entry_lines_business_owner_fk_idx
  on public.fec_entry_lines(business_id, user_id);

-- `import_upload_tickets_session_fk` référence `import_sessions(id, user_id)`. Partiel :
-- un billet non consommé ne désigne aucune session, et les lignes concernées sont une
-- minorité de la table.
create index if not exists import_upload_tickets_session_owner_fk_idx
  on public.import_upload_tickets(consumed_session_id, user_id)
  where consumed_session_id is not null;
