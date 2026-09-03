-- ===========================================================================
-- PORTFOLIO IMPORT ACQUISITION — import générique CSV / XLSX de portefeuille
--
-- Quatrième verticale de la fondation d'acquisition. Elle N'AJOUTE AUCUN LEDGER : le ledger
-- portefeuille existe depuis `portfolio_data_foundation`, avec ses douze natures
-- d'événement et sa RPC d'écriture. Cette migration branche un import de fichier dessus.
--
-- Ce qui est RÉUTILISÉ tel quel, sans une ligne de modification :
--
--   * `import_sources`, `import_sessions`, `import_raw_records`, `import_column_mappings` :
--     un import de portefeuille est un import de fichier lu ligne par ligne, exactement le
--     même objet qu'un relevé bancaire ;
--   * `import_upload_tickets` et la zone de staging : un classeur dépasse la taille de corps
--     qu'une fonction serverless accepte, donc le fichier va du NAVIGATEUR au stockage privé,
--     comme pour le FEC ;
--   * `lfo_record_portfolio_event` : UNIQUE porte d'écriture de `portfolio_events`.
--
-- Ce qui est ÉTENDU, avec des colonnes et des lignes de check plutôt qu'une table parallèle.
-- Le commentaire de `import_record_links` l'annonçait : « Ajouter Portfolio ou Real Estate
-- demandera une colonne et une ligne de check : c'est le prix d'une intégrité réelle plutôt
-- que d'un `target_id uuid` sans contrainte. » C'est ce qui est fait ici.
--
-- ---------------------------------------------------------------------------
-- LA DISTINCTION QUI STRUCTURE TOUT : POSITION OBSERVÉE ≠ TRANSACTION DU LEDGER
--
-- Un relevé de positions dit « au 30 juin, je détenais 12 parts valant 4 500 € ». Il ne dit
-- PAS quand ni à quel prix elles ont été achetées. Reconstruire un achat depuis une position
-- inventerait une date, un prix et des frais, et le coût de revient qui en découlerait serait
-- faux tout en paraissant calculé. Les deux natures sont donc DEUX DOMAINES CIBLES distincts,
-- écrits dans deux tables distinctes, et jamais convertis l'un dans l'autre.
--
-- Autres invariants portés par cette migration :
--
--   BRUT IMMUABLE. `import_raw_records` porte déjà son trigger de gel : il s'applique.
--   CORRECTION ≠ BRUT. Une correction écrit la ligne NORMALISÉE, jamais la ligne brute.
--   ABSENT ≠ ZÉRO. Frais, taxes, coût de revient et effet cash restent `null` sans valeur.
--   DEVISE ABSENTE ≠ DEVISE ÉGALE À CELLE DE L'ENVELOPPE, sauf déclaration signalée.
--   AUCUN DOUBLON AU REJEU. Une identité déclarée porte une unicité ; une ressemblance non.
--   AUCUN FAIT SANS RATTACHEMENT. Ni instrument non résolu, ni enveloppe absente.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. `positions` — l'unicité qui manquait
-- ---------------------------------------------------------------------------
-- DEUX LIGNES `positions` POUR LE MÊME COUPLE ENVELOPPE + INSTRUMENT SCINDERAIENT LA MÊME
-- DÉTENTION EN DEUX. Le bilan compterait alors deux fois, ou une fois sur deux, selon
-- laquelle est lue. Cette unicité n'existait pas ; sans elle, rejouer un fichier créerait une
-- seconde ligne au lieu de retrouver la première, et l'idempotence serait impossible.
--
-- Si la base porte déjà des doublons, cette migration ÉCHOUE. C'est le bon comportement :
-- ces doublons faussent déjà les lectures, et les découvrir vaut mieux que les contourner.
-- Requête de diagnostic à passer AVANT application :
--   select user_id, account_id, security_id, count(*)
--     from public.positions group by 1,2,3 having count(*) > 1;
create unique index if not exists positions_id_user_uidx
  on public.positions(id, user_id);
create unique index if not exists positions_envelope_instrument_uidx
  on public.positions(user_id, account_id, security_id);

-- Cible de provenance : un événement et une observation doivent être référençables par
-- (id, user_id). `portfolio_events` porte bien une unicité composite, mais elle inclut
-- l'enveloppe, l'instrument et le fait d'ouvrir un lot : elle sert la FK du lot désigné, et
-- ne peut pas servir de cible à une FK de provenance à deux colonnes.
create unique index if not exists portfolio_events_id_user_uidx
  on public.portfolio_events(id, user_id);

-- Cible de provenance : une observation doit être référençable par (id, user_id).
create unique index if not exists position_snapshots_id_user_uidx
  on public.position_snapshots(id, user_id);

-- Une observation par instrument et par DATE. Une position est une observation datée : deux
-- observations du même instrument au même jour sont la même observation, et la seconde
-- corrige la première. C'est ce qui rend l'import incrémental sûr — une nouvelle date
-- s'ajoute, elle n'écrase rien — et le rejeu idempotent.
create unique index if not exists position_snapshots_observation_uidx
  on public.position_snapshots(user_id, position_id, snapshot_date);

comment on index public.positions_envelope_instrument_uidx is
  'Une détention par enveloppe et par instrument. Deux lignes scinderaient la même détention et fausseraient le bilan.';
comment on index public.position_snapshots_observation_uidx is
  'Une observation par instrument et par date. Une position est une observation datée, elle ne se cumule pas.';

-- ---------------------------------------------------------------------------
-- 2. `import_sources` — deux domaines de plus
-- ---------------------------------------------------------------------------
-- La version EN VIGUEUR de ces deux contraintes est `_v2_ck`, posée par la migration FEC :
-- elle connaît CASH_FLOW_TRANSACTION et BUSINESS_ACCOUNTING, et son `else false` refuse tout
-- le reste. On l'étend en `_v3_ck` en reprenant sa forme réelle, colonne de cible comprise.
--
-- ATTENTION, ERREUR ÉVITÉE ICI : un `if not exists (… conname = '…_v2_ck')` aurait SAUTÉ
-- l'extension en silence, puisque le nom était déjà pris. Le nom d'une contrainte n'est pas
-- un numéro de version libre : il faut lire le schéma réel, pas supposer que `_v2` est
-- disponible. Le refus se serait alors produit à la première écriture, loin d'ici.
alter table public.import_sources drop constraint if exists import_sources_domain_ck;
alter table public.import_sources drop constraint if exists import_sources_domain_v2_ck;
alter table public.import_sources drop constraint if exists import_sources_domain_shape_ck;
alter table public.import_sources drop constraint if exists import_sources_domain_shape_v2_ck;
alter table public.import_sources add constraint import_sources_domain_v3_ck
  check (
    domain in (
      'CASH_FLOW_TRANSACTION', 'BUSINESS_ACCOUNTING', 'PORTFOLIO_LEDGER', 'PORTFOLIO_POSITION'
    )
  );
-- Chaque domaine dit ce qu'il exige, et interdit ce qui ne le concerne pas : une source
-- comptable ne vise pas une enveloppe bancaire, et une source de portefeuille ne vise pas
-- une société. Les deux domaines de portefeuille exigent une ENVELOPPE, comme le flux
-- bancaire : `portfolio_events.account_id` est NOT NULL, et une position sans enveloppe ne
-- serait réconciliable par rien.
alter table public.import_sources add constraint import_sources_domain_shape_v3_ck
  check (
    case domain
      when 'CASH_FLOW_TRANSACTION' then target_account_id is not null and target_business_id is null
      when 'BUSINESS_ACCOUNTING' then target_business_id is not null and target_account_id is null
      when 'PORTFOLIO_LEDGER' then target_account_id is not null and target_business_id is null
      when 'PORTFOLIO_POSITION' then target_account_id is not null and target_business_id is null
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- 3. `import_normalized_records` — les termes propres au portefeuille
-- ---------------------------------------------------------------------------
-- Colonnes ajoutées à la table de staging EXISTANTE, plutôt qu'une seconde table de staging.
-- Cette table porte DÉJÀ des colonnes propres à un domaine (`balance_after` n'a de sens que
-- pour un relevé bancaire) : elle est par construction une table à colonnes par domaine, et
-- la forme committable est arbitrée par un `case target_domain`. Ouvrir une table parallèle
-- aurait dupliqué session, brut, statut, verdict et discipline de commit — soit une seconde
-- vérité de staging pour le même objet.

alter table public.import_normalized_records add column if not exists security_id uuid;
alter table public.import_normalized_records add column if not exists event_type text;
alter table public.import_normalized_records add column if not exists settlement_date date;
-- Quantité TOUJOURS positive : la direction vient de la nature, jamais du signe.
alter table public.import_normalized_records add column if not exists quantity numeric(30,10);
alter table public.import_normalized_records add column if not exists unit_price numeric(20,6);
alter table public.import_normalized_records add column if not exists gross_amount numeric(20,6);
-- `null` = frais INCONNUS. Ce n'est pas zéro : un coût de revient dont les frais sont
-- inconnus n'est pas un coût de revient sans frais.
alter table public.import_normalized_records add column if not exists fee_amount numeric(20,6);
alter table public.import_normalized_records add column if not exists tax_amount numeric(20,6);
-- Seul terme SIGNÉ du domaine : l'effet sur le cash de l'enveloppe.
alter table public.import_normalized_records add column if not exists envelope_cash_amount numeric(20,6);
alter table public.import_normalized_records add column if not exists market_value numeric(20,6);
alter table public.import_normalized_records add column if not exists cost_basis numeric(20,6);
-- Clé de source de l'instrument, telle que le fichier l'écrit. Elle regroupe les lignes qui
-- citent le même titre pour qu'une seule décision les résolve toutes.
alter table public.import_normalized_records add column if not exists instrument_source_key text;
-- Identifiants lus TELS QUELS, conservés même après résolution : la provenance au niveau du
-- CHAMP exige de pouvoir relire ce que la source disait.
alter table public.import_normalized_records add column if not exists source_isin text;
alter table public.import_normalized_records add column if not exists source_ticker text;
alter table public.import_normalized_records add column if not exists source_instrument_name text;
-- Fait canonique produit. Renseigné à la validation, en même temps que la provenance.
alter table public.import_normalized_records add column if not exists portfolio_event_id uuid;
alter table public.import_normalized_records add column if not exists position_snapshot_id uuid;
alter table public.import_normalized_records add column if not exists matched_portfolio_event_id uuid;
alter table public.import_normalized_records add column if not exists matched_position_snapshot_id uuid;
-- CORRECTION ≠ BRUT. La correction vit ici ; `import_raw_records` reste gelé par son trigger.
alter table public.import_normalized_records add column if not exists corrected_at timestamptz;
alter table public.import_normalized_records add column if not exists correction_reason text;
-- Provenance au niveau du CHAMP : quels champs l'utilisateur a corrigés, et avec quoi.
alter table public.import_normalized_records add column if not exists field_corrections jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_security_fk') then
    alter table public.import_normalized_records
      add constraint import_normalized_records_security_fk
      foreign key (security_id, user_id)
      references public.securities(id, user_id)
      on delete set null (security_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_event_fk') then
    -- PAS de cascade : supprimer un événement importé alors que sa provenance existe encore
    -- le laisserait étiqueté « importé » sans pouvoir dire d'où il vient.
    alter table public.import_normalized_records
      add constraint import_normalized_records_event_fk
      foreign key (portfolio_event_id, user_id)
      references public.portfolio_events(id, user_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_snapshot_fk') then
    alter table public.import_normalized_records
      add constraint import_normalized_records_snapshot_fk
      foreign key (position_snapshot_id, user_id)
      references public.position_snapshots(id, user_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_matched_event_fk') then
    -- Le doublon DÉSIGNÉ peut disparaître : le lien se détache, la ligne reste.
    alter table public.import_normalized_records
      add constraint import_normalized_records_matched_event_fk
      foreign key (matched_portfolio_event_id, user_id)
      references public.portfolio_events(id, user_id)
      on delete set null (matched_portfolio_event_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_matched_snapshot_fk') then
    alter table public.import_normalized_records
      add constraint import_normalized_records_matched_snapshot_fk
      foreign key (matched_position_snapshot_id, user_id)
      references public.position_snapshots(id, user_id)
      on delete set null (matched_position_snapshot_id);
  end if;
end $$;

alter table public.import_normalized_records drop constraint if exists import_normalized_records_domain_ck;
alter table public.import_normalized_records drop constraint if exists import_normalized_records_ready_shape_ck;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_domain_v2_ck') then
    alter table public.import_normalized_records add constraint import_normalized_records_domain_v2_ck
      check (target_domain in ('CASH_FLOW_TRANSACTION', 'PORTFOLIO_LEDGER', 'PORTFOLIO_POSITION'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_ready_shape_v2_ck') then
    -- READY signifie COMMITTABLE, et la forme committable dépend du domaine. Une ligne prête
    -- dont un terme indispensable manquerait produirait un fait incomplet : la base le refuse
    -- domaine par domaine, plutôt que de laisser l'application s'en souvenir.
    alter table public.import_normalized_records add constraint import_normalized_records_ready_shape_v2_ck
      check (
        case
          when status not in ('READY', 'WARNING') then true
          when target_domain = 'CASH_FLOW_TRANSACTION' then
            transaction_date is not null and label is not null
            and amount is not null and currency is not null and account_id is not null
          when target_domain = 'PORTFOLIO_LEDGER' then
            transaction_date is not null and currency is not null
            and account_id is not null and event_type is not null
          when target_domain = 'PORTFOLIO_POSITION' then
            transaction_date is not null and currency is not null
            and account_id is not null and security_id is not null
            -- `position_snapshots.market_value` est NOT NULL : une position prête sans valeur
            -- observée échouerait à l'écriture, donc elle n'est jamais prête.
            and market_value is not null
          else false
        end
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_security_shape_ck') then
    -- Les mêmes règles de forme que `portfolio_events`, appliquées DÈS LE STAGING : un achat
    -- sans titre et un apport avec titre sont refusés avant l'écriture, pas pendant.
    alter table public.import_normalized_records add constraint import_normalized_records_security_shape_ck
      check (
        case
          when target_domain <> 'PORTFOLIO_LEDGER' or status not in ('READY', 'WARNING') then true
          when event_type in ('OPENING_POSITION', 'BUY', 'SELL') then security_id is not null
          when event_type in ('OPENING_CASH', 'CONTRIBUTION', 'WITHDRAWAL') then security_id is null
          else true
        end
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_event_type_ck') then
    -- Whitelist reprise TELLE QUELLE de `portfolio_events_type_ck` : le staging ne peut pas
    -- proposer une nature que le ledger refuse.
    alter table public.import_normalized_records add constraint import_normalized_records_event_type_ck
      check (
        event_type is null
        or event_type in (
          'OPENING_POSITION', 'OPENING_CASH', 'CONTRIBUTION', 'WITHDRAWAL',
          'BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE', 'TAX',
          'TRANSFER_IN', 'TRANSFER_OUT'
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_quantity_ck') then
    -- Quantité, prix et montants bruts TOUJOURS positifs : la direction vient de la nature.
    alter table public.import_normalized_records add constraint import_normalized_records_quantity_ck
      check (quantity is null or quantity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_price_ck') then
    alter table public.import_normalized_records add constraint import_normalized_records_price_ck
      check (unit_price is null or unit_price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_gross_ck') then
    alter table public.import_normalized_records add constraint import_normalized_records_gross_ck
      check (gross_amount is null or gross_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_fee_ck') then
    alter table public.import_normalized_records add constraint import_normalized_records_fee_ck
      check ((fee_amount is null or fee_amount >= 0) and (tax_amount is null or tax_amount >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_market_value_ck') then
    alter table public.import_normalized_records add constraint import_normalized_records_market_value_ck
      check (market_value is null or market_value >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_written_shape_ck') then
    -- Une ligne COMMITTÉE porte le fait qu'elle a produit, et un seul : sans cela, la
    -- provenance serait déclarative plutôt que vérifiable.
    alter table public.import_normalized_records add constraint import_normalized_records_written_shape_ck
      check (
        case
          when commit_state <> 'COMMITTED' then true
          when target_domain = 'CASH_FLOW_TRANSACTION' then
            portfolio_event_id is null and position_snapshot_id is null
          when target_domain = 'PORTFOLIO_LEDGER' then
            portfolio_event_id is not null and position_snapshot_id is null
          when target_domain = 'PORTFOLIO_POSITION' then
            position_snapshot_id is not null and portfolio_event_id is null
          else false
        end
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_corrections_ck') then
    alter table public.import_normalized_records add constraint import_normalized_records_corrections_ck
      check (field_corrections is null or jsonb_typeof(field_corrections) = 'object');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'import_normalized_records_correction_shape_ck') then
    -- Une correction porte sa date ET son contenu : « corrigé » sans dire quoi ne se relit pas.
    alter table public.import_normalized_records add constraint import_normalized_records_correction_shape_ck
      check (
        (corrected_at is null and field_corrections is null)
        or (corrected_at is not null and field_corrections is not null)
      );
  end if;
end $$;

-- Un fait canonique n'est produit QUE par une ligne d'import : deux lignes qui prétendraient
-- l'avoir écrit rendraient la provenance indéterminée.
create unique index if not exists import_normalized_records_event_uidx
  on public.import_normalized_records(user_id, portfolio_event_id)
  where portfolio_event_id is not null;
create unique index if not exists import_normalized_records_snapshot_uidx
  on public.import_normalized_records(user_id, position_snapshot_id)
  where position_snapshot_id is not null;

-- L'IDENTITÉ DÉCLARÉE porte l'unicité, et elle seule. Aucune contrainte ne s'appuie sur
-- `match_key`, qui n'est qu'une ressemblance : une égalité de tuple entre deux fichiers ne
-- prouve pas qu'il s'agit du même ordre, et une unicité là-dessus supprimerait des titres.
create unique index if not exists import_normalized_records_external_key_uidx
  on public.import_normalized_records(user_id, target_domain, external_key)
  where external_key is not null;

create index if not exists import_normalized_records_instrument_idx
  on public.import_normalized_records(user_id, session_id, instrument_source_key)
  where instrument_source_key is not null;
create index if not exists import_normalized_records_security_idx
  on public.import_normalized_records(security_id, user_id)
  where security_id is not null;
create index if not exists import_normalized_records_event_fk_idx
  on public.import_normalized_records(portfolio_event_id, user_id)
  where portfolio_event_id is not null;
create index if not exists import_normalized_records_snapshot_fk_idx
  on public.import_normalized_records(position_snapshot_id, user_id)
  where position_snapshot_id is not null;
create index if not exists import_normalized_records_matched_event_idx
  on public.import_normalized_records(matched_portfolio_event_id, user_id)
  where matched_portfolio_event_id is not null;
create index if not exists import_normalized_records_matched_snapshot_idx
  on public.import_normalized_records(matched_position_snapshot_id, user_id)
  where matched_position_snapshot_id is not null;

-- ---------------------------------------------------------------------------
-- 4. `import_record_links` — deux colonnes cibles de plus
-- ---------------------------------------------------------------------------
alter table public.import_record_links add column if not exists portfolio_event_id uuid;
alter table public.import_record_links add column if not exists position_snapshot_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'import_record_links_event_fk') then
    -- PAS de cascade, même invariant d'audit que pour `transactions` : la suppression est
    -- REFUSÉE tant que la provenance existe.
    alter table public.import_record_links
      add constraint import_record_links_event_fk
      foreign key (portfolio_event_id, user_id)
      references public.portfolio_events(id, user_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_record_links_snapshot_fk') then
    alter table public.import_record_links
      add constraint import_record_links_snapshot_fk
      foreign key (position_snapshot_id, user_id)
      references public.position_snapshots(id, user_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_record_links_event_uk') then
    alter table public.import_record_links
      add constraint import_record_links_event_uk unique (user_id, portfolio_event_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'import_record_links_snapshot_uk') then
    alter table public.import_record_links
      add constraint import_record_links_snapshot_uk unique (user_id, position_snapshot_id);
  end if;
end $$;

-- Même précaution : la version en vigueur est `_v2_ck`, posée par FEC, et elle porte
-- `business_financials_id` ainsi que la règle « une écriture comptable n'a pas de ligne
-- normalisée ». Sa forme réelle est reprise ici, et étendue plutôt que remplacée de mémoire.
alter table public.import_record_links drop constraint if exists import_record_links_domain_ck;
alter table public.import_record_links drop constraint if exists import_record_links_domain_v2_ck;
alter table public.import_record_links drop constraint if exists import_record_links_target_ck;
alter table public.import_record_links drop constraint if exists import_record_links_target_v2_ck;
-- INTÉGRATION : `_v3_ck` peut déjà exister, posée par la verticale documentaire, qui a
-- choisi le même numéro de version parce qu'elle a été écrite sur la même base que
-- celle-ci. Le nom d'une contrainte n'est pas un numéro de version libre : sans ce
-- `drop … if exists`, la migration ABORTE au replay. La forme finale, union de tous les
-- domaines cibles, est posée par la migration de réconciliation d'intégration.
alter table public.import_record_links drop constraint if exists import_record_links_domain_v3_ck;
alter table public.import_record_links drop constraint if exists import_record_links_target_v3_ck;
alter table public.import_record_links add constraint import_record_links_domain_v3_ck
  check (
    target_domain in (
      'CASH_FLOW_TRANSACTION', 'BUSINESS_ACCOUNTING', 'PORTFOLIO_LEDGER', 'PORTFOLIO_POSITION'
    )
  );
-- Une colonne cible par domaine, et une SEULE renseignée : un lien qui en porterait deux
-- laisserait croire qu'une ligne d'import a produit deux faits canoniques.
alter table public.import_record_links add constraint import_record_links_target_v3_ck
  check (
    case target_domain
      when 'CASH_FLOW_TRANSACTION' then
        transaction_id is not null and normalized_record_id is not null
        and business_financials_id is null
        and portfolio_event_id is null and position_snapshot_id is null
      when 'BUSINESS_ACCOUNTING' then
        business_financials_id is not null and transaction_id is null
        and normalized_record_id is null
        and portfolio_event_id is null and position_snapshot_id is null
      when 'PORTFOLIO_LEDGER' then
        portfolio_event_id is not null and normalized_record_id is not null
        and transaction_id is null and business_financials_id is null
        and position_snapshot_id is null
      when 'PORTFOLIO_POSITION' then
        position_snapshot_id is not null and normalized_record_id is not null
        and transaction_id is null and business_financials_id is null
        and portfolio_event_id is null
      else false
    end
  );

create index if not exists import_record_links_event_idx
  on public.import_record_links(portfolio_event_id, user_id)
  where portfolio_event_id is not null;
create index if not exists import_record_links_snapshot_idx
  on public.import_record_links(position_snapshot_id, user_id)
  where position_snapshot_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Dépôt du fichier : billet et stockage
-- ---------------------------------------------------------------------------
alter table public.import_upload_tickets drop constraint if exists import_upload_tickets_domain_ck;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'import_upload_tickets_domain_v2_ck') then
    alter table public.import_upload_tickets add constraint import_upload_tickets_domain_v2_ck
      check (domain in ('BUSINESS_ACCOUNTING', 'PORTFOLIO_FILE'));
  end if;
end $$;

-- Ajout ADDITIF des types de classeur à la zone de staging. Les types déjà acceptés le
-- restent : un ajout qui retirerait `text/csv` casserait l'import bancaire.
update storage.buckets
   set allowed_mime_types = (
         select array_agg(distinct mime order by mime)
           from unnest(
             coalesce(allowed_mime_types, array[]::text[])
             || array[
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'application/vnd.ms-excel',
               'application/octet-stream'
             ]
           ) as mime
       )
 where id = 'family-office-import-staging';

-- ---------------------------------------------------------------------------
-- 6. Résolution d'instrument — une DÉCISION, pas une déduction
-- ---------------------------------------------------------------------------
-- INSTRUMENT NON RÉSOLU ≠ INSTRUMENT NOUVEAU. Un ISIN qui ne correspond à rien peut être un
-- titre absent du référentiel ou une faute de frappe. Le créer d'office peuplerait le
-- référentiel de doublons, et les mêmes titres se répartiraient entre deux instruments.
--
-- La décision porte sur la CLÉ DE SOURCE, pas sur la ligne : toutes les lignes qui citent le
-- même titre se résolvent ensemble.

create table if not exists public.import_instrument_resolutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  -- Clé telle que l'acquisition l'a construite (`ISIN:…`, `TICKER:…`, `NAME:…`).
  source_key text not null,
  source_isin text,
  source_ticker text,
  source_name text,
  state text not null default 'CANDIDATE',
  security_id uuid,
  -- Base NOMMÉE du rapprochement, et candidats trouvés. Un rattachement sans base ne se
  -- relit pas, et l'utilisateur ne peut pas vérifier ce qu'il accepte.
  basis jsonb not null default '{}'::jsonb,
  decided_at timestamptz,
  decided_reason text,
  created_at timestamptz not null default now(),
  constraint import_instrument_resolutions_session_fk
    foreign key (session_id, user_id)
    references public.import_sessions(id, user_id) on delete cascade,
  constraint import_instrument_resolutions_security_fk
    foreign key (security_id, user_id)
    references public.securities(id, user_id) on delete restrict,
  constraint import_instrument_resolutions_state_ck check (
    state in ('CANDIDATE', 'AMBIGUOUS', 'RESOLVED', 'REJECTED')
  ),
  -- RÉSOLU exige un instrument ET une date de décision. « Résolu » sans instrument serait
  -- exactement le rattachement fantôme que cette table existe pour empêcher.
  constraint import_instrument_resolutions_resolved_shape_ck check (
    case when state = 'RESOLVED' then security_id is not null and decided_at is not null
    else true end
  ),
  -- ÉCARTÉ exige un motif : les lignes qui citent ce titre ne seront pas écrites, et il faut
  -- pouvoir dire pourquoi six mois plus tard.
  constraint import_instrument_resolutions_rejected_shape_ck check (
    case when state = 'REJECTED'
      then decided_at is not null and decided_reason is not null and length(btrim(decided_reason)) > 0
    else true end
  ),
  -- Non tranché : aucun instrument rattaché. Sinon un rattachement existerait sans décision.
  constraint import_instrument_resolutions_pending_shape_ck check (
    case when state in ('CANDIDATE', 'AMBIGUOUS') then security_id is null and decided_at is null
    else true end
  ),
  constraint import_instrument_resolutions_basis_ck check (jsonb_typeof(basis) = 'object'),
  constraint import_instrument_resolutions_key_ck check (length(btrim(source_key)) > 0)
);

create unique index if not exists import_instrument_resolutions_id_user_uidx
  on public.import_instrument_resolutions(id, user_id);
-- Une seule résolution par titre et par session : deux décisions concurrentes sur le même
-- titre rendraient indéterminé ce qui sera écrit.
create unique index if not exists import_instrument_resolutions_key_uidx
  on public.import_instrument_resolutions(user_id, session_id, source_key);
create index if not exists import_instrument_resolutions_session_idx
  on public.import_instrument_resolutions(session_id, user_id);
create index if not exists import_instrument_resolutions_security_idx
  on public.import_instrument_resolutions(security_id, user_id)
  where security_id is not null;

comment on table public.import_instrument_resolutions is
  'Décision de rattachement d''un identifiant lu à un instrument du référentiel. Un instrument non résolu n''est pas un instrument nouveau : rien n''est créé d''office.';

-- ---------------------------------------------------------------------------
-- 7. RLS et privilèges
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'alter table public.import_instrument_resolutions enable row level security';
  execute 'drop policy if exists owner_all on public.import_instrument_resolutions';
  execute
    'create policy owner_all on public.import_instrument_resolutions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)';
  execute 'revoke all on table public.import_instrument_resolutions from anon, authenticated';
  execute 'grant select on table public.import_instrument_resolutions to authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 8. RPC — écritures composées, aucune formule financière
-- ---------------------------------------------------------------------------
-- Elles suivent la forme des RPC comptables : ouverture, réception par lots, finalisation,
-- validation. Aucune ne calcule de finance ; la lecture est faite par la couche
-- d'acquisition en TypeScript, et la base persiste ce qu'elle a compris et REFUSE ce qui
-- ne tient pas debout.

-- Ouvre une session. Idempotence : une session déjà COMMITTÉE portant la même empreinte est
-- refusée ; une session encore en réception ou analysée est REMPLACÉE, parce que réanalyser
-- après avoir corrigé un mapping est légitime.
create or replace function public.lfo_open_portfolio_session(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source jsonb := p_payload -> 'source';
  v_session jsonb := p_payload -> 'session';
  v_domain text;
  v_account_id uuid;
  v_source_id uuid;
  v_session_id uuid;
  v_file_hash text;
begin
  if v_source is null or v_session is null then
    raise exception 'Charge d''ouverture incomplète : source et session sont obligatoires';
  end if;

  v_domain := v_source ->> 'domain';
  if v_domain not in ('PORTFOLIO_LEDGER', 'PORTFOLIO_POSITION') then
    raise exception 'Domaine % non pris en charge par cet import', coalesce(v_domain, 'absent');
  end if;

  v_account_id := nullif(v_source ->> 'target_account_id', '')::uuid;
  if v_account_id is null then
    raise exception 'Enveloppe cible obligatoire : un fait de portefeuille sans enveloppe ne serait réconciliable par rien';
  end if;
  if not exists (
    select 1 from public.financial_accounts where id = v_account_id and user_id = p_user_id
  ) then
    raise exception 'Enveloppe cible introuvable';
  end if;

  insert into public.import_sources (
    user_id, kind, domain, provider, label, target_account_id, status, adapter_version,
    notes, source
  ) values (
    p_user_id,
    coalesce(nullif(v_source ->> 'kind', ''), 'FILE_CSV'),
    v_domain,
    v_source ->> 'provider',
    v_source ->> 'label',
    v_account_id,
    coalesce(nullif(v_source ->> 'status', ''), 'FILE_ONLY'),
    v_source ->> 'adapter_version',
    nullif(v_source ->> 'notes', ''),
    nullif(v_source ->> 'source', '')
  )
  on conflict (user_id, domain, provider, target_account_id) where target_account_id is not null
  do update set
    label = excluded.label,
    adapter_version = excluded.adapter_version,
    last_attempt_at = now(),
    updated_at = now()
  returning id into v_source_id;

  v_file_hash := nullif(v_session ->> 'file_hash', '');
  if v_file_hash is not null and exists (
    select 1 from public.import_sessions
     where user_id = p_user_id and source_id = v_source_id
       and file_hash = v_file_hash and status = 'COMMITTED'
  ) then
    raise exception 'Ce fichier a déjà été importé et validé pour cette source : le rejouer ne créerait que des doublons';
  end if;

  if v_file_hash is not null then
    delete from public.import_sessions
     where user_id = p_user_id and source_id = v_source_id
       and file_hash = v_file_hash and status in ('RECEIVING', 'ANALYZED');
  end if;

  insert into public.import_sessions (
    user_id, source_id, file_name, file_hash, file_size_bytes, content_type,
    encoding, delimiter, parser, parser_version, mapping, conventions, declared_currency,
    observation_date, stable_transaction_id_declared, retain_file_requested,
    status, issues, staging_storage_path
  ) values (
    p_user_id, v_source_id,
    nullif(v_session ->> 'file_name', ''),
    v_file_hash,
    nullif(v_session ->> 'file_size_bytes', '')::bigint,
    nullif(v_session ->> 'content_type', ''),
    nullif(v_session ->> 'encoding', ''),
    nullif(v_session ->> 'delimiter', ''),
    v_session ->> 'parser',
    v_session ->> 'parser_version',
    v_session -> 'mapping',
    v_session -> 'conventions',
    upper(nullif(v_session ->> 'declared_currency', '')),
    nullif(v_session ->> 'observation_date', '')::date,
    -- Faux par défaut, et ce défaut est le bon : prendre une référence de courtier répétée
    -- pour une identité ferait disparaître des opérations réelles.
    coalesce((v_session ->> 'stable_reference_declared')::boolean, false),
    coalesce((v_session ->> 'retain_file_requested')::boolean, false),
    'RECEIVING',
    coalesce(v_session -> 'issues', '[]'::jsonb),
    nullif(v_session ->> 'staging_storage_path', '')
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

-- Reçoit un lot de lignes : le BRUT et sa LECTURE, atomiquement, rattachés par numéro de
-- ligne. Le domaine et l'enveloppe ne sont pas des paramètres : ils sont LUS depuis la
-- source de la session, parce qu'une charge de requête forgée pourrait sinon écrire une
-- position dans l'enveloppe d'un autre domaine.
create or replace function public.lfo_append_portfolio_rows(
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
  v_row jsonb;
  v_raw_id uuid;
  v_written integer;
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
  if v_status <> 'RECEIVING' then
    raise exception 'Session au statut % : elle ne reçoit plus de lignes', v_status;
  end if;
  if v_domain not in ('PORTFOLIO_LEDGER', 'PORTFOLIO_POSITION') then
    raise exception 'Session du domaine % : cette RPC n''écrit que du portefeuille', v_domain;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'rows', '[]'::jsonb))
  loop
    v_raw_id := gen_random_uuid();
    insert into public.import_raw_records (id, user_id, session_id, row_number, raw_line, cells)
    values (
      v_raw_id, p_user_id, v_session_id,
      (v_row ->> 'row_number')::integer,
      coalesce(v_row ->> 'raw_line', ''),
      coalesce(v_row -> 'cells', '[]'::jsonb)
    );

    insert into public.import_normalized_records (
      id, user_id, session_id, raw_record_id, target_domain, account_id,
      transaction_date, settlement_date, label, currency,
      event_type, security_id, quantity, unit_price, gross_amount,
      fee_amount, tax_amount, envelope_cash_amount, market_value, cost_basis,
      instrument_source_key, source_isin, source_ticker, source_instrument_name,
      external_transaction_id, status, dedupe_verdict, match_key, external_key,
      matched_portfolio_event_id, matched_position_snapshot_id,
      issues, data_kind, confidence, source
    ) values (
      gen_random_uuid(), p_user_id, v_session_id, v_raw_id, v_domain, v_account_id,
      -- `transaction_date` porte la date du FAIT : date d'opération pour un événement, date
      -- d'arrêté pour une observation. Une seule colonne de date canonique, comme le reste
      -- de la table.
      (nullif(v_row ->> 'fact_date', ''))::date,
      (nullif(v_row ->> 'settlement_date', ''))::date,
      nullif(v_row ->> 'label', ''),
      upper(nullif(v_row ->> 'currency', '')),
      nullif(v_row ->> 'event_type', ''),
      (nullif(v_row ->> 'security_id', ''))::uuid,
      (nullif(v_row ->> 'quantity', ''))::numeric,
      (nullif(v_row ->> 'unit_price', ''))::numeric,
      (nullif(v_row ->> 'gross_amount', ''))::numeric,
      (nullif(v_row ->> 'fee_amount', ''))::numeric,
      (nullif(v_row ->> 'tax_amount', ''))::numeric,
      (nullif(v_row ->> 'envelope_cash_amount', ''))::numeric,
      (nullif(v_row ->> 'market_value', ''))::numeric,
      (nullif(v_row ->> 'cost_basis', ''))::numeric,
      nullif(v_row ->> 'instrument_source_key', ''),
      nullif(v_row ->> 'source_isin', ''),
      nullif(v_row ->> 'source_ticker', ''),
      nullif(v_row ->> 'source_instrument_name', ''),
      nullif(v_row ->> 'external_reference', ''),
      v_row ->> 'status',
      nullif(v_row ->> 'dedupe_verdict', ''),
      nullif(v_row ->> 'match_key', ''),
      nullif(v_row ->> 'external_key', ''),
      (nullif(v_row ->> 'matched_event_id', ''))::uuid,
      (nullif(v_row ->> 'matched_snapshot_id', ''))::uuid,
      coalesce(v_row -> 'issues', '[]'::jsonb),
      'ACTUAL', 'HIGH', nullif(v_row ->> 'source', '')
    );
  end loop;

  -- DÉRIVÉ des lignes réellement persistées : aucun décompte fourni n'est repris.
  select count(*) into v_written
    from public.import_raw_records
   where user_id = p_user_id and session_id = v_session_id;

  update public.import_sessions set row_count = v_written
   where id = v_session_id and user_id = p_user_id;
  return v_written;
end;
$$;

-- Enregistre les instruments RENCONTRÉS, à l'état non tranché. Aucun instrument n'est créé.
create or replace function public.lfo_stage_import_instruments(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_entry jsonb;
  v_state text;
  v_security_id uuid;
  v_count integer := 0;
begin
  v_session_id := (p_payload ->> 'session_id')::uuid;
  if not exists (
    select 1 from public.import_sessions where id = v_session_id and user_id = p_user_id
  ) then
    raise exception 'Session d''import introuvable';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_payload -> 'instruments', '[]'::jsonb))
  loop
    v_state := coalesce(nullif(v_entry ->> 'state', ''), 'CANDIDATE');
    v_security_id := nullif(v_entry ->> 'security_id', '')::uuid;

    -- Un instrument reconnu SANS ambiguïté est enregistré RÉSOLU, avec sa base : c'est une
    -- inférence tracée, pas une décision humaine, et la base garde la distinction par
    -- `decided_reason`, qui reste nul tant qu'aucun humain n'a tranché.
    if v_state = 'RESOLVED' and v_security_id is null then
      raise exception 'Instrument déclaré résolu sans instrument rattaché : « résolu » sans cible est un rattachement fantôme';
    end if;
    if v_state in ('CANDIDATE', 'AMBIGUOUS') then
      v_security_id := null;
    end if;

    insert into public.import_instrument_resolutions (
      user_id, session_id, source_key, source_isin, source_ticker, source_name,
      state, security_id, basis, decided_at
    ) values (
      p_user_id, v_session_id,
      v_entry ->> 'source_key',
      nullif(v_entry ->> 'source_isin', ''),
      nullif(v_entry ->> 'source_ticker', ''),
      nullif(v_entry ->> 'source_name', ''),
      v_state,
      v_security_id,
      coalesce(v_entry -> 'basis', '{}'::jsonb),
      case when v_state = 'RESOLVED' then now() else null end
    )
    on conflict (user_id, session_id, source_key) do update set
      -- Une décision HUMAINE ne se rejoue pas : une réanalyse ne l'écrase pas.
      state = case
                when public.import_instrument_resolutions.decided_reason is not null
                  then public.import_instrument_resolutions.state
                else excluded.state
              end,
      security_id = case
                      when public.import_instrument_resolutions.decided_reason is not null
                        then public.import_instrument_resolutions.security_id
                      else excluded.security_id
                    end,
      basis = excluded.basis;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Tranche un instrument. Écarter exige un motif : les lignes qui le citent ne seront pas
-- écrites, et il faut pouvoir dire pourquoi six mois plus tard.
create or replace function public.lfo_resolve_import_instrument(
  p_user_id uuid,
  p_payload jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_resolution record;
  v_decision text;
  v_security_id uuid;
  v_reason text;
  v_touched integer;
begin
  v_decision := p_payload ->> 'decision';
  v_reason := nullif(btrim(p_payload ->> 'reason'), '');
  v_security_id := nullif(p_payload ->> 'security_id', '')::uuid;

  select * into v_resolution
    from public.import_instrument_resolutions
   where id = (p_payload ->> 'resolution_id')::uuid and user_id = p_user_id
   for update;
  if not found then
    raise exception 'Résolution d''instrument introuvable';
  end if;

  if v_decision = 'REJECT' then
    if v_reason is null then
      raise exception 'Écarter un instrument exige un motif : les lignes qui le citent ne seront pas écrites';
    end if;
    update public.import_instrument_resolutions
       set state = 'REJECTED', security_id = null, decided_at = now(), decided_reason = v_reason
     where id = v_resolution.id and user_id = p_user_id;
  elsif v_decision = 'RESOLVE' then
    if v_security_id is null then
      raise exception 'Rattacher un instrument exige de désigner lequel';
    end if;
    if not exists (
      select 1 from public.securities where id = v_security_id and user_id = p_user_id
    ) then
      raise exception 'Instrument introuvable dans le référentiel';
    end if;
    update public.import_instrument_resolutions
       set state = 'RESOLVED', security_id = v_security_id, decided_at = now(),
           decided_reason = coalesce(v_reason, 'Rattachement confirmé')
     where id = v_resolution.id and user_id = p_user_id;
  else
    raise exception 'Décision % non prise en charge', coalesce(v_decision, 'absente');
  end if;

  -- La décision se propage à TOUTES les lignes qui citent ce titre : une décision par titre,
  -- pas une par ligne.
  update public.import_normalized_records
     set security_id = case when v_decision = 'RESOLVE' then v_security_id else null end
   where user_id = p_user_id
     and session_id = v_resolution.session_id
     and instrument_source_key = v_resolution.source_key;
  get diagnostics v_touched = row_count;

  return v_touched;
end;
$$;

-- Corrige une ligne NORMALISÉE. Le brut n'est jamais touché : `import_raw_records` porte son
-- trigger de gel, et corriger une lecture ne récrit pas ce que la source a écrit.
--
-- La correction conserve la provenance au niveau du CHAMP : `field_corrections` porte, pour
-- chaque champ corrigé, la valeur d'origine et la valeur retenue.
create or replace function public.lfo_correct_portfolio_row(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_record record;
  v_corrections jsonb;
  v_status text;
begin
  select * into v_record
    from public.import_normalized_records
   where id = (p_payload ->> 'record_id')::uuid and user_id = p_user_id
   for update;
  if not found then
    raise exception 'Ligne d''import introuvable';
  end if;
  if v_record.commit_state = 'COMMITTED' then
    raise exception 'Ligne déjà écrite : une correction ne récrit pas un fait canonique. Corrigez le fait dans son domaine';
  end if;

  v_corrections := coalesce(p_payload -> 'field_corrections', '{}'::jsonb);
  if jsonb_typeof(v_corrections) <> 'object' or v_corrections = '{}'::jsonb then
    raise exception 'Correction vide : une correction dit QUEL champ change et par quoi';
  end if;

  v_status := coalesce(nullif(p_payload ->> 'status', ''), v_record.status);

  update public.import_normalized_records set
    transaction_date = coalesce((nullif(p_payload ->> 'fact_date', ''))::date, transaction_date),
    settlement_date = coalesce((nullif(p_payload ->> 'settlement_date', ''))::date, settlement_date),
    event_type = coalesce(nullif(p_payload ->> 'event_type', ''), event_type),
    quantity = coalesce((nullif(p_payload ->> 'quantity', ''))::numeric, quantity),
    unit_price = coalesce((nullif(p_payload ->> 'unit_price', ''))::numeric, unit_price),
    gross_amount = coalesce((nullif(p_payload ->> 'gross_amount', ''))::numeric, gross_amount),
    fee_amount = coalesce((nullif(p_payload ->> 'fee_amount', ''))::numeric, fee_amount),
    tax_amount = coalesce((nullif(p_payload ->> 'tax_amount', ''))::numeric, tax_amount),
    envelope_cash_amount = coalesce(
      (nullif(p_payload ->> 'envelope_cash_amount', ''))::numeric, envelope_cash_amount),
    market_value = coalesce((nullif(p_payload ->> 'market_value', ''))::numeric, market_value),
    cost_basis = coalesce((nullif(p_payload ->> 'cost_basis', ''))::numeric, cost_basis),
    currency = coalesce(upper(nullif(p_payload ->> 'currency', '')), currency),
    label = coalesce(nullif(p_payload ->> 'label', ''), label),
    status = v_status,
    -- La correction s'AJOUTE à l'historique des corrections plutôt que de le remplacer.
    field_corrections = coalesce(field_corrections, '{}'::jsonb) || v_corrections,
    correction_reason = coalesce(nullif(p_payload ->> 'reason', ''), correction_reason),
    corrected_at = now()
  where id = v_record.id and user_id = p_user_id;

  return v_record.id;
end;
$$;

-- Passe la session de RECEIVING à ANALYZED, en DÉRIVANT les compteurs des lignes persistées.
-- Un décompte fourni par l'appelant n'est jamais repris : c'est le même contrôle que
-- Σdébits = Σcrédits du FEC.
create or replace function public.lfo_finalize_portfolio_session(
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
  v_ready integer;
  v_warning integer;
  v_blocked integer;
  v_duplicate integer;
  v_total integer;
begin
  v_session_id := (p_payload ->> 'session_id')::uuid;
  select status into v_status
    from public.import_sessions where id = v_session_id and user_id = p_user_id for update;
  if not found then
    raise exception 'Session d''import introuvable';
  end if;
  if v_status <> 'RECEIVING' then
    raise exception 'Session au statut % : elle n''est plus en réception', v_status;
  end if;

  select
    count(*),
    count(*) filter (where status = 'READY'),
    count(*) filter (where status = 'WARNING'),
    count(*) filter (where status = 'BLOCKED'),
    count(*) filter (where status = 'DUPLICATE')
  into v_total, v_ready, v_warning, v_blocked, v_duplicate
    from public.import_normalized_records
   where user_id = p_user_id and session_id = v_session_id;

  update public.import_sessions set
    status = 'ANALYZED',
    row_count = v_total,
    ready_count = v_ready,
    warning_count = v_warning,
    blocked_count = v_blocked,
    duplicate_count = v_duplicate,
    analyzed_at = now(),
    issues = coalesce(p_payload -> 'issues', issues)
  where id = v_session_id and user_id = p_user_id;

  return v_ready;
end;
$$;

-- VALIDE la session : écrit les faits canoniques et leur provenance, atomiquement.
--
-- Trois garanties, chacune vérifiée par la base et non par l'application :
--
--   * seules les lignes PRÊTES ou SIGNALÉES et EXPLICITEMENT retenues sont écrites. Un
--     doublon, une ligne bloquée ou ignorée committée serait exactement le bug que cette
--     couche existe pour empêcher ;
--   * un événement passe par `lfo_record_portfolio_event`, UNIQUE porte d'écriture du ledger.
--     Aucune seconde vérité ;
--   * une position écrit une OBSERVATION DATÉE dans `position_snapshots`, et ne produit
--     AUCUN événement : POSITION OBSERVÉE ≠ TRANSACTION.
--
-- Tout échec au milieu du lot annule l'intégralité : c'est une seule transaction.
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
      insert into public.position_snapshots (
        user_id, position_id, snapshot_date, quantity, cost_basis, market_value, currency,
        data_kind, confidence, source
      ) values (
        p_user_id, v_position_id, v_record.transaction_date, v_record.quantity,
        v_record.cost_basis, v_record.market_value, v_record.currency,
        'ACTUAL', 'HIGH', coalesce(v_record.source, 'Import portefeuille')
      )
      on conflict (user_id, position_id, snapshot_date) do update set
        -- Une observation à la même date CORRIGE la précédente : elle ne s'y ajoute pas.
        quantity = excluded.quantity,
        cost_basis = excluded.cost_basis,
        market_value = excluded.market_value,
        currency = excluded.currency
      returning id into v_snapshot_id;

      update public.import_normalized_records
         set commit_state = 'COMMITTED', committed_at = now(), position_snapshot_id = v_snapshot_id
       where id = v_record.id and user_id = p_user_id;

      insert into public.import_record_links (
        user_id, session_id, normalized_record_id, target_domain, position_snapshot_id
      ) values (
        p_user_id, v_session_id, v_record.id, 'PORTFOLIO_POSITION', v_snapshot_id
      )
      on conflict (user_id, position_snapshot_id) do nothing;
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

-- ---------------------------------------------------------------------------
-- 9. Privilèges des RPC
-- ---------------------------------------------------------------------------
revoke all on function
  public.lfo_open_portfolio_session(uuid, jsonb),
  public.lfo_append_portfolio_rows(uuid, jsonb),
  public.lfo_stage_import_instruments(uuid, jsonb),
  public.lfo_resolve_import_instrument(uuid, jsonb),
  public.lfo_correct_portfolio_row(uuid, jsonb),
  public.lfo_finalize_portfolio_session(uuid, jsonb),
  public.lfo_commit_portfolio_session(uuid, jsonb)
from public, anon, authenticated;

grant execute on function
  public.lfo_open_portfolio_session(uuid, jsonb),
  public.lfo_append_portfolio_rows(uuid, jsonb),
  public.lfo_stage_import_instruments(uuid, jsonb),
  public.lfo_resolve_import_instrument(uuid, jsonb),
  public.lfo_correct_portfolio_row(uuid, jsonb),
  public.lfo_finalize_portfolio_session(uuid, jsonb),
  public.lfo_commit_portfolio_session(uuid, jsonb)
to service_role;
