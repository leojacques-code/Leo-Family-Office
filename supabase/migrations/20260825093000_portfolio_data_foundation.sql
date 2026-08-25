-- Léo Family Office — Portfolio Data Foundation
--
-- Jusqu'ici le portefeuille n'était qu'un ÉTAT OBSERVÉ : `positions` et
-- `position_snapshots` disent ce que vaut une ligne aujourd'hui, jamais comment elle
-- s'est constituée. Aucun coût de revient par lot, aucun dividende, aucun frais, aucune
-- distinction entre l'argent neuf apporté à l'enveloppe et un arbitrage interne. Cette
-- migration ajoute la couche de FAITS manquante, sans toucher à l'état observé.
--
-- Deux tables, et rien d'autre :
--
--   portfolio_envelope_policies — ce que l'utilisateur DÉCLARE d'une enveloppe : la
--       convention d'appariement des lots et la profondeur d'historique du ledger. Les
--       deux sont nullables et le restent tant que personne ne les a déclarées. Un
--       `null` ici signifie « non déclaré », jamais « FIFO » ni « depuis toujours ».
--
--   portfolio_events — le ledger lui-même. Un fait daté, jamais un calcul.
--
-- Ce que cette migration ne fait PAS, volontairement :
--
--   * aucun lot, aucun coût de revient, aucun PnL n'est persisté. Ces grandeurs sont
--     DÉRIVÉES des événements par `src/lib/engine/portfolio.ts`. Les persister créerait
--     une seconde vérité qui se périmerait à la première correction d'événement.
--   * aucune formule financière en SQL. Les RPC ne font que résoudre des références et
--     écrire de façon atomique.
--   * aucune reconstruction d'historique. Une enveloppe sans événement reste exactement
--     ce qu'elle est aujourd'hui : un solde observé, dont le ledger dit qu'il ne
--     l'explique pas.

-- ---------------------------------------------------------------------------
-- 0. Intégrité de propriété : cibles composites (id, user_id)
-- ---------------------------------------------------------------------------
-- Même règle que `net_worth_snapshot_items_owner_fk` : un événement portant user A ne
-- doit pas pouvoir référencer le compte, le titre ou la transaction de user B, même via
-- un client authentifié qui en connaîtrait l'UUID.

create unique index if not exists financial_accounts_id_user_uidx
  on public.financial_accounts(id, user_id);
create unique index if not exists securities_id_user_uidx
  on public.securities(id, user_id);
create unique index if not exists transactions_id_user_uidx
  on public.transactions(id, user_id);

-- ---------------------------------------------------------------------------
-- 1. Déclarations d'enveloppe
-- ---------------------------------------------------------------------------

create table if not exists public.portfolio_envelope_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  -- Convention d'appariement des lots à la vente. `null` = non déclarée : le moteur
  -- refuse alors d'apparier dès qu'il existe plus d'un lot ouvert, plutôt que de
  -- choisir FIFO à la place de l'utilisateur.
  lot_matching_method text,
  -- Date à partir de laquelle le ledger de CETTE enveloppe est déclaré exhaustif.
  -- Propriété de l'enveloppe, distincte de `profiles.ledger_coverage_start` qui porte
  -- sur le ledger bancaire. `null` = profondeur inconnue.
  ledger_coverage_start date,
  ledger_coverage_source text,
  notes text,
  data_kind text not null default 'USER_ASSUMPTION',
  confidence text not null default 'HIGH',
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_envelope_policies_account_fk
    foreign key (account_id, user_id)
    references public.financial_accounts(id, user_id) on delete cascade,
  constraint portfolio_envelope_policies_account_uk unique (user_id, account_id),
  constraint portfolio_envelope_policies_method_ck check (
    lot_matching_method is null
    or lot_matching_method in ('FIFO', 'LIFO', 'WEIGHTED_AVERAGE', 'SPECIFIC_LOT')
  ),
  constraint portfolio_envelope_policies_coverage_source_ck check (
    ledger_coverage_source is null
    or ledger_coverage_source in ('MANUAL', 'IMPORT', 'API')
  ),
  -- Une profondeur sans origine n'est pas traçable, une origine sans profondeur ne
  -- déclare rien : les deux vont ensemble ou aucune des deux n'existe.
  constraint portfolio_envelope_policies_coverage_pair_ck check (
    (ledger_coverage_start is null) = (ledger_coverage_source is null)
  )
);

create index if not exists portfolio_envelope_policies_account_idx
  on public.portfolio_envelope_policies(account_id, user_id);

comment on table public.portfolio_envelope_policies is
  'Déclarations utilisateur d''une enveloppe : convention d''appariement des lots et profondeur d''historique du ledger. Un null y signifie « non déclaré ».';

-- ---------------------------------------------------------------------------
-- 2. Ledger portefeuille
-- ---------------------------------------------------------------------------

create table if not exists public.portfolio_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Enveloppe qui porte l'événement. Le ledger est toujours logé dans une enveloppe :
  -- un événement sans enveloppe ne serait réconciliable par rien.
  account_id uuid not null,
  -- `null` = événement de cash d'enveloppe (apport, retrait, frais de tenue de compte).
  security_id uuid,
  event_type text not null,
  event_date date not null,
  settlement_date date,
  -- Quantité TOUJOURS positive : la direction vient du type, jamais du signe.
  quantity numeric(30,10),
  unit_price numeric(20,6),
  -- Montant brut, avant frais et taxes.
  gross_amount numeric(20,6),
  -- `null` = frais inconnus. Ce n'est pas zéro : un coût de revient dont les frais sont
  -- inconnus n'est pas un coût de revient sans frais.
  fee_amount numeric(20,6),
  tax_amount numeric(20,6),
  -- Effet SIGNÉ sur le cash de l'enveloppe. Sur les deux types d'ouverture, c'est un
  -- NIVEAU d'ancrage et non un delta. `null` = effet inconnu, jamais nul.
  envelope_cash_amount numeric(20,6),
  currency char(3) not null,
  -- Contrepartie hors enveloppe d'un flux externe : le compte bancaire d'où vient le
  -- virement. Ne crée aucune écriture : la jambe bancaire vit dans `transactions`.
  counterparty_account_id uuid,
  -- Jambe Cash Flow correspondante. Le portefeuille ne reclasse jamais un flux bancaire
  -- et n'en crée aucun : il se contente de pointer celui qui existe déjà.
  transaction_id uuid,
  -- Lot d'acquisition désigné, requis par la seule convention SPECIFIC_LOT. L'intégrité
  -- est portée par une FK composite (voir plus bas) : un lot désigné appartient
  -- nécessairement au même propriétaire, à la même enveloppe et au même instrument que la
  -- cession, et il ouvre réellement un lot.
  matched_acquisition_event_id uuid,
  external_reference text,
  data_kind text not null,
  confidence text not null,
  source text,
  notes text,
  created_at timestamptz not null default now(),
  -- Un événement OUVRE-T-IL un lot ? Propriété structurelle de sa nature, pas un calcul :
  -- seules ces trois natures font entrer un instrument dans l'enveloppe. Colonne générée
  -- pour servir de cible à la FK du lot désigné ; elle reflète `ACQUISITION_TYPES` de
  -- `src/lib/engine/portfolio.ts` et doit évoluer avec lui.
  is_lot_opening boolean generated always as (
    event_type in ('OPENING_POSITION', 'BUY', 'TRANSFER_IN') and security_id is not null
  ) stored,
  -- Côté référençant : `true` dès qu'un lot est désigné, `null` sinon. C'est ce `true`
  -- qui force la cible de la FK à être un événement ouvrant un lot ; le `null` laisse la
  -- FK inopérante quand aucun lot n'est désigné, comme le veut MATCH SIMPLE.
  matched_lot_is_opening boolean generated always as (
    case when matched_acquisition_event_id is null then null else true end
  ) stored,
  constraint portfolio_events_account_fk
    foreign key (account_id, user_id)
    references public.financial_accounts(id, user_id) on delete cascade,
  constraint portfolio_events_security_fk
    foreign key (security_id, user_id)
    references public.securities(id, user_id),
  -- `on delete set null` DOIT nommer sa colonne : sur une FK composite, la forme sans
  -- liste annulerait aussi `user_id`, qui est NOT NULL, et la suppression du compte ou de
  -- la transaction échouerait au lieu de détacher le lien.
  constraint portfolio_events_counterparty_fk
    foreign key (counterparty_account_id, user_id)
    references public.financial_accounts(id, user_id)
    on delete set null (counterparty_account_id),
  constraint portfolio_events_transaction_fk
    foreign key (transaction_id, user_id)
    references public.transactions(id, user_id)
    on delete set null (transaction_id),
  -- Cible de la FK du lot désigné : identité, propriétaire, enveloppe, instrument, et le
  -- fait d'ouvrir un lot. `id` étant la clé primaire, cette unicité est acquise ; elle
  -- n'existe que pour donner à la FK les quatre colonnes de contrôle dont elle a besoin.
  constraint portfolio_events_lot_target_uk
    unique (id, user_id, account_id, security_id, is_lot_opening),
  -- Un « lot spécifique » structurellement impossible est refusé par la BASE, pas
  -- seulement signalé ensuite par le moteur. Une seule FK porte les quatre frontières :
  -- même propriétaire, même enveloppe, même instrument, et un événement qui ouvre
  -- réellement un lot. Une cession ne peut donc pas désigner le dividende qu'elle a
  -- encaissé, ni une autre vente, ni la ligne d'un titre voisin, même par écriture
  -- directe hors RPC.
  --
  -- Aucune action de suppression : annuler la désignation ferait perdre en silence la
  -- convention d'appariement d'une cession déjà enregistrée. La suppression d'un lot
  -- encore désigné est refusée, ici comme dans `lfo_delete_portfolio_event`.
  constraint portfolio_events_matched_lot_fk
    foreign key (
      matched_acquisition_event_id, user_id, account_id, security_id, matched_lot_is_opening
    )
    references public.portfolio_events(
      id, user_id, account_id, security_id, is_lot_opening
    ),
  constraint portfolio_events_type_ck check (
    event_type in (
      'OPENING_POSITION', 'OPENING_CASH',
      'CONTRIBUTION', 'WITHDRAWAL',
      'BUY', 'SELL',
      'DIVIDEND', 'INTEREST',
      'FEE', 'TAX',
      'TRANSFER_IN', 'TRANSFER_OUT'
    )
  ),
  -- Un achat sans titre, un apport avec titre : deux non-sens qui rendraient le ledger
  -- inexploitable. Les types où l'instrument est facultatif (dividende, frais, transfert)
  -- restent libres.
  constraint portfolio_events_security_shape_ck check (
    case
      when event_type in ('OPENING_POSITION', 'BUY', 'SELL') then security_id is not null
      when event_type in ('OPENING_CASH', 'CONTRIBUTION', 'WITHDRAWAL') then security_id is null
      else true
    end
  ),
  constraint portfolio_events_quantity_shape_ck check (
    case
      when event_type in ('OPENING_POSITION', 'BUY', 'SELL')
        then quantity is not null and quantity > 0
      when event_type in ('TRANSFER_IN', 'TRANSFER_OUT') and security_id is not null
        then quantity is not null and quantity > 0
      else true
    end
  ),
  constraint portfolio_events_quantity_sign_ck check (quantity is null or quantity >= 0),
  constraint portfolio_events_unit_price_sign_ck check (unit_price is null or unit_price >= 0),
  constraint portfolio_events_gross_sign_ck check (gross_amount is null or gross_amount >= 0),
  constraint portfolio_events_fee_sign_ck check (fee_amount is null or fee_amount >= 0),
  constraint portfolio_events_tax_sign_ck check (tax_amount is null or tax_amount >= 0),
  -- Un lot ne se désigne qu'à la cession d'un instrument. L'exigence d'instrument n'est
  -- pas cosmétique : sous MATCH SIMPLE, un `security_id` nul désactiverait toute la FK
  -- ci-dessus et rouvrirait la porte qu'elle ferme.
  constraint portfolio_events_matched_lot_ck check (
    matched_acquisition_event_id is null
    or (event_type in ('SELL', 'TRANSFER_OUT') and security_id is not null)
  ),
  -- Une contrepartie bancaire n'a de sens que sur un flux externe à l'enveloppe.
  constraint portfolio_events_counterparty_ck check (
    counterparty_account_id is null
    or event_type in ('CONTRIBUTION', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT')
  ),
  constraint portfolio_events_data_kind_ck check (
    data_kind in ('ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING')
  ),
  constraint portfolio_events_settlement_ck check (
    settlement_date is null or settlement_date >= event_date
  )
);

-- Une enveloppe n'a qu'un ancrage de cash et qu'un ancrage par instrument : un second
-- ancrage ferait exister deux points de départ contradictoires pour la même série.
create unique index if not exists portfolio_events_opening_cash_uk
  on public.portfolio_events(user_id, account_id)
  where event_type = 'OPENING_CASH';
create unique index if not exists portfolio_events_opening_position_uk
  on public.portfolio_events(user_id, account_id, security_id)
  where event_type = 'OPENING_POSITION';

create index if not exists portfolio_events_owner_account_date_idx
  on public.portfolio_events(user_id, account_id, event_date, created_at);
create index if not exists portfolio_events_security_owner_idx
  on public.portfolio_events(security_id, user_id)
  where security_id is not null;
create index if not exists portfolio_events_counterparty_owner_idx
  on public.portfolio_events(counterparty_account_id, user_id)
  where counterparty_account_id is not null;
create index if not exists portfolio_events_transaction_owner_idx
  on public.portfolio_events(transaction_id, user_id)
  where transaction_id is not null;
create index if not exists portfolio_events_matched_lot_idx
  on public.portfolio_events(matched_acquisition_event_id)
  where matched_acquisition_event_id is not null;

comment on table public.portfolio_events is
  'Ledger portefeuille : faits datés d''une enveloppe. Aucun lot, coût de revient ou PnL n''y est persisté : tout cela est dérivé par le moteur TypeScript.';
comment on column public.portfolio_events.envelope_cash_amount is
  'Effet signé sur le cash de l''enveloppe ; NIVEAU d''ancrage sur OPENING_CASH. null = inconnu, jamais zéro.';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table public.portfolio_envelope_policies enable row level security;
drop policy if exists owner_all on public.portfolio_envelope_policies;
create policy owner_all on public.portfolio_envelope_policies
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.portfolio_events enable row level security;
drop policy if exists owner_all on public.portfolio_events;
create policy owner_all on public.portfolio_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.portfolio_envelope_policies from anon;
revoke all on table public.portfolio_events from anon;
grant select, insert, update, delete on table public.portfolio_envelope_policies to authenticated;
grant select, insert, update, delete on table public.portfolio_events to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC — écritures composées, aucune formule financière
-- ---------------------------------------------------------------------------

-- Enregistre un événement de ledger et, si nécessaire, le titre qu'il désigne, dans une
-- seule transaction. La résolution du titre est une recherche par identifiant réel
-- (ISIN, puis ticker, puis nom) : elle n'invente aucun instrument, elle en crée un
-- quand aucun ne correspond.
--
-- La classe d'actif est UNIQUEMENT rattachée si l'utilisateur en possède déjà une du
-- même nom. Créer une taxonomie à la volée reviendrait à inventer une classification.
create or replace function public.lfo_record_portfolio_event(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_security_id uuid;
  v_asset_class_id uuid;
  v_event_id uuid;
  v_currency char(3);
  v_security jsonb;
begin
  v_account_id := (p_payload ->> 'account_id')::uuid;
  v_currency := upper(p_payload ->> 'currency');

  -- Le ledger portefeuille ne se loge que dans une enveloppe d'investissement. Garde-fou
  -- d'intégrité, pas un prédicat financier : la définition canonique de l'enveloppe vit
  -- dans `src/lib/engine/balance-sheet.ts`.
  if not exists (
    select 1 from public.financial_accounts
     where id = v_account_id and user_id = p_user_id
       and status = 'ACTIVE' and account_type not in ('BANK', 'SAVINGS')
  ) then
    raise exception 'Enveloppe d''investissement introuvable ou inactive';
  end if;

  v_security := p_payload -> 'security';
  if v_security is not null and jsonb_typeof(v_security) = 'object' then
    v_security_id := nullif(v_security ->> 'id', '')::uuid;

    if v_security_id is not null then
      if not exists (
        select 1 from public.securities where id = v_security_id and user_id = p_user_id
      ) then
        raise exception 'Instrument introuvable';
      end if;
    else
      select s.id into v_security_id
        from public.securities s
       where s.user_id = p_user_id
         and (
           (nullif(v_security ->> 'isin', '') is not null
             and upper(s.isin) = upper(v_security ->> 'isin'))
           or (nullif(v_security ->> 'isin', '') is null
             and nullif(v_security ->> 'ticker', '') is not null
             and upper(s.ticker) = upper(v_security ->> 'ticker'))
           or (nullif(v_security ->> 'isin', '') is null
             and nullif(v_security ->> 'ticker', '') is null
             and s.name = v_security ->> 'name')
         )
       order by s.name
       limit 1;

      if v_security_id is null then
        select c.id into v_asset_class_id
          from public.asset_classes c
         where c.user_id = p_user_id
           and nullif(v_security ->> 'asset_class', '') is not null
           and c.name = v_security ->> 'asset_class'
         limit 1;

        v_security_id := gen_random_uuid();
        insert into public.securities (id, user_id, name, ticker, isin, currency, asset_class_id)
        values (
          v_security_id, p_user_id, v_security ->> 'name',
          nullif(v_security ->> 'ticker', ''), nullif(v_security ->> 'isin', ''),
          coalesce(upper(nullif(v_security ->> 'currency', '')), v_currency),
          v_asset_class_id
        );
      end if;
    end if;
  end if;

  if nullif(p_payload ->> 'counterparty_account_id', '') is not null
     and not exists (
       select 1 from public.financial_accounts
        where id = (p_payload ->> 'counterparty_account_id')::uuid and user_id = p_user_id
     ) then
    raise exception 'Compte de contrepartie introuvable';
  end if;

  if nullif(p_payload ->> 'transaction_id', '') is not null
     and not exists (
       select 1 from public.transactions
        where id = (p_payload ->> 'transaction_id')::uuid and user_id = p_user_id
     ) then
    raise exception 'Transaction bancaire introuvable';
  end if;

  -- La base refuserait déjà une désignation impossible ; cette vérification n'ajoute
  -- aucune règle, elle rend seulement le refus lisible côté produit.
  if nullif(p_payload ->> 'matched_acquisition_event_id', '') is not null
     and not exists (
       select 1 from public.portfolio_events
        where id = (p_payload ->> 'matched_acquisition_event_id')::uuid
          and user_id = p_user_id and account_id = v_account_id
          and security_id is not distinct from v_security_id
          and is_lot_opening
     ) then
    raise exception
      'Lot désigné invalide : il doit ouvrir un lot du même instrument dans cette enveloppe';
  end if;

  v_event_id := gen_random_uuid();
  insert into public.portfolio_events (
    id, user_id, account_id, security_id, event_type, event_date, settlement_date,
    quantity, unit_price, gross_amount, fee_amount, tax_amount, envelope_cash_amount,
    currency, counterparty_account_id, transaction_id, matched_acquisition_event_id,
    external_reference, data_kind, confidence, source, notes
  ) values (
    v_event_id, p_user_id, v_account_id, v_security_id, p_payload ->> 'event_type',
    (p_payload ->> 'event_date')::date,
    nullif(p_payload ->> 'settlement_date', '')::date,
    (p_payload ->> 'quantity')::numeric,
    (p_payload ->> 'unit_price')::numeric,
    (p_payload ->> 'gross_amount')::numeric,
    (p_payload ->> 'fee_amount')::numeric,
    (p_payload ->> 'tax_amount')::numeric,
    (p_payload ->> 'envelope_cash_amount')::numeric,
    v_currency,
    nullif(p_payload ->> 'counterparty_account_id', '')::uuid,
    nullif(p_payload ->> 'transaction_id', '')::uuid,
    nullif(p_payload ->> 'matched_acquisition_event_id', '')::uuid,
    nullif(p_payload ->> 'external_reference', ''),
    coalesce(nullif(p_payload ->> 'data_kind', ''), 'ACTUAL'),
    coalesce(nullif(p_payload ->> 'confidence', ''), 'HIGH'),
    nullif(p_payload ->> 'source', ''),
    nullif(p_payload ->> 'notes', '')
  );

  return v_event_id;
end;
$$;

-- Supprime un événement saisi par erreur. Un événement encore désigné comme lot par une
-- cession n'est pas supprimable : la cession perdrait sa convention d'appariement.
create or replace function public.lfo_delete_portfolio_event(
  p_user_id uuid,
  p_event_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.portfolio_events where id = p_event_id and user_id = p_user_id
  ) then
    raise exception 'Événement de portefeuille introuvable';
  end if;
  if exists (
    select 1 from public.portfolio_events
     where matched_acquisition_event_id = p_event_id and user_id = p_user_id
  ) then
    raise exception 'Événement désigné comme lot par une cession : corriger la cession d''abord';
  end if;
  delete from public.portfolio_events where id = p_event_id and user_id = p_user_id;
  return p_event_id;
end;
$$;

-- Déclare, corrige ou efface les conventions d'une enveloppe. Un `null` transmis efface
-- la déclaration ; il ne vaut jamais valeur par défaut.
create or replace function public.lfo_set_portfolio_envelope_policy(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_policy_id uuid;
begin
  v_account_id := (p_payload ->> 'account_id')::uuid;
  if not exists (
    select 1 from public.financial_accounts
     where id = v_account_id and user_id = p_user_id
       and status = 'ACTIVE' and account_type not in ('BANK', 'SAVINGS')
  ) then
    raise exception 'Enveloppe d''investissement introuvable ou inactive';
  end if;

  insert into public.portfolio_envelope_policies (
    user_id, account_id, lot_matching_method, ledger_coverage_start,
    ledger_coverage_source, notes, data_kind, confidence, source
  ) values (
    p_user_id, v_account_id,
    nullif(p_payload ->> 'lot_matching_method', ''),
    nullif(p_payload ->> 'ledger_coverage_start', '')::date,
    nullif(p_payload ->> 'ledger_coverage_source', ''),
    nullif(p_payload ->> 'notes', ''),
    'USER_ASSUMPTION', 'HIGH', 'Déclaration d''enveloppe'
  )
  on conflict (user_id, account_id) do update
    set lot_matching_method = excluded.lot_matching_method,
        ledger_coverage_start = excluded.ledger_coverage_start,
        ledger_coverage_source = excluded.ledger_coverage_source,
        notes = excluded.notes,
        updated_at = now()
  returning id into v_policy_id;

  return v_policy_id;
end;
$$;

revoke all on function public.lfo_record_portfolio_event(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lfo_delete_portfolio_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.lfo_set_portfolio_envelope_policy(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lfo_record_portfolio_event(uuid, jsonb) to service_role;
grant execute on function public.lfo_delete_portfolio_event(uuid, uuid) to service_role;
grant execute on function public.lfo_set_portfolio_envelope_policy(uuid, jsonb) to service_role;
