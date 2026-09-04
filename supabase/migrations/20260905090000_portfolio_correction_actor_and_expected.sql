-- ---------------------------------------------------------------------------
-- ACTEUR VÉRIFIÉ ET REPRÉSENTATION EXACTE DE L'ÉTAT ATTENDU
-- ---------------------------------------------------------------------------
-- Migration CORRECTIVE de deux findings de revue sur `20260904093000`. Elle est ADDITIVE au
-- sens qui compte : aucune des 43 migrations du dépôt n'est modifiée. Le seul objet
-- redéfini est la RPC `lfo_commit_portfolio_session`, DÉRIVÉE de sa dernière version en
-- vigueur — celle de `20260904093000` — et non réécrite depuis une version antérieure.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING 1 — CLÉ ABSENTE ≠ JSON NULL ≠ CHAÎNE VIDE ≠ ZÉRO
-- ═══════════════════════════════════════════════════════════════════════════
-- L'état attendu d'une décision était lu par
-- `(nullif(btrim(coalesce(v_expected ->> 'quantity', '')), ''))::numeric`. Cette expression
-- rend le MÊME `NULL` SQL dans trois situations qui n'ont rien à voir :
--
--   * la clé est ABSENTE — le client n'a rien dit de ce champ ;
--   * la clé vaut JSON `null` — le client DÉCLARE que la valeur est absente ;
--   * la clé vaut `""` ou `"   "` — le client a envoyé quelque chose d'illisible.
--
-- La conséquence n'est pas cosmétique. Un client qui OMET `market_value` obtenait la même
-- interprétation qu'un client déclarant « la valeur de marché est absente ». Si l'observation
-- persistée portait elle-même une valeur de marché absente, l'état attendu se trouvait
-- « d'accord » avec un état dont l'appelant ne savait rien : le conflit de concurrence ne se
-- déclenchait pas, et un fait était remplacé sur la foi d'un OUBLI.
--
-- Les cinq clés sont désormais EXIGÉES, et chaque forme a son traitement :
--
--   clé absente                → charge INVALIDE
--   JSON `null`                → `NULL` SQL explicite
--   chaîne vide ou blanche     → charge INVALIDE
--   chaîne décimale non vide   → cast `numeric` ; `0` en fait partie et vaut zéro
--   toute autre forme JSON     → charge INVALIDE
--   clé inconnue               → charge INVALIDE
--
-- ZÉRO EST UNE VALEUR. `"0"` est une chaîne décimale exacte, donc un zéro numérique — pas
-- une absence. Et `10.50` et `10.5` restent le même nombre : la comparaison est faite en
-- `numeric`, jamais en texte, sans quoi une différence de forme fabriquerait un conflit.
--
-- Le contrôle a lieu AVANT toute écriture. Une charge mal formée est une faute de
-- l'appelant, et faire échouer la transaction après avoir écrit la moitié des faits
-- annulerait un travail correct pour une raison qui était connue d'avance.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING 2 — IDENTITÉ DÉCLARÉE ≠ IDENTITÉ VÉRIFIÉE
-- ═══════════════════════════════════════════════════════════════════════════
-- `decided_by` était une chaîne LIBRE fournie par le navigateur. La piste d'audit
-- présentait donc, côte à côte, un rôle PostgreSQL constaté et une « identité » que
-- n'importe quel appelant pouvait écrire à sa convenance. Une piste d'audit dont le champ
-- « qui » est déclaratif ne répond pas à « qui a décidé » : elle répond à « qui l'appelant
-- a bien voulu nommer », ce qui n'est pas la même question.
--
-- CE QUE CE PRODUIT PEUT HONNÊTEMENT AFFIRMER, ET RIEN DE PLUS. L'accès est gardé par un
-- code d'accès unique, et l'UUID Supabase Auth du propriétaire est lu de l'environnement
-- SERVEUR (`OWNER_USER_ID`). Il n'existe aucune session par utilisateur, aucun jeton porteur
-- d'identité, donc aucune délégation. Le seul acteur qu'une décision puisse nommer avec
-- certitude est LE PROPRIÉTAIRE, et c'est exactement ce que la base impose :
--
--   * `actor_user_id` est NOT NULL et référence `auth.users` ;
--   * une contrainte exige `actor_user_id = user_id` pour cette version ;
--   * la RPC le pose depuis `p_user_id`, l'identité établie côté serveur ;
--   * toute clé d'acteur présente dans la charge fait ÉCHOUER l'appel.
--
-- Construire une délégation maintenant serait construire un mécanisme sans utilisateur. La
-- contrainte d'égalité est le point où une future délégation devra être DÉCIDÉE, et elle
-- échouera bruyamment plutôt que de laisser passer un acteur non vérifié.
--
-- `executed_by` reste séparé et posé par la base : ACTEUR HUMAIN ≠ RÔLE TECHNIQUE.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING 3 — SUPPRESSION D'UN UTILISATEUR : DEUX RÈGLES QUI SE CONTREDISAIENT
-- ═══════════════════════════════════════════════════════════════════════════
-- La table déclarait `user_id ... references auth.users(id) on delete cascade` ET un trigger
-- refusant tout `DELETE`. Les deux ne peuvent pas être vraies : la cascade DEMANDE une
-- suppression que le trigger REFUSE. Le résultat n'était ni « l'utilisateur est supprimé et
-- son audit avec », ni « la suppression est refusée » — c'était une erreur de trigger levée
-- au milieu d'une cascade, à un endroit qui n'explique rien.
--
-- La contradiction est tranchée dans le sens de la conservation : `ON DELETE RESTRICT`. La
-- suppression destructive d'un utilisateur portant une piste financière est INTERDITE, et le
-- refus vient de la clé étrangère — au bon endroit, avec un message qui nomme la contrainte.
--
-- CE QUE CELA N'EST PAS. Ce n'est pas une procédure de départ d'utilisateur. Effacer
-- l'historique patrimonial pour honorer un départ détruirait précisément ce que ce produit
-- existe pour conserver. Une future procédure devra DÉSACTIVER ou ANONYMISER l'utilisateur
-- sans effacer ses faits — ce qui est une décision de conception, pas une correction de
-- revue, et elle n'est donc PAS construite ici.

-- ---------------------------------------------------------------------------
-- 1. Le trigger d'immuabilité est retiré le temps de la reprise
-- ---------------------------------------------------------------------------
-- Il refuse tout `UPDATE`, y compris celui d'une reprise de données. Le retirer puis le
-- REMETTRE dans la même migration est explicite et auditable ; le contourner par
-- `session_replication_role` désactiverait aussi les autres triggers de la transaction.
drop trigger if exists position_snapshot_corrections_immutable
  on public.position_snapshot_corrections;

-- ---------------------------------------------------------------------------
-- 2. `actor_user_id` : l'acteur VÉRIFIÉ
-- ---------------------------------------------------------------------------
alter table public.position_snapshot_corrections
  add column if not exists actor_user_id uuid;

comment on column public.position_snapshot_corrections.actor_user_id is
  'Acteur VÉRIFIÉ : UUID Supabase Auth établi côté serveur, jamais reçu du navigateur. Distinct de executed_by, qui est le rôle PostgreSQL constaté.';

-- Reprise des lignes existantes. Elle porte sur zéro ligne partout où la migration
-- précédente n'a jamais été appliquée à une base contenant des corrections ; l'écrire
-- correctement est la seule façon de ne pas en dépendre.
update public.position_snapshot_corrections
   set actor_user_id = user_id
 where actor_user_id is null;

alter table public.position_snapshot_corrections
  alter column actor_user_id set not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'position_snapshot_corrections_actor_fk'
  ) then
    alter table public.position_snapshot_corrections
      add constraint position_snapshot_corrections_actor_fk
      foreign key (actor_user_id) references auth.users(id) on delete restrict;
  end if;
end $$;

-- V1 : L'ACTEUR EST LE PROPRIÉTAIRE. Ce produit n'a pas de délégation, donc aucune décision
-- ne peut honnêtement nommer quelqu'un d'autre. La contrainte est le point où une future
-- délégation devra être décidée : elle échouera bruyamment au lieu de laisser passer un
-- acteur non vérifié.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'position_snapshot_corrections_actor_is_owner_ck'
  ) then
    alter table public.position_snapshot_corrections
      add constraint position_snapshot_corrections_actor_is_owner_ck
      check (actor_user_id = user_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. `decided_by` : une identité déclarative n'est pas une identité
-- ---------------------------------------------------------------------------
-- La colonne est SUPPRIMÉE plutôt que laissée inerte. La garder en la rendant non
-- renseignable produirait un second champ « qui », toujours égal à `executed_by`, et donc
-- une seconde vérité sur la même question — exactement ce que ce dépôt refuse.
--
-- Sa suppression ne perd aucune donnée de production : `20260904093000` n'a jamais été
-- appliquée en production, qui porte 33 migrations. Les deux migrations arriveront donc
-- ensemble, et la colonne n'aura jamais existé pour personne.
alter table public.position_snapshot_corrections drop column if exists decided_by;

-- ---------------------------------------------------------------------------
-- 4. `user_id` : la contradiction cascade / trigger est tranchée
-- ---------------------------------------------------------------------------
-- Le nom de la clé est celui que PostgreSQL a généré à la création de la table
-- (`<table>_<colonne>_fkey`). Il est LU dans le catalogue plutôt que supposé : une clé
-- portant un autre nom laisserait la cascade en place en silence.
do $$
declare v_name text;
begin
  select con.conname into v_name
    from pg_constraint con
   where con.conrelid = 'public.position_snapshot_corrections'::regclass
     and con.contype = 'f'
     and con.confrelid = 'auth.users'::regclass
     and con.conkey = array[
       (select attnum from pg_attribute
         where attrelid = 'public.position_snapshot_corrections'::regclass
           and attname = 'user_id')
     ]::smallint[];
  if v_name is not null then
    execute format(
      'alter table public.position_snapshot_corrections drop constraint %I', v_name);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'position_snapshot_corrections_owner_fk'
  ) then
    alter table public.position_snapshot_corrections
      add constraint position_snapshot_corrections_owner_fk
      foreign key (user_id) references auth.users(id) on delete restrict;
  end if;
end $$;

comment on table public.position_snapshot_corrections is
  'Piste IMMUABLE des corrections d''observations de position : acteur VÉRIFIÉ, rôle d''exécution constaté, motif, avant, après, champs modifiés. Ni modifiable, ni supprimable. Ni l''observation corrigée ni le propriétaire ne se suppriment tant qu''une correction existe : ce serait perdre l''ancienne valeur.';

-- ---------------------------------------------------------------------------
-- 5. Le trigger d'immuabilité est REMIS
-- ---------------------------------------------------------------------------
create trigger position_snapshot_corrections_immutable
  before update or delete on public.position_snapshot_corrections
  for each row execute function public.position_snapshot_correction_immutable();

-- ---------------------------------------------------------------------------
-- 6. Privilèges de la nouvelle colonne
-- ---------------------------------------------------------------------------
-- Un `add column` n'accorde rien de nouveau, mais le redire garde le contrat lisible d'une
-- seule lecture : `authenticated` lit, il n'écrit jamais.
revoke all on table public.position_snapshot_corrections from anon, authenticated;
grant select on table public.position_snapshot_corrections to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Deux lectures de `expected`, nommées et pures
-- ---------------------------------------------------------------------------
-- Elles ne sont PAS des RPC : elles ne portent pas le préfixe `lfo_`, ne sont pas
-- `SECURITY DEFINER`, et ne sont exécutables par personne d'autre que `service_role`. Elles
-- existent pour que la même règle de lecture serve la comparaison et le message d'erreur,
-- au lieu d'être réécrite six fois dans le corps de la RPC.
--
-- Elles supposent la forme DÉJÀ VALIDÉE par la RPC. Un JSON `null` y donne un `NULL` SQL ;
-- tout le reste est une chaîne décimale exacte castée en `numeric`.
create or replace function public.expected_numeric(p_expected jsonb, p_key text)
returns numeric
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_expected -> p_key is null then null
    when jsonb_typeof(p_expected -> p_key) = 'null' then null
    else (p_expected ->> p_key)::numeric
  end;
$$;

comment on function public.expected_numeric(jsonb, text) is
  'Lit un montant attendu : JSON null → NULL SQL, chaîne décimale → numeric. Suppose la forme déjà validée par lfo_commit_portfolio_session.';

-- Étiquette d'AFFICHAGE d'une valeur attendue. « absente » est réservé à une absence
-- DÉCLARÉE : un message qui dirait « absente » pour une clé oubliée mentirait sur la cause.
create or replace function public.expected_label(p_expected jsonb, p_key text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_expected -> p_key is null then 'non déclarée'
    when jsonb_typeof(p_expected -> p_key) = 'null' then 'absente (déclarée)'
    else p_expected ->> p_key
  end;
$$;

revoke all on function public.expected_numeric(jsonb, text) from public, anon, authenticated;
revoke all on function public.expected_label(jsonb, text) from public, anon, authenticated;
grant execute on function public.expected_numeric(jsonb, text) to service_role;
grant execute on function public.expected_label(jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. La RPC de validation
-- ---------------------------------------------------------------------------
-- DÉRIVÉE de sa dernière version en vigueur, `20260904093000_portfolio_correction_audit`.
-- Changent : le refus des clés d'acteur, la validation exacte de `expected`, la comparaison
-- qui n'aplatit plus trois cas sur un `NULL`, et l'acteur posé depuis `p_user_id`. Le reste
-- est identique, volontairement.
create or replace function public.lfo_commit_portfolio_session(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_status text;
  v_domain text;
  v_account_id uuid;
  v_selected uuid[];
  v_record record;
  v_event_id uuid;
  v_position_id uuid;
  v_snapshot_id uuid;
  v_written integer := 0;
  v_rejected text;
  v_existing public.position_snapshots;
  v_decisions jsonb;
  v_decision jsonb;
  v_expected jsonb;
  v_changed text[];
  v_conflicts text;
begin
  v_session_id := (p_payload ->> 'session_id')::uuid;

  select s.status, src.domain, src.target_account_id
    into v_status, v_domain, v_account_id
    from public.import_sessions s
    join public.import_sources src on src.id = s.source_id and src.user_id = s.user_id
   where s.id = v_session_id and s.user_id = p_user_id
   for update of s;
  if not found then
    raise exception 'Session d''import introuvable';
  end if;
  if v_status = 'COMMITTED' then
    -- Idempotence applicative : un second commit ne réécrit rien.
    select count(*) into v_written
      from public.import_normalized_records
     where user_id = p_user_id and session_id = v_session_id and commit_state = 'COMMITTED';
    return v_written;
  end if;
  if v_status <> 'ANALYZED' then
    raise exception 'Session au statut % : seule une session analysée se valide', v_status;
  end if;

  -- Lignes RETENUES par l'utilisateur. Une ligne signalée n'est écrite que si elle est cochée.
  select coalesce(array_agg(value::uuid), array[]::uuid[]) into v_selected
    from jsonb_array_elements_text(coalesce(p_payload -> 'record_ids', '[]'::jsonb));

  -- ─────────────────────────────────────────────────────────────────────────
  -- DÉCISIONS DE CORRECTION, structurées
  -- ─────────────────────────────────────────────────────────────────────────
  -- Forme attendue : un tableau d'objets `{record_id, reason, expected:{snapshot_id, …}}`.
  -- Elles sont INDEXÉES par identifiant de ligne dès maintenant, et validées avant la
  -- moindre écriture : une charge mal formée doit échouer AVANT que le premier fait soit
  -- écrit, sinon la transaction annule un travail déjà à moitié fait pour une faute de
  -- l'appelant.
  v_decisions := coalesce(p_payload -> 'corrections', '[]'::jsonb);
  if jsonb_typeof(v_decisions) <> 'array' then
    raise exception 'Décisions de correction : un TABLEAU d''objets est attendu, pas %',
      jsonb_typeof(v_decisions);
  end if;

  -- Un tableau nu d'identifiants est le contrat PRÉCÉDENT. Le refuser explicitement vaut
  -- mieux que de l'ignorer : un appelant resté sur l'ancienne forme croirait avoir décidé.
  if exists (
    select 1 from jsonb_array_elements(v_decisions) d(item)
     where jsonb_typeof(d.item) <> 'object'
  ) then
    raise exception 'Décision de correction : chaque entrée est un objet {record_id, reason, expected}. Un identifiant seul n''est pas une décision : il ne dit ni pourquoi, ni ce qu''il remplace';
  end if;

  -- ─────────────────────────────────────────────────────────────────────────
  -- L'ACTEUR NE VIENT JAMAIS DE LA CHARGE
  -- ─────────────────────────────────────────────────────────────────────────
  -- `actor_user_id` est posé plus bas depuis `p_user_id`, c'est-à-dire depuis l'identité
  -- que le SERVEUR a établie. Une clé d'acteur présente dans la charge est donc REFUSÉE, et
  -- non ignorée : ignorer laisserait un appelant croire qu'il a nommé quelqu'un, et la
  -- première lecture de la piste d'audit démentirait ce qu'il pense avoir écrit.
  --
  -- `decided_by` est refusé pour la même raison : c'était une identité DÉCLARÉE librement
  -- par le client, donc une identité non vérifiée présentée à côté d'un rôle constaté. La
  -- colonne a été supprimée ; la clé aussi.
  if exists (
    select 1 from jsonb_array_elements(v_decisions) d(item)
     where d.item ? 'actor_user_id' or d.item ? 'decided_by' or d.item ? 'executed_by'
  ) then
    raise exception 'Décision de correction : l''acteur ne se déclare PAS. `actor_user_id`, `decided_by` et `executed_by` sont refusés dans la charge — l''acteur est l''identité établie par le serveur, et le rôle d''exécution est constaté par la base';
  end if;

  -- MOTIF NON VIDE, contrôlé pour toutes les décisions à la fois : le message doit nommer
  -- toutes les lignes fautives, pas seulement la première rencontrée.
  -- `~ '\S'` et non `btrim` : le `btrim` par défaut ne retire que les espaces, et une
  -- tabulation seule passerait pour un motif.
  select string_agg(d.item ->> 'record_id', ', ')
    into v_conflicts
    from jsonb_array_elements(v_decisions) d(item)
   where coalesce(d.item ->> 'reason', '') !~ '\S';
  if v_conflicts is not null then
    raise exception 'Correction sans motif pour la ou les lignes : %. Une correction remplace un fait déjà lu par un humain : elle DIT pourquoi', v_conflicts;
  end if;

  select string_agg(d.item ->> 'record_id', ', ')
    into v_conflicts
    from jsonb_array_elements(v_decisions) d(item)
   where coalesce(d.item ->> 'record_id', '') !~ '\S'
      or jsonb_typeof(d.item -> 'expected') is distinct from 'object';
  if v_conflicts is not null then
    raise exception 'Décision de correction incomplète : `record_id` et un objet `expected` sont obligatoires. Sans état attendu, une seconde décision écraserait silencieusement la première';
  end if;

  -- ─────────────────────────────────────────────────────────────────────────
  -- REPRÉSENTATION EXACTE DE `expected`
  -- ─────────────────────────────────────────────────────────────────────────
  -- CLÉ ABSENTE ≠ JSON NULL ≠ CHAÎNE VIDE ≠ ZÉRO. Le contrôle précédent les faisait passer
  -- par le MÊME `coalesce`/`nullif`, et les trois premiers devenaient un `NULL` SQL. La
  -- conséquence est directe et grave : un client qui OUBLIE `market_value` obtenait la même
  -- interprétation qu'un client qui déclare « la valeur de marché est absente », et son état
  -- attendu se trouvait d'accord avec une observation dont il ne savait rien. Le conflit de
  -- concurrence ne se déclenchait pas, et un fait était remplacé sur la foi d'un oubli.
  --
  -- Quatre lectures, quatre traitements, et un seul par cas :
  --
  --   clé absente                → CHARGE INVALIDE. Le client n'a rien dit de ce champ ;
  --   JSON `null`                → `NULL` SQL explicite. « Absent » est une DÉCLARATION ;
  --   chaîne vide ou blanche     → CHARGE INVALIDE. Ce n'est ni un nombre ni une absence ;
  --   chaîne décimale non vide   → cast `numeric`. `0` en fait partie, et vaut zéro ;
  --   toute autre forme JSON     → CHARGE INVALIDE.
  --
  -- Les montants sont exigés en CHAÎNE et jamais en nombre JSON : un `numeric(30,10)` ne
  -- traverse pas un flottant double sans risque de perte, et une perte de précision
  -- fabriquerait un conflit — ou, plus grave, en masquerait un.
  --
  -- La représentation acceptée est celle que PostgreSQL ÉMET : chiffres, point décimal
  -- optionnel, signe optionnel. `NaN`, `Infinity` et la notation exponentielle sont refusés,
  -- bien que `numeric` les accepterait : aucun n'est une quantité ni un montant.
  select string_agg(f.fault, ' ; ')
    into v_conflicts
    from jsonb_array_elements(v_decisions) d(item)
    cross join lateral (values ('quantity'), ('cost_basis'), ('market_value')) k(name)
    cross join lateral (
      select case
        when (d.item -> 'expected') -> k.name is null
          then format('ligne %s : clé `%s` ABSENTE de `expected` — une clé absente n''est pas une valeur absente', d.item ->> 'record_id', k.name)
        when jsonb_typeof((d.item -> 'expected') -> k.name) = 'null'
          then null
        when jsonb_typeof((d.item -> 'expected') -> k.name) <> 'string'
          then format('ligne %s : `%s` doit être une CHAÎNE décimale ou `null`, reçu %s — un nombre JSON perdrait de la précision', d.item ->> 'record_id', k.name, jsonb_typeof((d.item -> 'expected') -> k.name))
        when ((d.item -> 'expected') ->> k.name) !~ '^-?[0-9]+(\.[0-9]+)?$'
          then format('ligne %s : `%s` n''est pas une représentation décimale exacte — une chaîne vide, blanche ou non numérique n''est ni un nombre ni une absence', d.item ->> 'record_id', k.name)
        else null
      end as fault
    ) f
   where f.fault is not null;
  if v_conflicts is not null then
    raise exception 'Représentation invalide de `expected` : %', v_conflicts;
  end if;

  -- `snapshot_id` DÉSIGNE l'observation corrigée. Une chaîne vide, un JSON `null` ou une
  -- clé absente ne désignent rien, et le cast en `uuid` échouerait bien plus loin, après
  -- d'éventuelles écritures.
  select string_agg(format('ligne %s', d.item ->> 'record_id'), ', ')
    into v_conflicts
    from jsonb_array_elements(v_decisions) d(item)
   where jsonb_typeof((d.item -> 'expected') -> 'snapshot_id') is distinct from 'string'
      or ((d.item -> 'expected') ->> 'snapshot_id')
         !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  if v_conflicts is not null then
    raise exception '`expected.snapshot_id` absent ou mal formé : %. Sans observation désignée, la décision ne dit pas ce qu''elle remplace', v_conflicts;
  end if;

  -- La DEVISE n'est jamais absente : `position_snapshots.currency` est `char(3) not null`.
  -- Un `null` accepté ici laisserait comparer une devise contre rien.
  select string_agg(format('ligne %s', d.item ->> 'record_id'), ', ')
    into v_conflicts
    from jsonb_array_elements(v_decisions) d(item)
   where jsonb_typeof((d.item -> 'expected') -> 'currency') is distinct from 'string'
      or ((d.item -> 'expected') ->> 'currency') !~ '^[A-Za-z]{3}$';
  if v_conflicts is not null then
    raise exception '`expected.currency` absente ou mal formée : %. Une devise est un code de TROIS lettres, et FX ABSENT n''est pas FX ÉGAL À 1', v_conflicts;
  end if;

  -- CLÉ INCONNUE REFUSÉE. Sans ce contrôle, `marketvalue` au lieu de `market_value` serait
  -- lu comme « clé absente » : le message désignerait un oubli là où il y a une faute de
  -- frappe, et l'appelant chercherait au mauvais endroit.
  select string_agg(format('ligne %s : clé inconnue `%s`', d.item ->> 'record_id', kk.key), ', ')
    into v_conflicts
    from jsonb_array_elements(v_decisions) d(item)
    cross join lateral jsonb_object_keys(d.item -> 'expected') kk(key)
   where kk.key not in ('snapshot_id', 'quantity', 'cost_basis', 'market_value', 'currency');
  if v_conflicts is not null then
    raise exception 'Clé inconnue dans `expected` : %. Les cinq clés attendues sont snapshot_id, quantity, cost_basis, market_value et currency', v_conflicts;
  end if;

  -- Deux décisions pour la même ligne rendent le motif INDÉTERMINÉ : laquelle conserver ?
  select string_agg(t.record_id, ', ')
    into v_conflicts
    from (
      select d.item ->> 'record_id' as record_id
        from jsonb_array_elements(v_decisions) d(item)
       group by 1
      having count(*) > 1
    ) t;
  if v_conflicts is not null then
    raise exception 'Décisions multiples pour la ou les lignes : %. Le motif conservé serait indéterminé', v_conflicts;
  end if;

  -- Une décision qui désigne une ligne NON RETENUE ne corrige rien : la ligne ne sera pas
  -- écrite. C'est une erreur de l'appelant, pas un cas à ignorer en silence.
  select string_agg(d.item ->> 'record_id', ', ')
    into v_conflicts
    from jsonb_array_elements(v_decisions) d(item)
   where not ((d.item ->> 'record_id')::uuid = any (v_selected));
  if v_conflicts is not null then
    raise exception 'Décision de correction sur une ligne non retenue : %. Une ligne non écrite ne corrige rien', v_conflicts;
  end if;

  -- Refus explicite AVANT toute écriture : une ligne non committable désignée est une erreur
  -- de l'appelant, pas un cas à ignorer en silence.
  select string_agg(format('ligne %s (%s)', r.row_number, n.status), ', ')
    into v_rejected
    from public.import_normalized_records n
    join public.import_raw_records r on r.id = n.raw_record_id and r.user_id = n.user_id
   where n.user_id = p_user_id and n.session_id = v_session_id
     and n.id = any (v_selected)
     and n.status not in ('READY', 'WARNING');
  if v_rejected is not null then
    raise exception 'Lignes non committables désignées : %. Une ligne bloquée, doublon ou ignorée ne devient jamais un fait', v_rejected;
  end if;

  for v_record in
    select n.*
      from public.import_normalized_records n
     where n.user_id = p_user_id and n.session_id = v_session_id
       and n.id = any (v_selected)
       and n.status in ('READY', 'WARNING')
       and n.commit_state = 'PENDING'
     order by n.id
  loop
    if v_domain = 'PORTFOLIO_LEDGER' then
      -- ÉCRITURE PAR LA RPC EXISTANTE. Le ledger reste la seule vérité des événements.
      --
      -- L'instrument est passé SOUS SA SEULE FORME RÉSOLUE : `security: { id }`.
      --
      -- C'est délibéré et c'est important. `lfo_record_portfolio_event` accepte aussi un
      -- instrument décrit par son ISIN, son ticker ou son NOM, et dans ce cas elle le CRÉE
      -- s'il est introuvable. Ce chemin est légitime pour une saisie manuelle ; il est
      -- interdit pour un import, où il peuplerait le référentiel d'instruments issus de
      -- graphies de courtier et répartirait les mêmes titres entre plusieurs entrées.
      -- Ne transmettre que l'identifiant déjà tranché ferme cette porte : la RPC vérifie
      -- alors l'existence et ne crée rien.
      v_event_id := public.lfo_record_portfolio_event(
        p_user_id,
        jsonb_build_object(
          'account_id', v_account_id,
          'security', case
                        when v_record.security_id is null then null
                        else jsonb_build_object('id', v_record.security_id)
                      end,
          'event_type', v_record.event_type,
          'event_date', v_record.transaction_date,
          'settlement_date', v_record.settlement_date,
          'quantity', v_record.quantity,
          'unit_price', v_record.unit_price,
          'gross_amount', v_record.gross_amount,
          'fee_amount', v_record.fee_amount,
          'tax_amount', v_record.tax_amount,
          'envelope_cash_amount', v_record.envelope_cash_amount,
          'currency', v_record.currency,
          'external_reference', v_record.external_transaction_id,
          'data_kind', 'ACTUAL',
          'confidence', 'HIGH',
          'source', coalesce(v_record.source, 'Import portefeuille'),
          'notes', v_record.label
        )
      );

      update public.import_normalized_records
         set commit_state = 'COMMITTED', committed_at = now(), portfolio_event_id = v_event_id
       where id = v_record.id and user_id = p_user_id;

      insert into public.import_record_links (
        user_id, session_id, normalized_record_id, target_domain, portfolio_event_id
      ) values (
        p_user_id, v_session_id, v_record.id, 'PORTFOLIO_LEDGER', v_event_id
      );
    else
      if v_record.security_id is null then
        raise exception 'Position sans instrument rattaché : elle ne désigne rien';
      end if;

      -- Détention : une par enveloppe et par instrument. L'unicité garantit qu'un rejeu
      -- retrouve la ligne existante au lieu d'en créer une seconde.
      insert into public.positions (
        user_id, account_id, security_id, is_cash, data_kind, confidence, source
      ) values (
        p_user_id, v_account_id, v_record.security_id, false, 'ACTUAL', 'HIGH',
        coalesce(v_record.source, 'Import portefeuille')
      )
      on conflict (user_id, account_id, security_id) do update set
        data_kind = excluded.data_kind
      returning id into v_position_id;

      -- OBSERVATION DATÉE. Aucun événement n'en est déduit : reconstruire un achat depuis
      -- une position inventerait date, prix et frais.
      --
      -- AUCUN `on conflict do update` SILENCIEUX. Une observation persistée est un FAIT :
      -- l'écraser parce qu'un second fichier porte la même date, sans le dire et sans
      -- décision, remplace une quantité et une valeur de marché déjà lues par un humain.
      -- Trois cas, et trois seulement :
      --
      --   * rien à cette date            → écriture ;
      --   * même date, mêmes valeurs     → RIEN à faire. Rejouer le même fichier reste
      --                                    idempotent, et ce n'est pas une correction ;
      --   * même date, valeurs DIFFÉRENTES → REFUS, sauf DÉCISION STRUCTURÉE portant un
      --     motif et l'état attendu. Le message nomme ce qui change, parce qu'« observation
      --     déjà présente » ne dit pas à l'utilisateur ce qu'il est en train de remplacer.
      --
      -- VERROU AVANT COMPARAISON, et non après : sans `for update`, deux sessions liraient
      -- le même état, se croiraient toutes deux en accord avec leur état attendu, et la
      -- seconde écraserait la première. Le verrou est ce qui rend la détection de conflit
      -- possible ; la comparaison seule ne suffirait pas.
      select * into v_existing
        from public.position_snapshots
       where user_id = p_user_id and position_id = v_position_id
         and snapshot_date = v_record.transaction_date
       for update;

      if not found then
        insert into public.position_snapshots (
          user_id, position_id, snapshot_date, quantity, cost_basis, market_value, currency,
          data_kind, confidence, source
        ) values (
          p_user_id, v_position_id, v_record.transaction_date, v_record.quantity,
          v_record.cost_basis, v_record.market_value, v_record.currency,
          'ACTUAL', 'HIGH', coalesce(v_record.source, 'Import portefeuille')
        )
        returning id into v_snapshot_id;
      else
        v_snapshot_id := v_existing.id;

        -- CHAMPS RÉELLEMENT MODIFIÉS, dérivés sous verrou. `is distinct from` et non `<>` :
        -- un `null` d'un côté et une valeur de l'autre est un CHANGEMENT, et `null <> 1` ne
        -- vaut pas `true`.
        v_changed := array_remove(array[
          case when v_existing.quantity is distinct from v_record.quantity
               then 'quantity' end,
          case when v_existing.cost_basis is distinct from v_record.cost_basis
               then 'cost_basis' end,
          case when v_existing.market_value is distinct from v_record.market_value
               then 'market_value' end,
          case when v_existing.currency is distinct from v_record.currency
               then 'currency' end
        ], null);

        if coalesce(array_length(v_changed, 1), 0) >= 1 then
          v_decision := null;
          select d.item into v_decision
            from jsonb_array_elements(v_decisions) d(item)
           where (d.item ->> 'record_id')::uuid = v_record.id;

          if v_decision is null then
            raise exception
              'Observation du % déjà persistée pour cette détention, avec des valeurs différentes (quantité % → %, valeur de marché % → %). Une correction est une DÉCISION : transmettez-la dans `corrections`, avec son motif et l''état attendu',
              v_record.transaction_date,
              coalesce(v_existing.quantity::text, 'absente'),
              coalesce(v_record.quantity::text, 'absente'),
              coalesce(v_existing.market_value::text, 'absente'),
              coalesce(v_record.market_value::text, 'absente');
          end if;

          v_expected := v_decision -> 'expected';

          -- CONFLIT 1 : la décision ne désigne pas l'observation réellement trouvée. Elle a
          -- été prise sur une autre ligne, ou la détention a changé entre-temps.
          if (v_expected ->> 'snapshot_id')::uuid is distinct from v_existing.id then
            raise exception
              'Conflit de correction : la décision désigne l''observation %, mais celle réellement persistée à la date % est %. Relisez l''état courant avant de décider',
              v_expected ->> 'snapshot_id', v_record.transaction_date, v_existing.id;
          end if;

          -- CONFLIT 2 : l'état attendu n'est PLUS l'état courant. C'est le cas de deux
          -- corrections concurrentes : la seconde doit échouer avec un conflit révisable,
          -- pas remplacer la décision de la première. Les montants sont comparés en
          -- `numeric`, jamais en texte : `10.50` et `10.5` sont le même nombre, et les
          -- déclarer différents fabriquerait un conflit imaginaire.
          -- La validation ci-dessus garantit la FORME : chaque clé est présente, et sa
          -- valeur est soit un JSON `null`, soit une chaîne décimale exacte. La comparaison
          -- n'a donc plus à deviner, et surtout plus à aplatir trois cas distincts sur un
          -- `NULL` : `jsonb_typeof(... ) = 'null'` est la SEULE façon d'obtenir un `NULL`
          -- SQL ici, et elle correspond à une absence DÉCLARÉE.
          --
          -- Le cast en `numeric` est ce qui rend `10.50` et `10.5` égaux : la comparaison est
          -- numérique, jamais textuelle, et une différence de forme ne fabrique pas de
          -- conflit.
          v_conflicts := null;
          if v_existing.quantity is distinct from public.expected_numeric(v_expected, 'quantity') then
            v_conflicts := concat_ws(', ', v_conflicts, format('quantité attendue %s, trouvée %s',
              public.expected_label(v_expected, 'quantity'),
              coalesce(v_existing.quantity::text, 'absente')));
          end if;
          if v_existing.cost_basis is distinct from public.expected_numeric(v_expected, 'cost_basis') then
            v_conflicts := concat_ws(', ', v_conflicts, format('coût de revient attendu %s, trouvé %s',
              public.expected_label(v_expected, 'cost_basis'),
              coalesce(v_existing.cost_basis::text, 'absent')));
          end if;
          if v_existing.market_value is distinct from public.expected_numeric(v_expected, 'market_value') then
            v_conflicts := concat_ws(', ', v_conflicts, format('valeur de marché attendue %s, trouvée %s',
              public.expected_label(v_expected, 'market_value'),
              coalesce(v_existing.market_value::text, 'absente')));
          end if;
          if v_existing.currency is distinct from upper(v_expected ->> 'currency') then
            v_conflicts := concat_ws(', ', v_conflicts, format('devise attendue %s, trouvée %s',
              upper(v_expected ->> 'currency'),
              coalesce(v_existing.currency, 'absente')));
          end if;
          if v_conflicts is not null then
            raise exception
              'Conflit de correction sur l''observation du % : l''état attendu n''est plus l''état courant (%). Une autre décision est passée entre-temps ; relisez-la avant de trancher',
              v_record.transaction_date, v_conflicts;
          end if;

          -- AUDIT D'ABORD, MUTATION ENSUITE. L'ordre est indifférent à l'atomicité — les
          -- deux sont dans la même transaction — mais il est lisible : l'avant est capturé
          -- depuis `v_existing`, lu sous verrou, donc AVANT que l'update ne l'écrase.
          -- ACTEUR VÉRIFIÉ. `p_user_id` est l'identité que le SERVEUR a établie — l'UUID
          -- Supabase Auth du propriétaire, lu de l'environnement serveur derrière une
          -- session authentifiée. Il ne traverse jamais le navigateur, et aucune clé de la
          -- charge ne peut l'influencer : les clés d'acteur sont refusées plus haut.
          --
          -- ACTEUR ≠ RÔLE D'EXÉCUTION : `executed_by` est posé par défaut par la base
          -- (`current_user`) et reste distinct. Confondre les deux ferait passer un rôle
          -- technique pour une personne.
          insert into public.position_snapshot_corrections (
            user_id, session_id, normalized_record_id, position_snapshot_id,
            actor_user_id, reason, before_values, after_values, changed_fields
          ) values (
            p_user_id, v_session_id, v_record.id, v_existing.id,
            p_user_id,
            v_decision ->> 'reason',
            jsonb_build_object(
              'quantity', v_existing.quantity,
              'cost_basis', v_existing.cost_basis,
              'market_value', v_existing.market_value,
              'currency', v_existing.currency,
              'data_kind', v_existing.data_kind,
              'confidence', v_existing.confidence,
              'source', v_existing.source
            ),
            jsonb_build_object(
              'quantity', v_record.quantity,
              'cost_basis', v_record.cost_basis,
              'market_value', v_record.market_value,
              'currency', v_record.currency,
              'data_kind', 'ACTUAL',
              'confidence', 'HIGH',
              'source', coalesce(v_record.source, 'Import portefeuille')
            ),
            v_changed
          );

          update public.position_snapshots
             set quantity = v_record.quantity,
                 cost_basis = v_record.cost_basis,
                 market_value = v_record.market_value,
                 currency = v_record.currency,
                 data_kind = 'ACTUAL',
                 confidence = 'HIGH',
                 source = coalesce(v_record.source, 'Import portefeuille')
           where id = v_snapshot_id and user_id = p_user_id;
        end if;
      end if;

      update public.import_normalized_records
         set commit_state = 'COMMITTED', committed_at = now(), position_snapshot_id = v_snapshot_id
       where id = v_record.id and user_id = p_user_id;

      -- La provenance d'une observation CORRIGÉE est un HISTORIQUE de sessions, exactement
      -- comme celle d'un instantané financier reconstruit depuis un FEC. L'unicité porte
      -- donc sur (propriétaire, session, observation) : sans cela, la session qui corrige
      -- perdrait sa provenance en silence, et l'observation dirait venir de la lecture
      -- qu'elle ne porte plus.
      insert into public.import_record_links (
        user_id, session_id, normalized_record_id, target_domain, position_snapshot_id
      ) values (
        p_user_id, v_session_id, v_record.id, 'PORTFOLIO_POSITION', v_snapshot_id
      )
      on conflict (user_id, session_id, position_snapshot_id) do nothing;
    end if;

    v_written := v_written + 1;
  end loop;

  -- Les lignes non retenues sont EXCLUES explicitement : « pas écrite » et « pas décidée »
  -- sont deux états différents.
  update public.import_normalized_records
     set commit_state = 'EXCLUDED'
   where user_id = p_user_id and session_id = v_session_id and commit_state = 'PENDING';

  update public.import_sessions
     set status = 'COMMITTED', committed_at = now(), committed_count = v_written
   where id = v_session_id and user_id = p_user_id;

  return v_written;
end;
$$;

revoke all on function public.lfo_commit_portfolio_session(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.lfo_commit_portfolio_session(uuid, jsonb) to service_role;
