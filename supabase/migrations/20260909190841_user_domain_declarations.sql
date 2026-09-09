-- ---------------------------------------------------------------------------
-- DÉCLARATION D'APPLICABILITÉ D'UN DOMAINE — « je ne suis pas concerné » est un FAIT
-- ---------------------------------------------------------------------------
-- Migration ADDITIVE de la phase 2 de productisation (§37 ligne 2 du plan de refonte :
-- « Onboarding, Today, Inbox, démo »). Elle n'ouvre AUCUN chemin d'écriture sur une table
-- financière et ne redéfinit aucune RPC existante : elle ajoute une table et une RPC.
--
-- POURQUOI UNE TABLE, ET POURQUOI CELLE-LÀ
--
-- Le §18.1 du plan pose la quatrième question de tout écran de cadrage : « Êtes-vous
-- concerné ? Oui, non, je ne sais pas encore », et tranche que « la réponse `Non concerné`
-- devient `DECLARED_NONE`. Elle n'est jamais traitée comme une donnée inconnue ou une
-- erreur ». Le §38 règle 10 le redit du côté des données : « une donnée absente reste
-- absente, une donnée DÉCLARÉE INEXISTANTE reste distincte ».
--
-- Or aucune table du schéma ne portait cette réponse. Le produit ne pouvait donc distinguer
-- « cet utilisateur n'a pas de bien immobilier » de « cet utilisateur n'a rien saisi », et
-- les deux se rendaient identiquement : un domaine vide avec ses cartes en attente. C'est le
-- constat 5.6 du plan, « l'absence de données devient la matière principale des écrans ».
--
-- ABSENCE DE LIGNE ≠ UNDECIDED ≠ DECLARED_NONE. Les trois états sont distincts et aucun ne
-- se déduit d'un autre :
--
--   * aucune ligne  : la question n'a jamais été posée. L'onboarding la posera.
--   * `UNDECIDED`   : la question a été posée et l'utilisateur a répondu « je ne sais pas
--                     encore ». Ce n'est PAS une absence de réponse : c'est une réponse, et
--                     la reposer à chaque ouverture serait harceler quelqu'un qui a déjà dit
--                     ce qu'il avait à dire.
--   * `DECLARED_NONE` : l'utilisateur a déclaré n'être pas concerné. Le domaine se masque et
--                     redevient activable ; il ne produit plus aucune tâche.
--
-- APPEND-ONLY, ET CE N'EST PAS DE LA PRUDENCE DÉCORATIVE
--
-- La table ne porte PAS d'unicité par (propriétaire, domaine), et un changement d'avis
-- n'écrase rien : il AJOUTE une observation datée. Passer de `DECLARED_NONE` à `APPLICABLE`
-- démasque un domaine entier et remet ses réserves au tableau ; passer en sens inverse les
-- fait toutes disparaître. Un `update` en place répondrait « immobilier : non concerné » sans
-- pouvoir dire depuis quand, ni ce que la réponse était avant, alors que c'est exactement la
-- question qu'on se pose devant un patrimoine net qui a bougé sans qu'aucun montant change.
--
-- La déclaration COURANTE est donc DÉRIVÉE : c'est la plus récente par domaine. Elle n'est
-- pas persistée, parce qu'un état dérivé figé se met à mentir dès que la table bouge.
--
-- DÉCLARATION ≠ FAIT FINANCIER. Rien ici n'entre au bilan, ne classe un flux ni ne
-- valorise quoi que ce soit. Une déclaration change ce que l'interface MONTRE et ce qu'elle
-- DEMANDE ; elle ne change aucun montant. Un domaine déclaré non concerné qui porte malgré
-- tout des faits (un bien saisi puis oublié) ne les perd pas : ils restent en base, et
-- l'application le signale au lieu de choisir.

-- ---------------------------------------------------------------------------
-- 1. La table
-- ---------------------------------------------------------------------------
create table if not exists public.user_domain_declarations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Les HUIT domaines du §19.1 item 4, transcrits : « banque, investissement, dette,
  -- immobilier, carrière/revenus, entreprise, fiscalité, objectifs ». La liste est CLOSE
  -- côté base : un domaine inconnu de l'interface serait une déclaration que rien ne sait
  -- rendre, et le §16 interdit à un agent de décider quelles sections apparaissent.
  domain text not null check (domain in (
    'BANQUE',
    'INVESTISSEMENT',
    'DETTE',
    'IMMOBILIER',
    'CARRIERE',
    'ENTREPRISE',
    'FISCALITE',
    'OBJECTIFS'
  )),
  applicability text not null check (applicability in ('APPLICABLE', 'DECLARED_NONE', 'UNDECIDED')),
  -- Date ÉCONOMIQUE de la déclaration : le jour où l'utilisateur l'a faite, telle que
  -- l'application la lui a présentée. Distincte de `created_at`, qui est l'horodatage
  -- technique de l'écriture. Les confondre ferait dépendre l'ordre des déclarations de la
  -- latence du réseau.
  declared_on date not null,
  -- Rang d'écriture dans le domaine, à partir de 1. Il donne un ordre TOTAL là où deux
  -- horodatages n'en donnent pas : `now()` est le timestamp de la TRANSACTION, donc deux
  -- déclarations écrites dans le même appel portent la même valeur, et « laquelle est la
  -- dernière ? » n'a alors pas de réponse. C'est un smoke qui l'a établi, pas une relecture.
  --
  -- HORODATAGE ≠ ORDRE. Le rang est attribué par la RPC sous le verrou du domaine, ce qui le
  -- rend indépendant de l'horloge, de la latence et de la granularité du type.
  revision integer not null check (revision >= 1),
  -- Motif libre. `null` est légitime : le §18.3 interdit de préremplir, et exiger une
  -- justification pour dire « je n'ai pas de société » transformerait une réponse simple en
  -- formulaire.
  note text check (note is null or char_length(note) between 1 and 2000),
  created_at timestamptz not null default now(),
  -- Rôle PostgreSQL CONSTATÉ, posé par la base. L'appelant ne peut pas le déclarer : le
  -- §5 de la constitution du dépôt distingue IDENTITÉ DÉCLARÉE, IDENTITÉ VÉRIFIÉE et RÔLE
  -- D'EXÉCUTION, et une colonne que le client remplit ne répond pas à « qui a écrit ».
  executed_by text not null default current_user,
  -- Un rang par domaine et par propriétaire. Sans cette unicité, deux écritures concurrentes
  -- pourraient partager un rang et l'ordre total serait perdu là même où il est construit.
  constraint user_domain_declarations_revision_uidx unique (user_id, domain, revision)
);

-- Lecture qui compte : « la déclaration courante de chaque domaine de ce propriétaire ».
--
-- L'ordre est (date économique, rang) et non (date économique, horodatage) : c'est le seul
-- ordre TOTAL. La date économique prime sur le rang parce qu'une réponse antidatée vaut à
-- partir de sa date, pas à partir du moment où elle a été saisie ; le rang ne tranche qu'entre
-- deux réponses de la même date.
create index if not exists user_domain_declarations_current_idx
  on public.user_domain_declarations(user_id, domain, declared_on desc, revision desc);

comment on table public.user_domain_declarations is
  'Réponses à « êtes-vous concerné ? » (§18.1). APPEND-ONLY : un changement d''avis ajoute une observation datée, il n''écrase rien. La déclaration courante est la plus récente par domaine et n''est jamais persistée.';
comment on column public.user_domain_declarations.applicability is
  'APPLICABLE, DECLARED_NONE ou UNDECIDED. ABSENCE DE LIGNE ≠ UNDECIDED : la première dit que la question n''a pas été posée, la seconde qu''elle l''a été et que la réponse est « pas encore ».';
comment on column public.user_domain_declarations.declared_on is
  'Date économique de la déclaration, distincte de created_at qui horodate l''écriture.';
comment on column public.user_domain_declarations.revision is
  'Rang d''écriture dans le domaine. HORODATAGE ≠ ORDRE : now() est le timestamp de la transaction, donc deux déclarations d''un même appel le partagent. La déclaration courante s''ordonne par (declared_on, revision).';

-- ---------------------------------------------------------------------------
-- 2. Immuabilité
-- ---------------------------------------------------------------------------
-- Une observation append-only qu'on peut réécrire n'est pas append-only. Le refus porte sur
-- `update` ET sur `delete` : corriger une déclaration se fait en en ajoutant une nouvelle,
-- ce qui est précisément le geste que la table existe pour enregistrer.
--
-- `RESTRICT` n'est PAS employé sur la clé étrangère vers `auth.users` malgré ce trigger, et
-- la constitution du dépôt explique pourquoi il faudrait s'en méfier : « un ON DELETE
-- CASCADE et un trigger qui refuse tout DELETE ne peuvent pas être vrais ensemble ». Le
-- trigger s'exclut donc lui-même de la cascade en testant le contexte : une suppression
-- d'utilisateur emporte ses déclarations, une suppression applicative est refusée.
create or replace function public.user_domain_declaration_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Une déclaration d''applicabilité ne se modifie pas : ajoutez-en une nouvelle, l''historique est la réponse à « depuis quand »';
  end if;
  -- `pg_trigger_depth() > 1` signifie que ce DELETE est la conséquence d'une cascade et non
  -- un appel direct : le départ d'un utilisateur emporte ses déclarations, ce qui n'est pas
  -- une réécriture d'historique financier mais la fin du compte qui le portait.
  if tg_op = 'DELETE' and pg_trigger_depth() <= 1 then
    raise exception 'Une déclaration d''applicabilité ne se supprime pas : déclarez le domaine applicable si vous êtes finalement concerné';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists user_domain_declarations_immutable on public.user_domain_declarations;
create trigger user_domain_declarations_immutable
  before update or delete on public.user_domain_declarations
  for each row execute function public.user_domain_declaration_immutable();

-- ---------------------------------------------------------------------------
-- 3. RLS et privilèges
-- ---------------------------------------------------------------------------
-- Même règle que partout : `authenticated` LIT, les RPC `lfo_*` ÉCRIVENT.
alter table public.user_domain_declarations enable row level security;
drop policy if exists owner_all on public.user_domain_declarations;
create policy owner_all on public.user_domain_declarations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on table public.user_domain_declarations from anon, authenticated;
grant select on table public.user_domain_declarations to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC
-- ---------------------------------------------------------------------------
-- Écrit une déclaration, ou constate qu'elle est déjà celle-là.
--
-- IDEMPOTENCE PAR L'ÉTAT COURANT, pas par une contrainte d'unicité. Rouvrir l'onboarding et
-- recocher les mêmes réponses ne doit pas empiler huit lignes identiques : la RPC compare à
-- la déclaration COURANTE du domaine et n'écrit que si la réponse change. Un changement de
-- motif seul compte comme un changement — c'est une information sur la même réponse, et la
-- perdre serait perdre la seule phrase que l'utilisateur ait écrite.
--
-- Le verrou est pris AVANT la comparaison. Sans lui, deux appels concurrents liraient tous
-- deux « rien de déclaré » et écriraient chacun leur ligne : l'historique porterait deux
-- premières déclarations, et « depuis quand » n'aurait plus de réponse unique.
create or replace function public.lfo_declare_domain_applicability(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_domain text := nullif(p_payload ->> 'domain', '');
  v_applicability text := nullif(p_payload ->> 'applicability', '');
  v_declared_on date := nullif(p_payload ->> 'declared_on', '')::date;
  v_note text := nullif(p_payload ->> 'note', '');
  v_current record;
  v_revision integer;
  v_id uuid;
begin
  if p_user_id is null then
    raise exception 'Déclaration sans propriétaire : rien n''est écrit';
  end if;
  if v_domain is null or v_applicability is null then
    raise exception 'Déclaration sans domaine ou sans réponse : « non concerné » et « non renseigné » ne se devinent pas l''un de l''autre';
  end if;
  if v_declared_on is null then
    raise exception 'Déclaration sans date économique : une réponse non datée ne dit pas depuis quand elle vaut';
  end if;

  -- Verrou sur les lignes du domaine AVANT toute comparaison. `for update` sur zéro ligne ne
  -- verrouille rien : le verrou de premier insert vient du verrou consultatif ci-dessous,
  -- dont la clé est (propriétaire, domaine) et non la table entière — deux domaines
  -- différents restent concurrents.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || v_domain));

  select applicability, note
    into v_current
    from public.user_domain_declarations
   where user_id = p_user_id and domain = v_domain
   order by declared_on desc, revision desc
   limit 1;

  if v_current.applicability is not null
     and v_current.applicability = v_applicability
     and coalesce(v_current.note, '') = coalesce(v_note, '')
  then
    -- Rien n'a changé. Aucune ligne n'est ajoutée, et l'absence d'identifiant rendu le dit :
    -- rendre un identifiant fabriqué laisserait croire à une écriture.
    return null;
  end if;

  -- Le rang suivant est lu SOUS le verrou déjà pris : deux appels concurrents sur le même
  -- domaine se sérialisent, et l'unicité de la table reste un filet, pas le mécanisme.
  select coalesce(max(revision), 0) + 1
    into v_revision
    from public.user_domain_declarations
   where user_id = p_user_id and domain = v_domain;

  insert into public.user_domain_declarations (
    user_id, domain, applicability, declared_on, revision, note
  ) values (
    p_user_id, v_domain, v_applicability, v_declared_on, v_revision, v_note
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.lfo_declare_domain_applicability(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.lfo_declare_domain_applicability(uuid, jsonb)
  to service_role;
