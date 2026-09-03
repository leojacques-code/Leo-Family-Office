-- ---------------------------------------------------------------------------
-- Durcissement du gel du brut d'import
-- ---------------------------------------------------------------------------
-- Correction ADDITIVE d'un défaut de RAISONNEMENT du garde-fou `import_raw_records_immutable`,
-- pas d'un défaut de comportement observé sous les rôles d'aujourd'hui. Le constat est établi
-- par sonde, sur base locale reconstruite depuis zéro :
--
--   * sous un rôle qui CONTOURNE la RLS — `service_role` porte `bypassrls`, comme sur
--     Supabase — le garde lit correctement le statut : la suppression du brut d'une session
--     `COMMITTED`, `DISCARDED` ou `FAILED` est REFUSÉE, et seules `RECEIVING` et `ANALYZED`
--     passent. Le smoke du socle le vérifie déjà.
--   * sous un rôle qui NE le contourne pas, `import_sessions` rend ZÉRO ligne, `v_status`
--     vaut `null`, et le garde en conclut « session déjà supprimée, cascade légitime » : la
--     suppression du brut d'une session COMMITTÉE est alors AUTORISÉE. Sonde reproduite :
--     un rôle voyant le brut mais pas les sessions supprime le brut d'une session
--     `COMMITTED` sans aucun refus.
--
-- Aucun chemin applicatif ne l'atteint aujourd'hui : `authenticated` n'a que le SELECT sur
-- `import_raw_records`, donc la permission tombe avant le trigger, et le serveur travaille
-- sous `service_role` qui contourne la RLS. Le garde est donc correct PAR ACCIDENT d'un
-- attribut de rôle, et non par construction : forcer la RLS sur la table, retirer
-- `bypassrls`, ou ouvrir un jour un chemin de suppression à un rôle applicatif inverserait
-- le garde en silence, dans le sens le plus coûteux — celui qui autorise.
--
-- SESSION ABSENTE ≠ SESSION INVISIBLE. C'est cette distinction qui est posée ici, et elle
-- ne peut pas l'être par une lecture `security invoker` : elle exige une lecture qui ne
-- dépend PAS de ce que l'appelant a le droit de voir.
--
-- Deux invariants supplémentaires, du même mouvement :
--
--   * UN FAIT ÉCRIT GÈLE TOUT LE BRUT DE SA SESSION. Le garde ne s'appuyait que sur le
--     statut affiché ; il s'appuie maintenant d'abord sur la PREUVE qu'un fait canonique
--     existe — un lien de provenance, une ligne normalisée committée, une écriture
--     comptable committée. Une session dont le statut aurait été remis en arrière ne
--     rouvre donc pas la suppression de sa propre provenance.
--   * SUPPRIMER LE BRUT D'UNE SESSION VIVANTE N'EST PAS UN ABANDON. Le socle autorisait la
--     suppression sur toute session `RECEIVING` ou `ANALYZED`, parce que c'était l'état dans
--     lequel `lfo_discard_import_session` travaillait. Le retrait devient DÉCLARÉ : la RPC
--     d'abandon marque la session `DISCARDED` AVANT de libérer ses lignes, et le garde
--     n'autorise plus que cet état. Une suppression de brut laisse donc désormais une
--     trace dans la piste d'audit, ou elle est refusée.
--
-- Cette migration ne modifie AUCUNE migration historique : elle redéfinit deux objets par
-- `create or replace` et ajoute une fonction de lecture d'invariant.

-- ---------------------------------------------------------------------------
-- 1. Lecture d'invariant indépendante de la visibilité de l'appelant
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER est ici NÉCESSAIRE et non pas commode : la question posée est
-- « cette session existe-t-elle ? », et une réponse filtrée par la RLS de l'appelant ne
-- répond pas à cette question — elle répond à « l'appelant peut-il la voir ? ».
--
-- Surface minimale, délibérément :
--
--   * elle ne rend AUCUNE donnée d'affaire : un état de gel, sous forme de texte ;
--   * elle est `stable`, sans aucune écriture ;
--   * `search_path` est verrouillé à vide et tous les objets sont qualifiés par leur schéma ;
--   * elle n'est PAS nommée `lfo_*` : ce n'est pas une RPC d'écriture, c'est la lecture
--     interne d'un garde-fou, et le contrat « aucune RPC `lfo_*` en SECURITY DEFINER »
--     reste donc entier, vérifié par le gate ;
--   * AUCUN `execute` pour `public`, `anon` ni `authenticated`. `service_role` seul l'obtient,
--     parce que c'est le rôle sous lequel les chemins de cascade et d'abandon s'exécutent.
--     Un futur rôle applicatif qui recevrait un DELETE sur le brut sans ce privilège
--     échouerait sur « permission denied for function » : le défaut est FERMÉ, jamais ouvert.
create or replace function public.import_session_freeze_state(
  p_session_id uuid,
  p_user_id uuid
) returns text
language sql
security definer
stable
set search_path = ''
as $$
  select case
    -- ABSENTE : la session n'existe réellement plus. C'est le cas de la CASCADE d'une
    -- session supprimée, et la clé étrangère composée garantit qu'un brut ne peut pas
    -- exister sans sa session en dehors de ce chemin.
    when not exists (
      select 1 from public.import_sessions s
       where s.id = p_session_id and s.user_id = p_user_id
    ) then 'ABSENT'
    -- FAITS ÉCRITS : preuve, pas statut. Un lien de provenance existe pour CHAQUE fait
    -- canonique produit par un import, quel que soit son domaine — transaction bancaire,
    -- instantané financier, événement de portefeuille, observation de position. Les deux
    -- autres témoins couvrent une session partiellement committée dont le statut n'aurait
    -- pas encore basculé.
    when exists (
      select 1 from public.import_record_links l
       where l.session_id = p_session_id and l.user_id = p_user_id
    ) or exists (
      select 1 from public.import_normalized_records r
       where r.session_id = p_session_id and r.user_id = p_user_id
         and r.commit_state = 'COMMITTED'
    ) or exists (
      select 1 from public.fec_entry_lines f
       where f.session_id = p_session_id and f.user_id = p_user_id
         and f.commit_state = 'COMMITTED'
    ) then 'FACTS_WRITTEN'
    else (
      select s.status from public.import_sessions s
       where s.id = p_session_id and s.user_id = p_user_id
    )
  end
$$;

revoke all on function public.import_session_freeze_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.import_session_freeze_state(uuid, uuid) to service_role;

comment on function public.import_session_freeze_state(uuid, uuid) is
  'État de gel d''une session d''import, lu indépendamment de la visibilité RLS de l''appelant : ABSENT (session réellement supprimée), FACTS_WRITTEN (un fait canonique existe), ou le statut de la session. Lecture interne du garde-fou du brut, exécutable par service_role seul.';

-- ---------------------------------------------------------------------------
-- 2. Le garde-fou du brut
-- ---------------------------------------------------------------------------
-- Même doctrine qu'à l'origine : le brut ne se corrige pas, et il ne s'efface pas. Ce qui
-- change est la façon dont l'autorisation est ÉTABLIE, pas ce qu'elle autorise sur le fond.
create or replace function public.import_raw_record_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_state text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Un enregistrement brut est immuable : corriger la ligne normalisée, pas la source';
  end if;

  v_state := public.import_session_freeze_state(old.session_id, old.user_id);

  -- Session réellement ABSENTE : la suppression vient de la CASCADE d'une session
  -- supprimée. Ce chemin reste ouvert, et il reste lui-même barré dès qu'un fait a été
  -- écrit — la cascade vers les liens de provenance et les lignes committées est refusée
  -- par leurs propres gels. `ABSENT` ne peut plus être confondu avec « invisible ».
  if v_state = 'ABSENT' then
    return old;
  end if;

  if v_state = 'FACTS_WRITTEN' then
    raise exception
      'Enregistrement brut d''une session qui a produit un fait canonique : sa provenance ne se supprime pas';
  end if;

  -- Le seul retrait autorisé sur une session VIVANTE est l'abandon DÉCLARÉ. Le brut d'une
  -- session encore en réception ou analysée ne disparaît plus sans que la piste d'audit
  -- dise qu'elle a été abandonnée.
  if v_state = 'DISCARDED' then
    return old;
  end if;

  raise exception
    'Enregistrement brut d''une session % : le brut ne se supprime qu''en abandonnant la session',
    v_state;
end;
$$;

-- Le trigger lui-même est inchangé ; il est reposé pour que la migration soit rejouable
-- sans dépendre de l'ordre d'application.
drop trigger if exists import_raw_records_immutable on public.import_raw_records;
create trigger import_raw_records_immutable
  before update or delete on public.import_raw_records
  for each row execute function public.import_raw_record_immutable();

comment on table public.import_raw_records is
  'Ce que la source a réellement fourni, ligne par ligne. Immuable : un trigger refuse toute mise à jour, et toute suppression hors cascade d''une session réellement supprimée ou abandon DÉCLARÉ d''une session sans fait écrit.';

-- ---------------------------------------------------------------------------
-- 3. Abandon d'une analyse — l'ordre s'inverse, et c'est le point
-- ---------------------------------------------------------------------------
-- Version reprise de `20260828131216_fec_corporate_acquisition`, la DERNIÈRE en vigueur :
-- domaine comptable inclus, état de réception inclus. Seul l'ORDRE change.
--
-- L'ancienne version libérait les lignes PUIS marquait la session `DISCARDED`, en notant
-- que l'inverse aurait fait refuser sa propre suppression par le garde du brut. C'était
-- exact, et c'est précisément ce qui rendait toute suppression de brut d'une session
-- vivante indiscernable d'un abandon. Le garde autorise maintenant `DISCARDED` : marquer
-- d'abord devient possible, et devient la seule façon de libérer un brut.
--
-- Les gels des lignes de staging et des écritures comptables portent sur leur propre
-- `commit_state`, jamais sur le statut de la session : l'inversion ne les touche pas. Et une
-- session abandonnable n'a par définition aucune ligne committée, donc aucun fait écrit.
create or replace function public.lfo_discard_import_session(
  p_user_id uuid,
  p_session_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.import_sessions
   where id = p_session_id and user_id = p_user_id
     for update;
  if v_status is null then
    raise exception 'Session d''import introuvable';
  end if;
  if v_status not in ('RECEIVING', 'ANALYZED') then
    raise exception 'Seule une session en réception ou analysée peut être abandonnée (statut %)', v_status;
  end if;

  -- L'ABANDON EST DÉCLARÉ D'ABORD. La piste d'audit porte donc la trace de l'abandon avant
  -- que la moindre ligne ne soit libérée, et le garde du brut n'autorise le retrait que sur
  -- cette base.
  update public.import_sessions
     set status = 'DISCARDED', discarded_at = now()
   where id = p_session_id and user_id = p_user_id;

  delete from public.import_normalized_records
   where session_id = p_session_id and user_id = p_user_id;

  delete from public.fec_entry_lines
   where session_id = p_session_id and user_id = p_user_id;

  delete from public.import_raw_records
   where session_id = p_session_id and user_id = p_user_id;

  return p_session_id;
end;
$$;

revoke all on function public.lfo_discard_import_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lfo_discard_import_session(uuid, uuid) to service_role;
