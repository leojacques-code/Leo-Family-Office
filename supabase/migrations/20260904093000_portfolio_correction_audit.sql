-- ---------------------------------------------------------------------------
-- CORRECTION D'UNE OBSERVATION DE POSITION — DÉCISION STRUCTURÉE ET PISTE IMMUABLE
-- ---------------------------------------------------------------------------
-- Migration CORRECTIVE d'un finding de revue sur `20260903200000`. Elle est ADDITIVE :
-- aucune migration antérieure n'est modifiée, et le seul objet redéfini est la RPC
-- `lfo_commit_portfolio_session`, reprise de sa DERNIÈRE version en vigueur.
--
-- CE QUI N'ALLAIT PAS
--
-- `20260903200000` a fermé le vrai trou — plus de `on conflict do update` silencieux — en
-- exigeant une DÉCISION : la ligne devait être nommée dans `correct_record_ids`. Mais un
-- tableau d'identifiants n'est pas une décision, c'est un CONSENTEMENT ANONYME. Il ne dit
-- pas POURQUOI, ne dit pas QUI, et surtout il ne garde RIEN : la mutation écrasait la
-- quantité et la valeur de marché précédentes, et l'ancienne valeur disparaissait
-- définitivement. Le bouton d'interface qui l'utilisait déclarait d'ailleurs en bloc TOUTES
-- les lignes retenues, sans motif : « décider » se réduisait à cliquer sur l'autre bouton.
--
-- DÉCISION ≠ CONSENTEMENT. Une décision porte un motif, un auteur, un objet et une date, et
-- elle laisse une trace que personne ne peut réécrire. Autrement il ne reste, un mois plus
-- tard, aucun moyen de répondre à « pourquoi cette position vaut-elle 20 000 € et non
-- 18 500 € comme le relevé de mars le disait ».
--
-- ÉTAT ATTENDU ≠ ÉTAT COURANT. Le second point que le contrat précédent laissait ouvert :
-- deux sessions décidant de corriger la même observation. La seconde écrasait la première
-- sans rien remarquer — elle avait bien « une décision », donc elle passait. Une décision
-- porte désormais l'état qu'elle CROIT corriger ; si l'état réellement persisté n'est plus
-- celui-là, la validation échoue avec un conflit RÉVISABLE — il nomme le champ, l'attendu
-- et le trouvé — au lieu d'effacer la décision de quelqu'un d'autre.
--
-- ANCIENNE VALEUR ≠ VALEUR REMPLACÉE. La piste conserve l'avant ET l'après, plus la LISTE
-- des champs réellement modifiés. Les trois sont distincts : un après identique à un avant
-- n'est pas une correction, et « quelque chose a changé » ne dit pas quoi.
--
-- IDENTITÉ DÉCLARÉE ≠ IDENTITÉ CONSTATÉE. `decided_by` est ce que l'appelant DÉCLARE ;
-- `executed_by` est le rôle PostgreSQL qui a réellement exécuté, posé par défaut par la base
-- et donc infalsifiable par l'appelant. Les confondre laisserait croire à une identité
-- vérifiée là où il n'y a qu'une déclaration.

-- ---------------------------------------------------------------------------
-- 1. La piste d'audit
-- ---------------------------------------------------------------------------
-- Aucune primitive existante ne couvrait cette sémantique, et c'est pourquoi une table est
-- ajoutée plutôt que réutilisée :
--
--   * `import_record_links` est une PROVENANCE — « ce fait vient de cette lecture ». Elle
--     ne porte ni motif, ni avant, ni après, et son unicité par (propriétaire, session,
--     observation) est là pour dire d'où vient une valeur, pas pourquoi elle a changé ;
--   * `import_normalized_records.field_corrections` / `.correction_reason` corrigent la
--     ligne de STAGING avant écriture, sont portées par la ligne elle-même, et sont
--     MUTABLES — une seconde correction du même champ remplace la première. C'est adapté à
--     un brouillon, pas à une piste d'audit, et l'objet corrigé n'est pas le même.

create table if not exists public.position_snapshot_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Session d'import qui a décidé. Composite avec `user_id` : une décision ne traverse
  -- jamais la frontière d'un propriétaire, et la base le garantit plutôt que l'application.
  session_id uuid not null,
  -- Ligne normalisée qui portait les valeurs de remplacement.
  normalized_record_id uuid not null,
  -- Observation canonique RÉELLEMENT modifiée.
  position_snapshot_id uuid not null,
  -- Identité DÉCLARÉE par l'appelant. Jamais vide : une décision sans auteur n'en est pas une.
  decided_by text not null,
  -- Rôle PostgreSQL constaté. Posé par la base, pas reçu de l'appelant.
  executed_by text not null default current_user,
  -- Motif. Non BLANC : « », «    » et une tabulation seule sont le même vide.
  reason text not null,
  -- Valeurs AVANT et APRÈS, champ par champ. `null` y est une valeur à part entière : une
  -- quantité absente remplacée par 12 est un changement, et `null` n'est pas zéro.
  before_values jsonb not null,
  after_values jsonb not null,
  -- Champs RÉELLEMENT modifiés. Dérivé de la comparaison, jamais reçu de l'appelant.
  changed_fields text[] not null,
  decided_at timestamptz not null default now(),

  constraint position_snapshot_corrections_session_fk
    foreign key (session_id, user_id)
    references public.import_sessions(id, user_id) on delete restrict,
  constraint position_snapshot_corrections_record_fk
    foreign key (normalized_record_id, user_id)
    references public.import_normalized_records(id, user_id) on delete restrict,
  -- `restrict` et non `cascade` : AUCUNE ANCIENNE VALEUR PERDUE. Supprimer l'observation
  -- corrigée effacerait la seule trace de ce qu'elle valait avant.
  constraint position_snapshot_corrections_snapshot_fk
    foreign key (position_snapshot_id, user_id)
    references public.position_snapshots(id, user_id) on delete restrict,

  -- `~ '\S'` et non `length(btrim(...)) > 0` : le `btrim` de PostgreSQL ne retire par
  -- défaut que les ESPACES. Une tabulation ou un retour à la ligne seuls franchissaient le
  -- contrôle et laissaient la piste d'audit sans réponse à « pourquoi cette valeur ». Le
  -- motif doit contenir au moins un caractère NON BLANC, et c'est ce que cette forme dit.
  constraint position_snapshot_corrections_reason_ck check (reason ~ '\S'),
  constraint position_snapshot_corrections_decided_by_ck check (decided_by ~ '\S'),
  constraint position_snapshot_corrections_before_ck check (jsonb_typeof(before_values) = 'object'),
  constraint position_snapshot_corrections_after_ck check (jsonb_typeof(after_values) = 'object'),
  -- Une correction qui ne change RIEN n'est pas une correction : c'est un rejeu, et le
  -- confondre avec une décision gonflerait la piste d'audit d'événements vides.
  -- `array_length` d'un tableau VIDE vaut NULL, et une contrainte CHECK PASSE sur NULL :
  -- sans `coalesce`, `{}` franchirait le contrôle qu'elle est censée poser.
  constraint position_snapshot_corrections_changed_ck check (
    coalesce(array_length(changed_fields, 1), 0) >= 1
    and array_position(changed_fields, null) is null
  )
);

comment on table public.position_snapshot_corrections is
  'Piste IMMUABLE des corrections d''observations de position : qui a décidé, pourquoi, quoi avant, quoi après, quels champs. Ni modifiable, ni supprimable. Une observation corrigée ne peut pas être supprimée tant que sa correction existe : ce serait perdre l''ancienne valeur.';
comment on column public.position_snapshot_corrections.decided_by is
  'Identité DÉCLARÉE par l''appelant. Une déclaration, pas une identité vérifiée.';
comment on column public.position_snapshot_corrections.executed_by is
  'Rôle PostgreSQL CONSTATÉ, posé par la base. Infalsifiable par l''appelant.';
comment on column public.position_snapshot_corrections.changed_fields is
  'Champs réellement modifiés, DÉRIVÉS de la comparaison sous verrou. Jamais repris d''un décompte fourni par l''appelant.';

-- Index de couverture des trois clés étrangères composites, plus la lecture qui compte :
-- « l'historique des corrections de CETTE observation ».
create index if not exists position_snapshot_corrections_snapshot_idx
  on public.position_snapshot_corrections(position_snapshot_id, user_id, decided_at desc);
create index if not exists position_snapshot_corrections_session_idx
  on public.position_snapshot_corrections(session_id, user_id);
create index if not exists position_snapshot_corrections_record_idx
  on public.position_snapshot_corrections(normalized_record_id, user_id);
create index if not exists position_snapshot_corrections_user_idx
  on public.position_snapshot_corrections(user_id, decided_at desc);

-- ---------------------------------------------------------------------------
-- 2. Immuabilité
-- ---------------------------------------------------------------------------
-- Même conduite que `import_record_links` : une piste d'audit réécrite n'est pas une piste
-- d'audit. Le trigger refuse SANS CONDITION, y compris une cascade — l'observation corrigée
-- est en `restrict`, donc rien ne devrait tenter de supprimer ces lignes ; si quelque chose
-- l'essaie, c'est un bug, et il doit échouer bruyamment.
create or replace function public.position_snapshot_correction_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Une correction d''observation est immuable : ni modifiable, ni supprimable';
end;
$$;

drop trigger if exists position_snapshot_corrections_immutable
  on public.position_snapshot_corrections;
create trigger position_snapshot_corrections_immutable
  before update or delete on public.position_snapshot_corrections
  for each row execute function public.position_snapshot_correction_immutable();

-- ---------------------------------------------------------------------------
-- 3. RLS et privilèges MINIMAUX
-- ---------------------------------------------------------------------------
-- La politique exprime la PROPRIÉTÉ des lignes ; c'est le privilège de table qui refuse la
-- commande. `authenticated` ne reçoit que SELECT : toute écriture passe par la RPC,
-- réservée à `service_role`.
alter table public.position_snapshot_corrections enable row level security;
drop policy if exists owner_all on public.position_snapshot_corrections;
create policy owner_all on public.position_snapshot_corrections
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on table public.position_snapshot_corrections from anon, authenticated;
grant select on table public.position_snapshot_corrections to authenticated;

-- ---------------------------------------------------------------------------
-- 4. La RPC de validation
-- ---------------------------------------------------------------------------
-- Version reprise de la DERNIÈRE en vigueur, `20260903200000_portfolio_findings_no_silent_upsert`.
-- Seuls changent la lecture des décisions et le bloc d'écriture de l'observation. Le reste —
-- idempotence d'un second commit, refus des lignes non committables, écriture par
-- `lfo_record_portfolio_event` sous la seule forme résolue de l'instrument, exclusion
-- explicite des lignes non retenues — est identique, volontairement.
--
-- ATOMICITÉ : une fonction plpgsql s'exécute dans la transaction de l'appelant. La décision
-- lue, l'insertion d'audit, la mutation canonique et le lien de provenance sont donc dans la
-- MÊME transaction, et une exception à n'importe laquelle des quatre étapes annule les
-- quatre. Il n'existe aucun chemin par lequel une observation serait corrigée sans sa trace,
-- ni tracée sans être corrigée.
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
  v_decided_by text;
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
      or jsonb_typeof(d.item -> 'expected') is distinct from 'object'
      or coalesce(d.item -> 'expected' ->> 'snapshot_id', '') !~ '\S';
  if v_conflicts is not null then
    raise exception 'Décision de correction incomplète : `record_id` et `expected.snapshot_id` sont obligatoires. Sans état attendu, une seconde décision écraserait silencieusement la première';
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
          v_conflicts := null;
          if v_existing.quantity
             is distinct from (nullif(btrim(coalesce(v_expected ->> 'quantity', '')), ''))::numeric then
            v_conflicts := concat_ws(', ', v_conflicts, format('quantité attendue %s, trouvée %s',
              coalesce(v_expected ->> 'quantity', 'absente'),
              coalesce(v_existing.quantity::text, 'absente')));
          end if;
          if v_existing.cost_basis
             is distinct from (nullif(btrim(coalesce(v_expected ->> 'cost_basis', '')), ''))::numeric then
            v_conflicts := concat_ws(', ', v_conflicts, format('coût de revient attendu %s, trouvé %s',
              coalesce(v_expected ->> 'cost_basis', 'absent'),
              coalesce(v_existing.cost_basis::text, 'absent')));
          end if;
          if v_existing.market_value
             is distinct from (nullif(btrim(coalesce(v_expected ->> 'market_value', '')), ''))::numeric then
            v_conflicts := concat_ws(', ', v_conflicts, format('valeur de marché attendue %s, trouvée %s',
              coalesce(v_expected ->> 'market_value', 'absente'),
              coalesce(v_existing.market_value::text, 'absente')));
          end if;
          if v_existing.currency
             is distinct from upper(nullif(btrim(coalesce(v_expected ->> 'currency', '')), '')) then
            v_conflicts := concat_ws(', ', v_conflicts, format('devise attendue %s, trouvée %s',
              coalesce(v_expected ->> 'currency', 'absente'),
              coalesce(v_existing.currency, 'absente')));
          end if;
          if v_conflicts is not null then
            raise exception
              'Conflit de correction sur l''observation du % : l''état attendu n''est plus l''état courant (%). Une autre décision est passée entre-temps ; relisez-la avant de trancher',
              v_record.transaction_date, v_conflicts;
          end if;

          -- IDENTITÉ DÉCLARÉE. Vide, elle retombe sur le rôle constaté plutôt que sur une
          -- personne inventée : « on ne sait pas qui » est une information, un nom
          -- fabriqué n'en est pas une.
          v_decided_by := case
            when coalesce(v_decision ->> 'decided_by', '') ~ '\S'
              -- Le jeu de caractères est EXPLICITE : `btrim` par défaut ne retire que
              -- les espaces, et une identité encadrée de tabulations resterait telle quelle.
              then btrim(v_decision ->> 'decided_by', E' \t\n\r')
            else concat('ROLE:', current_user)
          end;

          -- AUDIT D'ABORD, MUTATION ENSUITE. L'ordre est indifférent à l'atomicité — les
          -- deux sont dans la même transaction — mais il est lisible : l'avant est capturé
          -- depuis `v_existing`, lu sous verrou, donc AVANT que l'update ne l'écrase.
          insert into public.position_snapshot_corrections (
            user_id, session_id, normalized_record_id, position_snapshot_id,
            decided_by, reason, before_values, after_values, changed_fields
          ) values (
            p_user_id, v_session_id, v_record.id, v_existing.id,
            v_decided_by,
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
