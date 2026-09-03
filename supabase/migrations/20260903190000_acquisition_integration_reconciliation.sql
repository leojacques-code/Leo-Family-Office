-- ---------------------------------------------------------------------------
-- INTÉGRATION DES CINQ VERTICALES D'ACQUISITION — RÉCONCILIATION
-- ---------------------------------------------------------------------------
-- Cette migration ne crée aucune table et n'ajoute aucun domaine nouveau. Elle répare ce
-- que la COEXISTENCE de cinq verticales écrites en parallèle a silencieusement rétréci.
--
-- Chaque verticale a été écrite sur la même base et a donc choisi les mêmes numéros de
-- version pour les contraintes partagées. Le garde `if not exists (… conname = '…_v3_ck')`
-- que chacune emploie ne PROTÈGE pas dans ce cas : il SAUTE l'extension quand une autre
-- verticale a déjà pris le nom. Le résultat n'est pas une erreur, c'est un rétrécissement
-- muet — la whitelist reste celle de la première migration appliquée, et le domaine de la
-- seconde est refusé à la première écriture, très loin de sa cause.
--
-- LE NOM D'UNE CONTRAINTE N'EST PAS UN NUMÉRO DE VERSION LIBRE. Les formes finales
-- ci-dessous sont donc écrites depuis les définitions RÉELLEMENT ACTIVES, relues en base
-- par `pg_get_constraintdef` après le rejeu des quarante migrations, et non depuis ce que
-- chaque fichier prétend poser.
--
-- ÉLARGIR, JAMAIS REMPLACER PAR PLUS ÉTROIT : chaque forme finale est l'UNION de ce que
-- toutes les verticales exigent. Une seule ligne de whitelist perdue rendrait un domaine
-- entier inécrivable.
--
-- État constaté avant cette migration, et ce qu'il coûtait :
--
--   external_sources_domain_ck            ('COMPANY_REGISTRY') seul
--                                         → la donnée publique immobilière refusée
--   external_sources_shape_ck             + _declared_shape_ck, tous deux GLOBAUX
--                                         → chaque domaine devait satisfaire les exigences
--                                           de l'autre : un registre sans TTL de snapshot
--                                           et une source publique sans mode d'auth
--                                           étaient tous deux refusés
--   import_record_links_domain_v3_ck      TAX_RETURN_FINANCIALS perdu
--                                         → aucune provenance de liasse fiscale écrivable
--   import_record_links_target_v3_ck      branche TAX_RETURN_FINANCIALS perdue, et
--                                         `extraction_run_id is null` perdu sur les autres
--                                         → un lien pouvait porter deux faits à la fois
--   import_upload_tickets_domain_v2_ck    PORTFOLIO_FILE perdu
--                                         → aucun classeur de portefeuille déposable

-- ---------------------------------------------------------------------------
-- 1. `external_sources` : un registre, plusieurs domaines, une forme PAR DOMAINE
-- ---------------------------------------------------------------------------
-- Deux verticales adoptent cette table : le registre d'entreprises et la donnée publique
-- immobilière. Elles n'ont pas les mêmes exigences, et c'est légitime — un registre
-- s'authentifie, un jeu de données public se périme. Exprimer ces exigences GLOBALEMENT
-- imposait à chacune celles de l'autre.
alter table public.external_sources drop constraint if exists external_sources_domain_ck;
alter table public.external_sources drop constraint if exists external_sources_shape_ck;
alter table public.external_sources drop constraint if exists external_sources_declared_shape_ck;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'external_sources_domain_v2_ck') then
    -- UNION des domaines réellement supportés par des tables d'instantané. Un domaine
    -- déclaré sans support serait une promesse que la base ne tient pas ; les deux
    -- ci-dessous ont chacun les leurs.
    alter table public.external_sources add constraint external_sources_domain_v2_ck
      check (domain is null or domain in ('COMPANY_REGISTRY', 'REAL_ESTATE_PUBLIC_DATA'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'external_sources_shape_v2_ck') then
    -- Forme PAR DOMAINE. Le tronc commun est ce qui rend un instantané rejouable : qui a
    -- été interrogé, et avec quelle version d'adaptateur. Le reste est propre au domaine.
    alter table public.external_sources add constraint external_sources_shape_v2_ck
      check (
        case
          when domain is null then true
          -- Un registre s'AUTHENTIFIE : sans mode d'authentification déclaré, rien ne dit
          -- comment la connexion est censée s'établir.
          when domain = 'COMPANY_REGISTRY'
            then provider is not null and adapter_version is not null and auth_mode is not null
          -- Un jeu de données public se PÉRIME : sans durée de fraîcheur déclarée, un
          -- instantané vieux de deux ans serait lu comme courant. Le mode
          -- d'authentification, lui, n'est PAS exigé — ces jeux sont ouverts, et l'exiger
          -- obligerait à en inventer un.
          when domain = 'REAL_ESTATE_PUBLIC_DATA'
            then provider is not null and adapter_version is not null
                 and snapshot_ttl_minutes is not null and snapshot_ttl_minutes > 0
          -- UN CONTRÔLE, UN INVARIANT. L'existence d'un domaine est décidée par la
          -- whitelist `external_sources_domain_v2_ck`, et par elle seule. Refuser ici un
          -- domaine inconnu ferait remonter une contrainte de FORME là où la cause est une
          -- whitelist, et rendrait le diagnostic trompeur.
          else true
        end
      );
  end if;
end $$;

comment on constraint external_sources_domain_v2_ck on public.external_sources is
  'Union des domaines de connexion externe réellement supportés. Élargie à l''intégration : la contrainte antérieure ne portait que le domaine de la première verticale appliquée.';
comment on constraint external_sources_shape_v2_ck on public.external_sources is
  'Exigences PAR DOMAINE. Deux contraintes globales coexistaient et imposaient à chaque domaine celles de l''autre : un registre sans TTL et une source publique sans mode d''authentification étaient tous deux refusés.';

-- ---------------------------------------------------------------------------
-- 2. `import_record_links` : cinq domaines cibles, une seule colonne renseignée
-- ---------------------------------------------------------------------------
-- Quatre verticales écrivent une provenance ici. La forme finale est l'union des cinq
-- domaines, et surtout : chaque branche énumère TOUTES les colonnes cibles, y compris
-- celles des autres domaines, pour qu'un lien ne puisse jamais en porter deux.
--
-- C'est ce que la coexistence avait cassé : la forme retenue ignorait `extraction_run_id`,
-- si bien qu'un lien de transaction bancaire pouvait AUSSI désigner un run d'extraction.
alter table public.import_record_links drop constraint if exists import_record_links_domain_v3_ck;
alter table public.import_record_links drop constraint if exists import_record_links_target_v3_ck;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_record_links_domain_v4_ck') then
    alter table public.import_record_links add constraint import_record_links_domain_v4_ck
      check (
        target_domain in (
          'CASH_FLOW_TRANSACTION',
          'BUSINESS_ACCOUNTING',
          'TAX_RETURN_FINANCIALS',
          'PORTFOLIO_LEDGER',
          'PORTFOLIO_POSITION'
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'import_record_links_target_v4_ck') then
    alter table public.import_record_links add constraint import_record_links_target_v4_ck
      check (
        case target_domain
          -- Relevé bancaire et synchronisation Open Banking : même domaine cible, même
          -- forme. Une opération lue par API n'est pas d'une autre nature qu'une opération
          -- lue dans un fichier.
          when 'CASH_FLOW_TRANSACTION' then
            transaction_id is not null and normalized_record_id is not null
            and session_id is not null
            and business_financials_id is null and extraction_run_id is null
            and portfolio_event_id is null and position_snapshot_id is null
          -- FEC : l'unité est la SESSION entière, pas une ligne normalisée.
          when 'BUSINESS_ACCOUNTING' then
            business_financials_id is not null and session_id is not null
            and transaction_id is null and normalized_record_id is null
            and extraction_run_id is null
            and portfolio_event_id is null and position_snapshot_id is null
          -- Liasse fiscale : l'unité est le RUN d'extraction, et il n'y a pas de session
          -- d'import derrière — le document ne se lit pas ligne par ligne.
          when 'TAX_RETURN_FINANCIALS' then
            business_financials_id is not null and extraction_run_id is not null
            and session_id is null
            and transaction_id is null and normalized_record_id is null
            and portfolio_event_id is null and position_snapshot_id is null
          when 'PORTFOLIO_LEDGER' then
            portfolio_event_id is not null and normalized_record_id is not null
            and session_id is not null
            and transaction_id is null and business_financials_id is null
            and extraction_run_id is null and position_snapshot_id is null
          when 'PORTFOLIO_POSITION' then
            position_snapshot_id is not null and normalized_record_id is not null
            and session_id is not null
            and transaction_id is null and business_financials_id is null
            and extraction_run_id is null and portfolio_event_id is null
          else false
        end
      );
  end if;
end $$;

comment on constraint import_record_links_target_v4_ck on public.import_record_links is
  'Une colonne cible par domaine, et une SEULE renseignée. Chaque branche énumère toutes les colonnes cibles : la forme antérieure ignorait extraction_run_id, si bien qu''un lien de transaction pouvait aussi désigner un run d''extraction.';

-- ---------------------------------------------------------------------------
-- 3. `import_upload_tickets` : trois domaines de dépôt
-- ---------------------------------------------------------------------------
-- Trois verticales déposent un fichier volumineux directement au stockage privé : la
-- comptabilité, la liasse fiscale et le portefeuille. Le domaine du billet décide de ce que
-- le fichier deviendra analysable.
alter table public.import_upload_tickets drop constraint if exists import_upload_tickets_domain_v2_ck;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_upload_tickets_domain_v3_ck') then
    alter table public.import_upload_tickets add constraint import_upload_tickets_domain_v3_ck
      check (domain in ('BUSINESS_ACCOUNTING', 'DOCUMENT_EXTRACTION', 'PORTFOLIO_FILE'));
  end if;
end $$;

comment on constraint import_upload_tickets_domain_v3_ck on public.import_upload_tickets is
  'Union des domaines de dépôt direct. La contrainte antérieure avait perdu PORTFOLIO_FILE : aucun classeur n''était déposable, et l''échec survenait à l''émission du billet.';

-- ---------------------------------------------------------------------------
-- 4. `external_sources.capabilities` : deux formes, une par domaine
-- ---------------------------------------------------------------------------
-- Conflit RÉEL de convention sur une colonne partagée, découvert par le rejeu :
--
--   * le registre d'entreprises déclare ses capacités comme une LISTE de noms
--     (`["SIREN_LOOKUP", "OFFICERS"]`), avec `default '[]'` et une contrainte
--     `jsonb_typeof = 'array'` ;
--   * la donnée publique immobilière les déclare comme un OBJET de drapeaux
--     (`{"fields": [...], "declaresCoverage": true, "stableRecordId": false}`).
--
-- La colonne préexistant, `add column if not exists` a laissé le défaut de la première
-- verticale, et la contrainte de la première REFUSAIT l'écriture de la seconde. Concrètement :
-- `lfo_upsert_public_data_source` échouait à chaque appel dès que les deux migrations
-- coexistaient.
--
-- Aucune des deux conventions n'est fautive, et aucune ne peut être imposée à l'autre sans
-- perdre du sens : une liste de noms ne porte pas `declaresCoverage`, et un objet de
-- drapeaux ne se lit pas comme une énumération. La FORME appartient donc au contrat
-- d'adaptateur du domaine, et c'est la base qui l'exige PAR DOMAINE.
alter table public.external_sources drop constraint if exists external_sources_capabilities_ck;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'external_sources_capabilities_v2_ck') then
    alter table public.external_sources add constraint external_sources_capabilities_v2_ck
      check (
        case
          -- Aucune connexion déclarée : les deux formes vides sont acceptées, parce que le
          -- défaut de la colonne est `[]` et qu'une ligne héritée n'a rien à déclarer.
          when domain is null then jsonb_typeof(capabilities) in ('array', 'object')
          when domain = 'COMPANY_REGISTRY' then jsonb_typeof(capabilities) = 'array'
          -- Un adaptateur de donnée publique DOIT déclarer ses capacités : le défaut `[]`
          -- de la colonne ne passe pas, et c'est voulu. Une capacité non déclarée n'est pas
          -- une capacité absente, mais une inconnue — et une inconnue ne doit pas être lue
          -- comme « ce fournisseur ne sert pas ce champ ».
          when domain = 'REAL_ESTATE_PUBLIC_DATA' then jsonb_typeof(capabilities) = 'object'
          -- Même règle : un domaine inconnu est refusé par la whitelist, pas ici.
          else true
        end
      );
  end if;
end $$;

comment on constraint external_sources_capabilities_v2_ck on public.external_sources is
  'Forme des capacités déclarées, PAR DOMAINE : liste de noms pour un registre, objet de drapeaux pour un jeu de données public. Deux verticales donnaient à cette colonne deux conventions incompatibles, et la contrainte de la première refusait les écritures de la seconde.';

-- ---------------------------------------------------------------------------
-- 5. Unicité d'une connexion externe : (utilisateur, DOMAINE, fournisseur)
-- ---------------------------------------------------------------------------
-- `external_sources_provider_uk` était `unique (user_id, provider)` : un nom de fournisseur
-- ne pouvait exister qu'une fois, TOUS DOMAINES CONFONDUS. C'est plus étroit que ce que
-- chacune des deux verticales exprime — l'une identifie une connexion par
-- (domaine, fournisseur), l'autre aussi — et cela interdirait par exemple qu'un même
-- portail serve un registre et un jeu de données immobilier.
--
-- ÉLARGIR, JAMAIS REMPLACER PAR PLUS ÉTROIT : l'unicité devient
-- (utilisateur, domaine, fournisseur). Une unicité NON partielle est choisie délibérément :
-- `on conflict` ne peut inférer un index partiel sans répéter son prédicat, et la RPC de la
-- donnée publique s'appuie sur cette inférence.
alter table public.external_sources drop constraint if exists external_sources_provider_uk;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'external_sources_domain_provider_uk') then
    alter table public.external_sources add constraint external_sources_domain_provider_uk
      unique (user_id, domain, provider);
  end if;
end $$;

comment on constraint external_sources_domain_provider_uk on public.external_sources is
  'Une connexion par (utilisateur, domaine, fournisseur). Remplace une unicité (utilisateur, fournisseur) qui interdisait le même nom de fournisseur dans deux domaines.';

-- La RPC de la donnée publique suit l'unicité élargie. Version reprise de la DERNIÈRE en
-- vigueur, `20260831171500_real_estate_public_data` : seule la cible du `on conflict`
-- change, et le corps reste identique pour ne rien perdre au passage.
create or replace function public.lfo_upsert_public_data_source(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_provider text;
  v_domain text;
begin
  v_provider := nullif(btrim(p_payload ->> 'provider'), '');
  if v_provider is null then
    raise exception 'Un adaptateur sans provider ne peut pas être identifié';
  end if;
  v_domain := coalesce(nullif(p_payload ->> 'domain', ''), 'REAL_ESTATE_PUBLIC_DATA');

  insert into public.external_sources (
    id, user_id, name, source_type, url, status,
    domain, provider, adapter_version, dataset_version,
    capabilities, declared_coverage, licence, base_url, snapshot_ttl_minutes, created_at, updated_at
  ) values (
    gen_random_uuid(), p_user_id,
    coalesce(nullif(p_payload ->> 'label', ''), v_provider),
    coalesce(nullif(p_payload ->> 'source_type', ''), 'PUBLIC_DATA'),
    nullif(p_payload ->> 'base_url', ''),
    coalesce(nullif(p_payload ->> 'status', ''), 'ACTIVE'),
    v_domain,
    v_provider,
    coalesce(nullif(p_payload ->> 'adapter_version', ''), '1'),
    nullif(p_payload ->> 'dataset_version', ''),
    coalesce(p_payload -> 'capabilities', '{}'::jsonb),
    coalesce(p_payload -> 'declared_coverage', '{}'::jsonb),
    nullif(p_payload ->> 'licence', ''),
    nullif(p_payload ->> 'base_url', ''),
    coalesce((p_payload ->> 'snapshot_ttl_minutes')::integer, 1440),
    now(), now()
  )
  on conflict (user_id, domain, provider) do update set
    name = excluded.name,
    source_type = excluded.source_type,
    url = excluded.url,
    status = excluded.status,
    adapter_version = excluded.adapter_version,
    dataset_version = excluded.dataset_version,
    capabilities = excluded.capabilities,
    declared_coverage = excluded.declared_coverage,
    licence = excluded.licence,
    base_url = excluded.base_url,
    snapshot_ttl_minutes = excluded.snapshot_ttl_minutes,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.lfo_upsert_public_data_source(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_upsert_public_data_source(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Unicité d'une identité démontrée dans le staging : à la VALIDATION, pas à la LECTURE
-- ---------------------------------------------------------------------------
-- Deux unicités concurrentes coexistaient sur `import_normalized_records.external_key`, et
-- elles ne disent pas la même chose :
--
--   * le socle d'acquisition : `unique (user_id, external_key) where commit_state =
--     'COMMITTED'` — une identité démontrée ne s'ÉCRIT qu'une fois, mais peut être LUE
--     autant de fois qu'une source la présente ;
--   * la verticale portefeuille : `unique (user_id, target_domain, external_key) where
--     external_key is not null` — une identité ne peut être lue qu'une fois, jamais.
--
-- La seconde interdit un flux LÉGITIME, et c'est le rejeu de la synchronisation bancaire
-- qui l'a révélé : une opération déjà validée est REVUE à chaque synchronisation, et c'est
-- précisément en la restageant qu'on peut la montrer comme doublon à l'utilisateur.
-- L'interdire obligerait soit à ne rien restager — donc à perdre la trace de ce que le
-- fournisseur a redit — soit à ne pas renseigner l'identité, donc à perdre la seule preuve
-- qui autorise un rejet automatique.
--
-- La forme finale garde la SÉMANTIQUE DU SOCLE et la RAFFINE PAR DOMAINE, apport de la
-- verticale portefeuille : la même chaîne d'identifiant peut désigner un événement de
-- ledger et une observation de position sans que l'une empêche l'autre.
drop index if exists public.import_normalized_records_committed_external_uidx;
drop index if exists public.import_normalized_records_external_key_uidx;

create unique index if not exists import_normalized_records_committed_external_v2_uidx
  on public.import_normalized_records(user_id, target_domain, external_key)
  where commit_state = 'COMMITTED' and external_key is not null;

-- Recherche d'identité sur TOUT l'historique, sans filtre de date : c'est ce que fait la
-- réconciliation avant de déclarer une opération nouvelle. L'index n'est pas unique — il
-- sert la LECTURE, là où l'unicité ci-dessus sert l'ÉCRITURE.
create index if not exists import_normalized_records_external_key_idx
  on public.import_normalized_records(user_id, target_domain, external_key)
  where external_key is not null;
