-- Léo Family Office — Real Estate V2
--
-- L'immobilier n'existait dans LFO que comme un simulateur d'acquisition : aucun bien
-- détenu, aucune valeur au bilan, et un amortissement de prêt recalculé localement. Cette
-- migration installe la couche de FAITS qui manquait, et une seule.
--
-- CE QU'ELLE N'INTRODUIT PAS, VOLONTAIREMENT
-- ------------------------------------------
--   * AUCUNE seconde vérité de dette. Un prêt immobilier reste une ligne de
--     `public.liabilities`, avec son taux, son échéancier et ses observations d'encours.
--     `real_estate_financing_links` ne fait que RATTACHER un bien à une dette déjà
--     existante, avec la quote-part du concours qui le finance. Le passif du bilan vient
--     toujours de `liabilities`, jamais du bien : aucune dette n'est comptée deux fois.
--   * AUCUNE seconde vérité de trésorerie. Un loyer encaissé et une taxe payée sont des
--     lignes de `public.transactions`. La colonne `transactions.property_id` ne fait que
--     les RATTACHER à un bien : elle n'en recopie pas le montant et n'en crée aucune.
--   * AUCUNE formule financière en SQL. Rendement, equity, plus-value, coût économique du
--     financement et scénarios sont dérivés par `src/lib/engine/real-estate.ts`.
--   * AUCUNE valeur par défaut à la place d'une donnée manquante. Tout terme
--     d'exploitation est nullable et un `null` y signifie « non déclaré », jamais zéro.
--   * AUCUNE règle fiscale. `effective_income_tax_rate` est une hypothèse que
--     l'utilisateur DÉCLARE ; à `null`, le moteur ne produit aucun résultat après impôt.
--
-- DISTINCTIONS ÉCONOMIQUES PORTÉES PAR LE SCHÉMA
-- ----------------------------------------------
--   valeur de marché      → real_estate_valuations       (observation datée)
--   prix et frais d'achat → real_estate_capital_events   (faits datés, base de coût)
--   travaux capitalisés   → real_estate_capital_events   (CAPEX, jamais une charge)
--   entretien courant     → real_estate_operating_terms  (charge, jamais du CAPEX)
--   financement           → liabilities + financing_links
--   flux réels            → transactions.property_id
--
-- TABLES HÉRITÉES NON CONSOMMÉES
-- ------------------------------
-- `public.mortgages` et `public.real_estate_cashflows` datent de la migration initiale et
-- n'ont jamais été lues par le code applicatif. `mortgages` porterait un second
-- échéancier immobilier et `real_estate_cashflows` un second ledger de trésorerie : les
-- deux contredisent le Debt Engine et le Cash Flow Engine. Elles sont marquées obsolètes
-- ici et ne sont ni lues ni écrites par Real Estate V2. Leur suppression serait
-- destructive et reste une décision humaine distincte.

-- ---------------------------------------------------------------------------
-- 0. Identité du bien : `public.properties` complété, jamais remplacé
-- ---------------------------------------------------------------------------

alter table public.properties
  -- Usage économique du bien. `null` = non déclaré, jamais « OTHER » : une résidence
  -- principale et un locatif n'ont ni le même rendement ni la même fiscalité, et supposer
  -- l'un à la place de l'autre fausserait les deux.
  add column if not exists property_usage text,
  -- Le bien est-il financé par une dette ? TRI-ÉTAT, et c'est tout l'enjeu :
  --
  --   false → l'utilisateur DÉCLARE que le bien n'est financé par aucune dette. Zéro est
  --           alors une valeur, et l'equity du bien vaut sa valeur attribuable.
  --   true  → une dette le finance. Tant qu'aucun concours n'est rattaché, la dette
  --           attribuée reste INCONNUE : elle n'est pas nulle.
  --   null  → non déclaré. Aucune métrique dépendant du financement n'est calculable.
  --
  -- Sans cette colonne, « je n'ai pas encore rattaché le crédit » et « j'ai acheté
  -- comptant » produiraient le même chiffre : une equity égale à la valeur du bien. La
  -- première situation surévaluerait alors le patrimoine du montant entier de la dette.
  add column if not exists debt_financed boolean,
  -- Quote-part réellement détenue, entre 0 exclu et 1. `null` = non déclarée : le moteur
  -- déclare alors la valeur attribuable NON CALCULABLE plutôt que de supposer 100 %.
  add column if not exists ownership_share numeric(9,8),
  add column if not exists acquisition_date date,
  add column if not exists disposal_date date,
  add column if not exists archived boolean not null default false,
  add column if not exists data_kind text not null default 'USER_ASSUMPTION',
  add column if not exists confidence text not null default 'HIGH',
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

-- `property_type` et `status` sont les colonnes de la conception initiale. Real Estate V2
-- ne les consomme pas : l'usage économique vit dans `property_usage` et l'état de suivi
-- dans `archived`. Leur contrainte NOT NULL est relâchée plutôt que satisfaite par une
-- valeur fabriquée : écrire « OTHER » ou « ACTIVE » dans une colonne que rien ne lit
-- inventerait une donnée, et la dupliquer depuis les colonnes canoniques créerait deux
-- vérités du même fait. Les lignes antérieures gardent la leur, intacte.
alter table public.properties alter column property_type drop not null;
alter table public.properties alter column status drop not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'properties_usage_ck'
  ) then
    alter table public.properties
      add constraint properties_usage_ck check (
        property_usage is null
        or property_usage in (
          'PRIMARY_RESIDENCE', 'SECONDARY_RESIDENCE', 'RENTAL', 'MIXED_USE', 'LAND', 'OTHER'
        )
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'properties_ownership_share_ck'
  ) then
    alter table public.properties
      add constraint properties_ownership_share_ck check (
        ownership_share is null or (ownership_share > 0 and ownership_share <= 1)
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'properties_disposal_after_acquisition_ck'
  ) then
    alter table public.properties
      add constraint properties_disposal_after_acquisition_ck check (
        disposal_date is null or acquisition_date is null or disposal_date >= acquisition_date
      ) not valid;
  end if;
end;
$$;

-- Les trois contraintes ci-dessus sont posées `not valid` puis validées : elles portent
-- sur des colonnes qui viennent d'être ajoutées, donc nulles partout, mais `properties`
-- peut contenir des lignes antérieures dont rien ne garantit la forme. Valider dans un
-- second temps échoue bruyamment sur une ligne non conforme au lieu de bloquer l'ajout
-- de la colonne.
alter table public.properties validate constraint properties_usage_ck;
alter table public.properties validate constraint properties_ownership_share_ck;
alter table public.properties validate constraint properties_disposal_after_acquisition_ck;

-- Cible des clés étrangères composites : un fait immobilier portant user A ne peut pas
-- référencer le bien de user B, même par écriture directe hors RPC.
create unique index if not exists properties_id_user_uidx
  on public.properties(id, user_id);

create index if not exists properties_owner_active_idx
  on public.properties(user_id, archived, name);

comment on column public.properties.property_usage is
  'Usage économique déclaré. null = non déclaré, jamais OTHER.';
comment on column public.properties.ownership_share is
  'Quote-part détenue, dans ]0,1]. null = non déclarée : la valeur attribuable devient NOT_COMPUTABLE.';
comment on column public.properties.debt_financed is
  'Le bien est-il financé par une dette ? false = déclaré sans dette, true = financé, null = non déclaré. Absence de rattachement n''est PAS absence de dette.';
comment on column public.properties.purchase_price is
  'HÉRITÉ, non consommé par Real Estate V2. Le prix d''achat canonique est l''événement ACQUISITION_PRICE de real_estate_capital_events, qui porte sa date, sa devise et sa provenance.';
comment on column public.properties.inputs is
  'HÉRITÉ, non consommé par Real Estate V2. Un blob jsonb ne porte ni provenance ni date par terme.';
comment on column public.properties.status is
  'HÉRITÉ, non consommé par Real Estate V2. L''état de suivi canonique est la colonne archived.';
comment on table public.mortgages is
  'OBSOLÈTE et non consommée. Un prêt immobilier est une ligne de public.liabilities, rattachée au bien par real_estate_financing_links. Cette table porterait un second échéancier.';
comment on table public.real_estate_cashflows is
  'OBSOLÈTE et non consommée. Les flux réels d''un bien sont des lignes de public.transactions rattachées par transactions.property_id. Cette table porterait un second ledger de trésorerie.';

-- ---------------------------------------------------------------------------
-- 1. Valorisations datées
-- ---------------------------------------------------------------------------
-- Une valorisation est une OBSERVATION, jamais un calcul : le moteur ne la fait pas
-- vieillir par un indice, il signale son âge. Un bien sans valorisation reste un bien
-- détenu dont la valeur est inconnue, ce qui n'est pas une valeur nulle.

create table if not exists public.real_estate_valuations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null,
  valued_at date not null,
  value numeric(20,6) not null,
  currency char(3) not null,
  valuation_method text not null,
  data_kind text not null default 'EXTERNAL_DATA',
  confidence text not null default 'MEDIUM',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint real_estate_valuations_property_fk
    foreign key (property_id, user_id)
    references public.properties(id, user_id) on delete cascade,
  constraint real_estate_valuations_value_ck check (value >= 0),
  constraint real_estate_valuations_method_ck check (
    valuation_method in (
      'MARKET_APPRAISAL', 'NOTARY_ESTIMATE', 'AGENT_ESTIMATE',
      'INDEX_ADJUSTED', 'USER_ESTIMATE', 'PURCHASE_PRICE'
    )
  ),
  constraint real_estate_valuations_data_kind_ck check (
    data_kind in (
      'ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING'
    )
  )
);

create index if not exists real_estate_valuations_latest_idx
  on public.real_estate_valuations(property_id, valued_at desc, created_at desc);
create index if not exists real_estate_valuations_owner_idx
  on public.real_estate_valuations(user_id, property_id);

comment on table public.real_estate_valuations is
  'Valorisations datées d''un bien. Observation pure : aucune indexation, aucun vieillissement calculé en base.';

-- ---------------------------------------------------------------------------
-- 2. Événements de capital : base de coût et cession
-- ---------------------------------------------------------------------------
-- Le montant est TOUJOURS positif : la direction économique vient du type, jamais du
-- signe. Un frais d'acquisition et un loyer ne vivent pas dans la même table parce qu'ils
-- ne sont pas la même grandeur : l'un entre dans la base de coût, l'autre dans le compte
-- d'exploitation. Les confondre romprait COÛT DE REVIENT ≠ CHARGE.

create table if not exists public.real_estate_capital_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null,
  event_type text not null,
  event_date date not null,
  amount numeric(20,6) not null,
  currency char(3) not null,
  label text,
  -- Jambe de trésorerie déjà classée dans le ledger bancaire, quand elle est connue. Le
  -- pointeur ne recopie aucun montant : il évite qu'un même décaissement soit saisi deux
  -- fois, une fois comme transaction et une fois comme fait immobilier.
  transaction_id uuid,
  data_kind text not null default 'ACTUAL',
  confidence text not null default 'HIGH',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint real_estate_capital_events_property_fk
    foreign key (property_id, user_id)
    references public.properties(id, user_id) on delete cascade,
  constraint real_estate_capital_events_transaction_fk
    foreign key (transaction_id, user_id)
    references public.transactions(id, user_id)
    on delete set null (transaction_id),
  constraint real_estate_capital_events_amount_ck check (amount >= 0),
  constraint real_estate_capital_events_type_ck check (
    event_type in (
      'ACQUISITION_PRICE', 'ACQUISITION_COST', 'CAPEX', 'DISPOSAL_PRICE', 'DISPOSAL_COST'
    )
  ),
  constraint real_estate_capital_events_data_kind_ck check (
    data_kind in (
      'ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING'
    )
  )
);

-- Un bien n'a qu'un prix d'achat et qu'un prix de cession : deux ancrages
-- contradictoires rendraient la base de coût et la plus-value indéterminées.
create unique index if not exists real_estate_capital_events_acquisition_uk
  on public.real_estate_capital_events(user_id, property_id)
  where event_type = 'ACQUISITION_PRICE';
create unique index if not exists real_estate_capital_events_disposal_uk
  on public.real_estate_capital_events(user_id, property_id)
  where event_type = 'DISPOSAL_PRICE';

create index if not exists real_estate_capital_events_owner_date_idx
  on public.real_estate_capital_events(user_id, property_id, event_date, created_at);
create index if not exists real_estate_capital_events_transaction_idx
  on public.real_estate_capital_events(transaction_id, user_id)
  where transaction_id is not null;

comment on table public.real_estate_capital_events is
  'Faits de capital d''un bien : prix d''achat, frais d''acquisition, travaux capitalisés, cession. Montant toujours positif, direction portée par le type.';

-- ---------------------------------------------------------------------------
-- 3. Termes d'exploitation déclarés, datés
-- ---------------------------------------------------------------------------
-- Chaque terme est nullable et le reste. Un `null` signifie « non déclaré » : le moteur
-- refuse alors de produire le rendement net qui en dépendrait, au lieu de traiter la
-- charge comme nulle et d'afficher un rendement flatteur.

create table if not exists public.real_estate_operating_terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null,
  effective_from date not null,
  currency char(3) not null,
  -- Loyer contractuel BRUT annuel, hors vacance et hors charges récupérables.
  annual_gross_rent numeric(20,6),
  -- Taux de vacance déclaré, dans [0,1]. `null` = non déclaré, distinct de « aucune
  -- vacance » : le loyer effectif devient alors non calculable.
  vacancy_rate numeric(9,8),
  annual_operating_charges numeric(20,6),
  annual_property_tax numeric(20,6),
  annual_insurance numeric(20,6),
  annual_maintenance numeric(20,6),
  annual_management_fees numeric(20,6),
  -- Frais de gestion exprimés en part du loyer encaissé. Exclusif du montant ci-dessus :
  -- les deux ensemble compteraient deux fois la même charge.
  management_fee_rate numeric(9,8),
  annual_other_costs numeric(20,6),
  -- Taux d'imposition effectif DÉCLARÉ par l'utilisateur sur le résultat foncier. LFO ne
  -- porte aucune règle fiscale immobilière fiable : à `null`, aucun résultat après impôt
  -- n'est produit. Ce n'est pas un taux par défaut.
  effective_income_tax_rate numeric(9,8),
  data_kind text not null default 'USER_ASSUMPTION',
  confidence text not null default 'MEDIUM',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint real_estate_operating_terms_property_fk
    foreign key (property_id, user_id)
    references public.properties(id, user_id) on delete cascade,
  constraint real_estate_operating_terms_effective_uk
    unique (user_id, property_id, effective_from),
  constraint real_estate_operating_terms_amounts_ck check (
    coalesce(annual_gross_rent, 0) >= 0
    and coalesce(annual_operating_charges, 0) >= 0
    and coalesce(annual_property_tax, 0) >= 0
    and coalesce(annual_insurance, 0) >= 0
    and coalesce(annual_maintenance, 0) >= 0
    and coalesce(annual_management_fees, 0) >= 0
    and coalesce(annual_other_costs, 0) >= 0
  ),
  constraint real_estate_operating_terms_rates_ck check (
    (vacancy_rate is null or (vacancy_rate >= 0 and vacancy_rate <= 1))
    and (management_fee_rate is null or (management_fee_rate >= 0 and management_fee_rate <= 1))
    and (
      effective_income_tax_rate is null
      or (effective_income_tax_rate >= 0 and effective_income_tax_rate <= 1)
    )
  ),
  constraint real_estate_operating_terms_management_exclusive_ck check (
    annual_management_fees is null or management_fee_rate is null
  ),
  constraint real_estate_operating_terms_data_kind_ck check (
    data_kind in (
      'ACTUAL', 'USER_ASSUMPTION', 'MODEL_ASSUMPTION', 'EXTERNAL_DATA', 'DERIVED', 'MISSING'
    )
  )
);

create index if not exists real_estate_operating_terms_latest_idx
  on public.real_estate_operating_terms(property_id, effective_from desc, created_at desc);
create index if not exists real_estate_operating_terms_owner_idx
  on public.real_estate_operating_terms(user_id, property_id);

comment on table public.real_estate_operating_terms is
  'Termes d''exploitation déclarés d''un bien, datés. Tout terme null signifie « non déclaré » et non « zéro ».';

-- ---------------------------------------------------------------------------
-- 4. Rattachement du financement à un bien
-- ---------------------------------------------------------------------------
-- Cette table ne crée AUCUN passif. Le passif du bilan vient de `liabilities` et lui
-- seul. Elle répond à une question d'attribution : quelle part de ce concours finance ce
-- bien ? C'est ce qui permet de calculer l'equity dans le bien sans jamais compter la
-- dette deux fois.

-- Cible composite exigée par la FK du rattachement : une dette ne peut être rattachée
-- qu'à un bien du même propriétaire, même par écriture directe hors RPC.
create unique index if not exists liabilities_id_user_uidx
  on public.liabilities(id, user_id);

create table if not exists public.real_estate_financing_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null,
  liability_id uuid not null,
  -- Part du concours affectée à ce bien, dans ]0,1]. La somme des parts d'un même
  -- concours ne peut pas dépasser 1 : la RPC le refuse et le moteur le re-contrôle.
  allocation_share numeric(9,8) not null,
  data_kind text not null default 'USER_ASSUMPTION',
  confidence text not null default 'HIGH',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_financing_links_property_fk
    foreign key (property_id, user_id)
    references public.properties(id, user_id) on delete cascade,
  constraint real_estate_financing_links_liability_fk
    foreign key (liability_id, user_id)
    references public.liabilities(id, user_id) on delete cascade,
  constraint real_estate_financing_links_pair_uk
    unique (user_id, property_id, liability_id),
  constraint real_estate_financing_links_share_ck check (
    allocation_share > 0 and allocation_share <= 1
  )
);

-- ---------------------------------------------------------------------------
-- 4 bis. Garde-fou TRANSACTIONNEL de la quote-part
-- ---------------------------------------------------------------------------
-- La règle « la somme des quote-parts d'un même concours ne dépasse jamais 1 » protège
-- contre le double comptage d'une dette. Une vérification faite dans la RPC ne suffit pas
-- à la garantir, pour deux raisons :
--
--   1. `authenticated` détient des droits d'écriture directs sur cette table. Une écriture
--      hors RPC contournerait entièrement le contrôle applicatif.
--   2. Même via la RPC, deux transactions concurrentes liraient le même total AVANT leurs
--      insertions respectives, puis dépasseraient 1 ensemble sans qu'aucune ne le voie.
--
-- Le contrôle vit donc dans la BASE, et il se sérialise. Le verrou porte sur la ligne du
-- concours : c'est l'objet réellement partagé entre deux écritures qui pourraient se
-- contredire, et le verrouiller force la seconde à attendre la première puis à relire un
-- total à jour. En READ COMMITTED, la somme qui suit le verrou ouvre un nouvel instantané
-- et voit donc la ligne validée par la transaction précédente ; sous un niveau plus
-- strict, la tentative de verrou échoue en erreur de sérialisation. Les deux issues sont
-- correctes : aucune ne laisse passer un cumul supérieur à 1.
--
-- Le contrôle de la RPC est CONSERVÉ : il produit un message utilisable par l'interface.
-- C'est ce trigger, et lui seul, qui constitue l'invariant.
-- Le préfixe `lfo_` est réservé aux RPC appelables par `service_role`. Ce n'est pas une
-- RPC : c'est une fonction de trigger, que personne n'appelle directement. Elle porte donc
-- un nom distinct, et son droit d'exécution est retiré à tous : PostgreSQL n'exige pas le
-- privilège EXECUTE pour déclencher un trigger, seul le privilège TRIGGER sur la table
-- compte.
create or replace function public.real_estate_allocation_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total numeric;
begin
  -- Verrou sérialisant. `perform` suffit : la valeur lue n'intéresse pas, seul le verrou
  -- compte. La clé étrangère garantit déjà l'existence de la ligne.
  perform 1
    from public.liabilities
   where id = new.liability_id and user_id = new.user_id
     for update;

  select coalesce(sum(allocation_share), 0) into v_total
    from public.real_estate_financing_links
   where user_id = new.user_id and liability_id = new.liability_id;

  -- Même tolérance que `ALLOCATION_TOLERANCE` du moteur : deux quote-parts saisies à
  -- 60 % et 40 % doivent passer malgré l'arithmétique décimale.
  if v_total > 1.00000001 then
    raise exception
      'Quote-part totale du concours à % : la même dette serait comptée deux fois',
      v_total
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- AFTER, et non BEFORE : la somme doit inclure la ligne qui vient d'être écrite. Un
-- BEFORE la manquerait et laisserait passer exactement le dépassement qu'il doit refuser.
drop trigger if exists real_estate_financing_links_allocation_guard
  on public.real_estate_financing_links;
create trigger real_estate_financing_links_allocation_guard
  after insert or update of allocation_share, liability_id, property_id, user_id
  on public.real_estate_financing_links
  for each row
  execute function public.real_estate_allocation_guard();

revoke all on function public.real_estate_allocation_guard() from public, anon, authenticated;

comment on function public.real_estate_allocation_guard() is
  'Invariant de non double comptage : Σ allocation_share par concours <= 1, garanti sous concurrence par un verrou de la ligne de dette, y compris hors RPC.';

create index if not exists real_estate_financing_links_liability_idx
  on public.real_estate_financing_links(liability_id, user_id);
create index if not exists real_estate_financing_links_property_idx
  on public.real_estate_financing_links(property_id, user_id);

comment on table public.real_estate_financing_links is
  'Rattachement d''un bien à une dette EXISTANTE de public.liabilities. Ne crée aucun passif : sert uniquement à attribuer une quote-part de dette à un bien.';
comment on column public.real_estate_financing_links.allocation_share is
  'Part du concours affectée à ce bien, dans ]0,1]. La somme des parts d''un concours ne dépasse jamais 1.';

-- ---------------------------------------------------------------------------
-- 5. Attribution des flux réels : `transactions.property_id`
-- ---------------------------------------------------------------------------
-- Une seule vérité de trésorerie. La colonne rattache une transaction déjà existante à
-- un bien ; elle ne duplique ni le montant, ni la catégorie, ni la nature canonique du
-- flux, qui restent portés par `transactions` et par le Cash Flow Engine.

alter table public.transactions
  add column if not exists property_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'transactions_property_fk'
  ) then
    alter table public.transactions
      add constraint transactions_property_fk
        foreign key (property_id, user_id)
        references public.properties(id, user_id)
        on delete set null (property_id);
  end if;
end;
$$;

create index if not exists transactions_property_owner_idx
  on public.transactions(property_id, user_id)
  where property_id is not null;

comment on column public.transactions.property_id is
  'Rattachement d''un flux réel à un bien. Attribution seule : ne duplique ni le montant ni la nature canonique du flux.';

-- ---------------------------------------------------------------------------
-- 6. RLS et permissions
-- ---------------------------------------------------------------------------

alter table public.real_estate_valuations enable row level security;
drop policy if exists owner_all on public.real_estate_valuations;
create policy owner_all on public.real_estate_valuations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.real_estate_capital_events enable row level security;
drop policy if exists owner_all on public.real_estate_capital_events;
create policy owner_all on public.real_estate_capital_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.real_estate_operating_terms enable row level security;
drop policy if exists owner_all on public.real_estate_operating_terms;
create policy owner_all on public.real_estate_operating_terms
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.real_estate_financing_links enable row level security;
drop policy if exists owner_all on public.real_estate_financing_links;
create policy owner_all on public.real_estate_financing_links
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.real_estate_valuations from anon;
revoke all on table public.real_estate_capital_events from anon;
revoke all on table public.real_estate_operating_terms from anon;
revoke all on table public.real_estate_financing_links from anon;
grant select, insert, update, delete on table public.real_estate_valuations to authenticated;
grant select, insert, update, delete on table public.real_estate_capital_events to authenticated;
grant select, insert, update, delete on table public.real_estate_operating_terms to authenticated;
grant select, insert, update, delete on table public.real_estate_financing_links to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RPC — écritures composées, aucune formule financière
-- ---------------------------------------------------------------------------
-- Ces fonctions résolvent des références et écrivent de façon atomique. Elles ne
-- calculent aucun rendement, aucune equity, aucune plus-value : ces grandeurs sont
-- dérivées par le moteur TypeScript, à partir des faits écrits ici.

-- Crée ou corrige l'identité d'un bien. `p_payload->>'property_id'` absent = création.
-- Un `null` transmis efface la déclaration correspondante ; il ne vaut jamais valeur par
-- défaut.
create or replace function public.lfo_save_real_estate_asset(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_property_id uuid;
begin
  v_property_id := nullif(p_payload ->> 'property_id', '')::uuid;

  if nullif(p_payload ->> 'name', '') is null then
    raise exception 'Le nom du bien est requis';
  end if;

  if v_property_id is null then
    v_property_id := gen_random_uuid();
    insert into public.properties (
      id, user_id, name, location, surface_sqm, property_usage, ownership_share,
      debt_financed, acquisition_date, disposal_date, archived, data_kind, confidence,
      source, notes, inputs, updated_at
    ) values (
      v_property_id, p_user_id, p_payload ->> 'name',
      nullif(p_payload ->> 'location', ''),
      (nullif(p_payload ->> 'surface_sqm', ''))::numeric,
      nullif(p_payload ->> 'property_usage', ''),
      (nullif(p_payload ->> 'ownership_share', ''))::numeric,
      -- `null` reste `null` : « je n'ai pas déclaré » ne devient jamais « pas de dette ».
      (nullif(p_payload ->> 'debt_financed', ''))::boolean,
      (nullif(p_payload ->> 'acquisition_date', ''))::date,
      (nullif(p_payload ->> 'disposal_date', ''))::date,
      false, 'USER_ASSUMPTION', 'HIGH',
      nullif(p_payload ->> 'source', ''),
      nullif(p_payload ->> 'notes', ''),
      '{}'::jsonb, now()
    );
  else
    if not exists (
      select 1 from public.properties where id = v_property_id and user_id = p_user_id
    ) then
      raise exception 'Bien immobilier introuvable';
    end if;
    update public.properties
       set name = p_payload ->> 'name',
           location = nullif(p_payload ->> 'location', ''),
           surface_sqm = (nullif(p_payload ->> 'surface_sqm', ''))::numeric,
           property_usage = nullif(p_payload ->> 'property_usage', ''),
           ownership_share = (nullif(p_payload ->> 'ownership_share', ''))::numeric,
           debt_financed = (nullif(p_payload ->> 'debt_financed', ''))::boolean,
           acquisition_date = (nullif(p_payload ->> 'acquisition_date', ''))::date,
           disposal_date = (nullif(p_payload ->> 'disposal_date', ''))::date,
           source = nullif(p_payload ->> 'source', ''),
           notes = nullif(p_payload ->> 'notes', ''),
           updated_at = now()
     where id = v_property_id and user_id = p_user_id;
  end if;

  return v_property_id;
end;
$$;

-- Retire un bien du patrimoine suivi sans détruire son historique. Les faits restent, ce
-- qui permet de rouvrir la lecture d'une cession passée.
create or replace function public.lfo_archive_real_estate_asset(
  p_user_id uuid,
  p_property_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.properties where id = p_property_id and user_id = p_user_id
  ) then
    raise exception 'Bien immobilier introuvable';
  end if;
  update public.properties
     set archived = true, updated_at = now()
   where id = p_property_id and user_id = p_user_id;
  return p_property_id;
end;
$$;

-- Enregistre une valorisation datée. Une valorisation postérieure ne remplace pas la
-- précédente : l'historique est conservé, et le moteur retient la plus récente qui ne
-- soit pas postérieure à la date de lecture.
create or replace function public.lfo_record_real_estate_valuation(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_property_id uuid;
begin
  v_property_id := (p_payload ->> 'property_id')::uuid;
  if not exists (
    select 1 from public.properties where id = v_property_id and user_id = p_user_id
  ) then
    raise exception 'Bien immobilier introuvable';
  end if;

  v_id := gen_random_uuid();
  insert into public.real_estate_valuations (
    id, user_id, property_id, valued_at, value, currency, valuation_method,
    data_kind, confidence, source, notes
  ) values (
    v_id, p_user_id, v_property_id,
    (p_payload ->> 'valued_at')::date,
    (p_payload ->> 'value')::numeric,
    upper(p_payload ->> 'currency'),
    p_payload ->> 'valuation_method',
    coalesce(nullif(p_payload ->> 'data_kind', ''), 'EXTERNAL_DATA'),
    coalesce(nullif(p_payload ->> 'confidence', ''), 'MEDIUM'),
    nullif(p_payload ->> 'source', ''),
    nullif(p_payload ->> 'notes', '')
  );
  return v_id;
end;
$$;

-- Enregistre un fait de capital. La jambe de trésorerie éventuelle est vérifiée mais
-- jamais créée : le ledger bancaire reste la seule vérité des flux.
create or replace function public.lfo_record_real_estate_capital_event(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_property_id uuid;
  v_transaction_id uuid;
begin
  v_property_id := (p_payload ->> 'property_id')::uuid;
  if not exists (
    select 1 from public.properties where id = v_property_id and user_id = p_user_id
  ) then
    raise exception 'Bien immobilier introuvable';
  end if;

  v_transaction_id := nullif(p_payload ->> 'transaction_id', '')::uuid;
  if v_transaction_id is not null and not exists (
    select 1 from public.transactions where id = v_transaction_id and user_id = p_user_id
  ) then
    raise exception 'Transaction bancaire introuvable';
  end if;

  v_id := gen_random_uuid();
  insert into public.real_estate_capital_events (
    id, user_id, property_id, event_type, event_date, amount, currency, label,
    transaction_id, data_kind, confidence, source, notes
  ) values (
    v_id, p_user_id, v_property_id,
    p_payload ->> 'event_type',
    (p_payload ->> 'event_date')::date,
    (p_payload ->> 'amount')::numeric,
    upper(p_payload ->> 'currency'),
    nullif(p_payload ->> 'label', ''),
    v_transaction_id,
    coalesce(nullif(p_payload ->> 'data_kind', ''), 'ACTUAL'),
    coalesce(nullif(p_payload ->> 'confidence', ''), 'HIGH'),
    nullif(p_payload ->> 'source', ''),
    nullif(p_payload ->> 'notes', '')
  );
  return v_id;
end;
$$;

create or replace function public.lfo_delete_real_estate_capital_event(
  p_user_id uuid,
  p_event_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.real_estate_capital_events
     where id = p_event_id and user_id = p_user_id
  ) then
    raise exception 'Événement de capital immobilier introuvable';
  end if;
  delete from public.real_estate_capital_events
   where id = p_event_id and user_id = p_user_id;
  return p_event_id;
end;
$$;

-- Déclare les termes d'exploitation à une date d'effet. Une seconde déclaration à la même
-- date corrige la première ; une date différente ouvre une nouvelle période sans effacer
-- l'ancienne. Chaque terme transmis à `null` est écrit `null` : « non déclaré » est une
-- information, et l'effacer par un coalesce la détruirait.
create or replace function public.lfo_set_real_estate_operating_terms(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_property_id uuid;
begin
  v_property_id := (p_payload ->> 'property_id')::uuid;
  if not exists (
    select 1 from public.properties where id = v_property_id and user_id = p_user_id
  ) then
    raise exception 'Bien immobilier introuvable';
  end if;

  insert into public.real_estate_operating_terms (
    user_id, property_id, effective_from, currency,
    annual_gross_rent, vacancy_rate, annual_operating_charges, annual_property_tax,
    annual_insurance, annual_maintenance, annual_management_fees, management_fee_rate,
    annual_other_costs, effective_income_tax_rate,
    data_kind, confidence, source, notes
  ) values (
    p_user_id, v_property_id,
    (p_payload ->> 'effective_from')::date,
    upper(p_payload ->> 'currency'),
    (nullif(p_payload ->> 'annual_gross_rent', ''))::numeric,
    (nullif(p_payload ->> 'vacancy_rate', ''))::numeric,
    (nullif(p_payload ->> 'annual_operating_charges', ''))::numeric,
    (nullif(p_payload ->> 'annual_property_tax', ''))::numeric,
    (nullif(p_payload ->> 'annual_insurance', ''))::numeric,
    (nullif(p_payload ->> 'annual_maintenance', ''))::numeric,
    (nullif(p_payload ->> 'annual_management_fees', ''))::numeric,
    (nullif(p_payload ->> 'management_fee_rate', ''))::numeric,
    (nullif(p_payload ->> 'annual_other_costs', ''))::numeric,
    (nullif(p_payload ->> 'effective_income_tax_rate', ''))::numeric,
    coalesce(nullif(p_payload ->> 'data_kind', ''), 'USER_ASSUMPTION'),
    coalesce(nullif(p_payload ->> 'confidence', ''), 'MEDIUM'),
    nullif(p_payload ->> 'source', ''),
    nullif(p_payload ->> 'notes', '')
  )
  on conflict (user_id, property_id, effective_from) do update
    set currency = excluded.currency,
        annual_gross_rent = excluded.annual_gross_rent,
        vacancy_rate = excluded.vacancy_rate,
        annual_operating_charges = excluded.annual_operating_charges,
        annual_property_tax = excluded.annual_property_tax,
        annual_insurance = excluded.annual_insurance,
        annual_maintenance = excluded.annual_maintenance,
        annual_management_fees = excluded.annual_management_fees,
        management_fee_rate = excluded.management_fee_rate,
        annual_other_costs = excluded.annual_other_costs,
        effective_income_tax_rate = excluded.effective_income_tax_rate,
        data_kind = excluded.data_kind,
        confidence = excluded.confidence,
        source = excluded.source,
        notes = excluded.notes
  returning id into v_id;

  return v_id;
end;
$$;

-- Rattache un bien à une dette EXISTANTE. Aucun passif n'est créé ici.
--
-- Le contrôle de quote-part fait ici est un CONFORT D'INTERFACE : il produit un message
-- lisible. Il ne constitue pas l'invariant, qui est porté par le trigger
-- `real_estate_financing_links_allocation_guard` : une vérification faite dans cette
-- fonction serait contournée par une écriture directe et ne résisterait pas à deux
-- écritures concurrentes.
create or replace function public.lfo_set_real_estate_financing_link(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_property_id uuid;
  v_liability_id uuid;
  v_share numeric;
  v_allocated_elsewhere numeric;
begin
  v_property_id := (p_payload ->> 'property_id')::uuid;
  v_liability_id := (p_payload ->> 'liability_id')::uuid;
  v_share := (p_payload ->> 'allocation_share')::numeric;

  if not exists (
    select 1 from public.properties where id = v_property_id and user_id = p_user_id
  ) then
    raise exception 'Bien immobilier introuvable';
  end if;
  if not exists (
    select 1 from public.liabilities
     where id = v_liability_id and user_id = p_user_id and archived = false
  ) then
    raise exception 'Dette introuvable ou archivée';
  end if;

  select coalesce(sum(allocation_share), 0) into v_allocated_elsewhere
    from public.real_estate_financing_links
   where user_id = p_user_id
     and liability_id = v_liability_id
     and property_id <> v_property_id;

  if v_allocated_elsewhere + v_share > 1.00000001 then
    raise exception
      'Quote-part totale du concours supérieure à 1 (déjà affectée : %) : la même dette serait comptée deux fois',
      v_allocated_elsewhere;
  end if;

  insert into public.real_estate_financing_links (
    user_id, property_id, liability_id, allocation_share,
    data_kind, confidence, source, notes
  ) values (
    p_user_id, v_property_id, v_liability_id, v_share,
    'USER_ASSUMPTION', 'HIGH',
    nullif(p_payload ->> 'source', ''),
    nullif(p_payload ->> 'notes', '')
  )
  on conflict (user_id, property_id, liability_id) do update
    set allocation_share = excluded.allocation_share,
        source = excluded.source,
        notes = excluded.notes,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.lfo_delete_real_estate_financing_link(
  p_user_id uuid,
  p_link_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.real_estate_financing_links
     where id = p_link_id and user_id = p_user_id
  ) then
    raise exception 'Rattachement de financement introuvable';
  end if;
  delete from public.real_estate_financing_links
   where id = p_link_id and user_id = p_user_id;
  return p_link_id;
end;
$$;

-- Rattache un flux réel à un bien, ou l'en détache quand `p_property_id` est nul. Le
-- montant, la catégorie et la nature canonique de la transaction ne sont jamais touchés :
-- cette fonction n'écrit qu'une attribution.
create or replace function public.lfo_attribute_transaction_to_property(
  p_user_id uuid,
  p_transaction_id uuid,
  p_property_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.transactions where id = p_transaction_id and user_id = p_user_id
  ) then
    raise exception 'Transaction introuvable';
  end if;
  if p_property_id is not null and not exists (
    select 1 from public.properties where id = p_property_id and user_id = p_user_id
  ) then
    raise exception 'Bien immobilier introuvable';
  end if;

  update public.transactions
     set property_id = p_property_id
   where id = p_transaction_id and user_id = p_user_id;

  return p_transaction_id;
end;
$$;

revoke all on function public.lfo_save_real_estate_asset(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.lfo_archive_real_estate_asset(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.lfo_record_real_estate_valuation(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.lfo_record_real_estate_capital_event(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.lfo_delete_real_estate_capital_event(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.lfo_set_real_estate_operating_terms(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.lfo_set_real_estate_financing_link(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.lfo_delete_real_estate_financing_link(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.lfo_attribute_transaction_to_property(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.lfo_save_real_estate_asset(uuid, jsonb) to service_role;
grant execute on function public.lfo_archive_real_estate_asset(uuid, uuid) to service_role;
grant execute on function public.lfo_record_real_estate_valuation(uuid, jsonb) to service_role;
grant execute on function public.lfo_record_real_estate_capital_event(uuid, jsonb) to service_role;
grant execute on function public.lfo_delete_real_estate_capital_event(uuid, uuid) to service_role;
grant execute on function public.lfo_set_real_estate_operating_terms(uuid, jsonb) to service_role;
grant execute on function public.lfo_set_real_estate_financing_link(uuid, jsonb) to service_role;
grant execute on function public.lfo_delete_real_estate_financing_link(uuid, uuid) to service_role;
grant execute on function public.lfo_attribute_transaction_to_property(uuid, uuid, uuid) to service_role;
