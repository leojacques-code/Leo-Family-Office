-- B19 : la piste décrit les valeurs effectives avant et après chaque décision.
-- Confirmer retire une éventuelle correction et retient la valeur normalisée de la pièce.
-- Une case écartée ne porte aucune valeur effective, même si la source imprimait zéro.
-- Reprise exacte de la dernière RPC (20261012140000), confrontée à sa définition staging.
-- Aucune trace ancienne n'est réécrite. Aucun droit ni état canonique n'est modifié.

create or replace function public.lfo_correct_document_extraction_field(
  p_user_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_field_id uuid;
  v_action text;
  v_expected integer;
  v_reason text;
  v_value numeric;
  v_date date;
  v_run_id uuid;
  v_status text;
  v_unit text;
  v_field_status text;
  v_revision integer;
  v_before_value numeric;
  v_before_date date;
  v_after_status text;
  v_rank integer;
  v_family text;
  v_column text;
  v_liability_id uuid;
  v_first_row integer;
  v_last_row integer;
  v_first_opening numeric;
  v_last_closing numeric;
  v_principal numeric;
  v_reasons jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Décision sur une case : un objet est attendu' using errcode = 'LF422';
  end if;
  if p_payload ? 'actor_user_id' or p_payload ? 'decided_by' or p_payload ? 'executed_by' then
    raise exception 'L''acteur ne se déclare pas : il est établi par le serveur' using errcode = 'LF422';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('field_id', 'action', 'expected_revision', 'user_value', 'user_date', 'reason') then
      raise exception 'Décision sur une case : clé inconnue %', v_key using errcode = 'LF422';
    end if;
  end loop;

  v_field_id := (p_payload ->> 'field_id')::uuid;
  v_action := p_payload ->> 'action';
  if v_action is null or v_action not in ('correct', 'reject', 'review') then
    raise exception 'Action correct, reject ou review attendue' using errcode = 'LF422';
  end if;
  -- Deux gardes : PostgreSQL ne garantit pas le court-circuit d'un OR avant un cast.
  if coalesce(jsonb_typeof(p_payload -> 'expected_revision'), 'absent') <> 'number'
     or (p_payload ->> 'expected_revision') !~ '^[0-9]{1,9}$' then
    raise exception 'Révision attendue obligatoire : sans elle, une seconde décision écraserait la première'
      using errcode = 'LF422';
  end if;
  v_expected := (p_payload ->> 'expected_revision')::integer;
  if p_payload ? 'reason'
     and coalesce(jsonb_typeof(p_payload -> 'reason'), 'absent') not in ('string', 'null') then
    raise exception 'Motif attendu en texte' using errcode = 'LF422';
  end if;
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');

  -- Verrou AVANT la comparaison.
  select f.run_id, r.status, f.unit, f.validation_status, f.decision_revision,
         case when f.validation_status = 'REJECTED' then null
              else coalesce(f.user_value, f.normalized_value) end,
         case when f.validation_status = 'REJECTED' then null
              else coalesce(f.user_date, f.normalized_date) end,
         r.document_family, f.column_key, r.liability_id
    into v_run_id, v_status, v_unit, v_field_status, v_revision, v_before_value, v_before_date,
         v_family, v_column, v_liability_id
    from public.document_extraction_fields f
    join public.document_extraction_runs r on r.id = f.run_id and r.user_id = f.user_id
   where f.id = v_field_id and f.user_id = p_user_id
   for update of f, r;

  if v_run_id is null then
    raise exception 'Case introuvable' using errcode = 'LF404';
  end if;
  if v_status not in ('EXTRACTED', 'REVIEWED', 'VALIDATED') then
    raise exception 'Lecture au statut % : ses cases ne se corrigent plus', v_status;
  end if;
  if v_revision <> v_expected then
    raise exception 'Cette case a changé depuis votre lecture (révision % attendue, % courante) : relisez-la avant de décider',
      v_expected, v_revision using errcode = 'LF409';
  end if;

  -- Confirmer une case illisible la ferait passer pour revue avec une valeur toujours
  -- inconnue, et lèverait le blocage que la validation exige de résoudre.
  if v_action = 'review' and v_field_status = 'BLOCKED' then
    raise exception 'Une case illisible ne se confirme pas : corrigez-la ou écartez-la'
      using errcode = 'LF422';
  end if;

  if v_action = 'correct' then
    if v_unit = 'TEXT' then
      raise exception 'Une case de texte ne se corrige pas : elle n''entre dans aucun calcul'
        using errcode = 'LF422';
    end if;
    if v_unit = 'DATE' then
      if p_payload ? 'user_value' then
        raise exception 'Une case de date se corrige par user_date' using errcode = 'LF422';
      end if;
      if coalesce(jsonb_typeof(p_payload -> 'user_date'), 'absent') <> 'string'
         or (p_payload ->> 'user_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception
          'Correction sans valeur : corriger vers rien n''est pas une correction, c''est un rejet';
      end if;
      begin
        v_date := (p_payload ->> 'user_date')::date;
      exception when others then
        raise exception 'Date de correction inexistante au calendrier' using errcode = 'LF422';
      end;
    else
      if p_payload ? 'user_date' then
        raise exception 'Une case de nombre se corrige par user_value' using errcode = 'LF422';
      end if;
      if coalesce(jsonb_typeof(p_payload -> 'user_value'), 'absent') not in ('number', 'string') then
        raise exception
          'Correction sans valeur : corriger vers rien n''est pas une correction, c''est un rejet';
      end if;
      -- Bornes de `numeric(20,6)` : au-delà, la base lèverait une erreur technique.
      if (p_payload ->> 'user_value') !~ '^-?[0-9]{1,14}(\.[0-9]{1,6})?$' then
        raise exception 'Montant de correction : nombre décimal fini attendu, 14 chiffres entiers et 6 décimales au plus (ni NaN ni notation exponentielle)'
          using errcode = 'LF422';
      end if;
      v_value := (p_payload ->> 'user_value')::numeric;
      -- Même règle que le lecteur : seul un capital amorti peut être négatif (intérêts
      -- capitalisés). Une liasse, elle, porte des montants signés.
      if v_family = 'AMORTIZATION_SCHEDULE' and v_value < 0 and v_column is distinct from 'principal' then
        raise exception 'Montant négatif : dans un échéancier, seul le capital amorti peut l''être'
          using errcode = 'LF422';
      end if;
    end if;
  elsif p_payload ? 'user_value' or p_payload ? 'user_date' then
    raise exception 'Seule une correction porte une valeur' using errcode = 'LF422';
  end if;

  if v_action = 'reject' then
    v_after_status := 'REJECTED';
    update public.document_extraction_fields
       set validation_status = 'REJECTED',
           user_value = null,
           user_date = null,
           user_corrected_at = now(),
           user_reason = v_reason,
           decision_revision = decision_revision + 1
     where id = v_field_id and user_id = p_user_id;
  elsif v_action = 'review' then
    v_after_status := 'REVIEWED';
    update public.document_extraction_fields
       set validation_status = 'REVIEWED',
           user_value = null,
           user_date = null,
           user_reason = v_reason,
           decision_revision = decision_revision + 1
     where id = v_field_id and user_id = p_user_id
     returning case when unit = 'DATE' then null else normalized_value end,
               case when unit = 'DATE' then normalized_date else null end
          into v_value, v_date;
  else
    v_after_status := 'CORRECTED';
    update public.document_extraction_fields
       set validation_status = 'CORRECTED',
           user_value = v_value,
           user_date = v_date,
           user_corrected_at = now(),
           user_reason = v_reason,
           decision_revision = decision_revision + 1
     where id = v_field_id and user_id = p_user_id;
  end if;

  select coalesce(max(decision_rank), 0) + 1 into v_rank
    from public.document_field_decisions
   where field_id = v_field_id and user_id = p_user_id;

  insert into public.document_field_decisions (
    user_id, run_id, field_id, decision_rank, action, before_status, before_value, before_date,
    after_status, after_value, after_date, reason, actor_user_id
  ) values (
    p_user_id, v_run_id, v_field_id, v_rank, upper(v_action), v_field_status,
    case when v_unit = 'DATE' then null else v_before_value end,
    case when v_unit = 'DATE' then v_before_date else null end,
    v_after_status, v_value, v_date, v_reason, p_user_id
  );

  -- Une décision ramène la lecture en revue : elle n'est plus celle qui avait été validée.
  update public.document_extraction_runs
     set status = 'REVIEWED', reviewed_at = now(), validated_at = null
   where id = v_run_id and user_id = p_user_id and status in ('EXTRACTED', 'REVIEWED', 'VALIDATED');

  -- Complétude d'un échéancier RELUE après la décision : figée à la lecture, elle dirait
  -- « complet » un extrait dont l'utilisateur vient d'écarter ou de corriger un solde. Mêmes
  -- règles que le lecteur (`read.ts`) : premier solde d'ouverture = capital du contrat
  -- déclaré, dernier solde de clôture nul. Ce sont des comparaisons, pas une formule.
  if v_family = 'AMORTIZATION_SCHEDULE' then
    select min(row_number), max(row_number) into v_first_row, v_last_row
      from public.document_extraction_fields
     where run_id = v_run_id and user_id = p_user_id;
    select coalesce(user_value, normalized_value) into v_first_opening
      from public.document_extraction_fields
     where run_id = v_run_id and user_id = p_user_id and row_number = v_first_row
       and column_key = 'opening' and validation_status not in ('REJECTED', 'BLOCKED');
    select coalesce(user_value, normalized_value) into v_last_closing
      from public.document_extraction_fields
     where run_id = v_run_id and user_id = p_user_id and row_number = v_last_row
       and column_key = 'closing' and validation_status not in ('REJECTED', 'BLOCKED');
    select principal into v_principal
      from public.liabilities
     where id = v_liability_id and user_id = p_user_id and terms_status = 'CONTRACT';
    v_reasons := '[]'::jsonb;
    if v_first_row is null then
      v_reasons := v_reasons || jsonb_build_array('Aucune ligne de données.');
    end if;
    if not exists (
      select 1 from public.document_extraction_fields
       where run_id = v_run_id and user_id = p_user_id and column_key = 'opening'
    ) then
      v_reasons := v_reasons || jsonb_build_array(
        'Colonne de solde d’ouverture absente : le début du prêt n’est pas vérifiable.');
    elsif v_principal is null then
      v_reasons := v_reasons || jsonb_build_array(
        'Capital initial du contrat non déclaré : le début du prêt n’est pas vérifiable.');
    elsif v_first_opening is distinct from v_principal then
      v_reasons := v_reasons || jsonb_build_array(
        'Le premier solde d’ouverture est absent, écarté ou différent du capital initial du contrat : l’extrait ne commence pas au début du prêt.');
    end if;
    if not exists (
      select 1 from public.document_extraction_fields
       where run_id = v_run_id and user_id = p_user_id and column_key = 'closing'
    ) then
      v_reasons := v_reasons || jsonb_build_array(
        'Colonne de solde de clôture absente : la fin du prêt n’est pas vérifiable.');
    elsif v_last_closing is distinct from 0 then
      v_reasons := v_reasons || jsonb_build_array(
        'Le dernier solde de clôture est absent, écarté ou non nul : l’extrait s’arrête avant la fin.');
    end if;
    update public.document_extraction_runs
       set completeness = case when jsonb_array_length(v_reasons) = 0 then 'COMPLETE' else 'PARTIAL' end,
           completeness_reasons = v_reasons
     where id = v_run_id and user_id = p_user_id;
  end if;

  perform public.lfo_evaluate_document_extraction_checks(
    p_user_id, jsonb_build_object('run_id', v_run_id::text)
  );

  return v_field_id;
end;
$$;
