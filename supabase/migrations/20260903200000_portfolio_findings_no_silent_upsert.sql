-- ---------------------------------------------------------------------------
-- FINDINGS CODEX SUR L'IMPORT DE PORTEFEUILLE — VOLET BASE
-- ---------------------------------------------------------------------------
-- Un seul des quatre findings porte sur le schéma ; les trois autres sont dans le lecteur
-- XLSX et dans les routes HTTP, et sont traités dans le même commit.
--
-- FINDING : `on conflict do update` SILENCIEUX sur `position_snapshots`.
--
-- Une observation persistée est un FAIT. L'écraser parce qu'un second fichier porte la même
-- date, sans le dire et sans décision, remplace une quantité et une valeur de marché déjà
-- lues par un humain — et il n'en reste aucune trace. Le commentaire d'origine assumait
-- « une observation à la même date CORRIGE la précédente », ce qui est vrai du RÉSULTAT
-- voulu mais faux du CHEMIN : une correction est une décision, elle ne se déduit pas d'un
-- second dépôt.
--
-- Trois cas désormais, et trois seulement :
--
--   rien à cette date              → écriture
--   même date, mêmes valeurs       → RIEN. Le rejeu du même fichier reste idempotent, et il
--                                    n'est pas requalifié en correction
--   même date, valeurs différentes → REFUS, sauf `correct_record_ids` désignant la ligne.
--                                    Le message nomme ce qui change : « observation déjà
--                                    présente » ne dit pas ce qu'on remplace
--
-- Corollaire : la provenance d'une observation CORRIGÉE devient un HISTORIQUE de sessions,
-- exactement comme celle d'un instantané financier reconstruit depuis un FEC. L'unicité du
-- lien portait sur (propriétaire, observation) : la session qui corrige perdait donc sa
-- provenance en silence, et l'observation disait venir d'une lecture qu'elle ne portait
-- plus. Elle porte maintenant sur (propriétaire, session, observation).

alter table public.import_record_links drop constraint if exists import_record_links_snapshot_uk;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_record_links_snapshot_session_uk'
  ) then
    alter table public.import_record_links
      add constraint import_record_links_snapshot_session_uk
      unique (user_id, session_id, position_snapshot_id);
  end if;
end $$;

comment on constraint import_record_links_snapshot_session_uk on public.import_record_links is
  'Provenance d''une observation de position, par SESSION. Une observation corrigée a un historique de lectures, comme un instantané financier de FEC ; l''unicité par observation seule faisait perdre sa provenance à la session qui corrige.';

-- Même raisonnement UN NIVEAU PLUS BAS, sur le staging. `import_normalized_records_snapshot_uidx`
-- portait sur (propriétaire, observation) : la LIGNE de la session qui corrige ne pouvait
-- donc pas dire quelle observation elle avait écrite, et la validation échouait sur cet
-- index avant d'atteindre la moindre décision.
--
-- L'invariant d'origine reste, borné à ce qu'il protège réellement : DANS UNE MÊME SESSION,
-- deux lignes qui prétendent avoir écrit la même observation rendent la provenance
-- indéterminée. D'une session à l'autre, c'est un historique de lectures.
drop index if exists public.import_normalized_records_snapshot_uidx;

create unique index if not exists import_normalized_records_snapshot_session_uidx
  on public.import_normalized_records(user_id, session_id, position_snapshot_id)
  where position_snapshot_id is not null;

-- Recherche des lectures qui ont écrit une observation donnée : c'est ce qui permet de dire
-- « cette valeur vient de ce fichier, corrigée par celui-là ».
create index if not exists import_normalized_records_snapshot_idx
  on public.import_normalized_records(position_snapshot_id, user_id)
  where position_snapshot_id is not null;

-- Version reprise de la DERNIÈRE en vigueur, `20260902093000_portfolio_import_acquisition`.
-- Seul le bloc d'écriture de l'observation change, plus la déclaration des corrections
-- désignées.
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
  v_corrections uuid[];
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

  -- Lignes pour lesquelles l'utilisateur DÉCLARE corriger une observation déjà persistée.
  -- Vide par défaut : une correction ne se déduit pas d'un second dépôt du même fichier.
  select coalesce(array_agg(value::uuid), array[]::uuid[]) into v_corrections
    from jsonb_array_elements_text(coalesce(p_payload -> 'correct_record_ids', '[]'::jsonb));

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
      --   * même date, valeurs DIFFÉRENTES → REFUS, sauf décision explicite de correction.
      --     Le message nomme ce qui change, parce qu'« observation déjà présente » ne dit
      --     pas à l'utilisateur ce qu'il est en train de remplacer.
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
        -- `is distinct from` et non `<>` : un `null` d'un côté et une valeur de l'autre est
        -- un CHANGEMENT, et `null <> 1` ne vaut pas `true`.
        if
          v_existing.quantity is distinct from v_record.quantity
          or v_existing.cost_basis is distinct from v_record.cost_basis
          or v_existing.market_value is distinct from v_record.market_value
          or v_existing.currency is distinct from v_record.currency
        then
          if not (v_record.id = any (v_corrections)) then
            raise exception
              'Observation du % déjà persistée pour cette détention, avec des valeurs différentes (quantité % → %, valeur de marché % → %). Une correction est une DÉCISION : désignez cette ligne dans correct_record_ids pour la remplacer.',
              v_record.transaction_date,
              coalesce(v_existing.quantity::text, 'absente'),
              coalesce(v_record.quantity::text, 'absente'),
              coalesce(v_existing.market_value::text, 'absente'),
              coalesce(v_record.market_value::text, 'absente');
          end if;
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
