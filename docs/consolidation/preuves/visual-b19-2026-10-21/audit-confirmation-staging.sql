begin;
set local role service_role;
do $test$
declare f record; d record; rev integer; restored_value numeric; restored_date date;
begin
  for f in
    select source_field.* from public.document_extraction_fields source_field
    join public.document_extraction_runs r on r.id=source_field.run_id and r.user_id=source_field.user_id
    where r.id='0cead24b-2922-4148-9782-29dfea7b059a' and source_field.box_code in ('L1.interest','L1.date')
  loop
    select decision_revision into rev from public.document_extraction_fields where id=f.id;
    perform public.lfo_correct_document_extraction_field(f.user_id,
      jsonb_build_object('field_id',f.id,'action','correct','expected_revision',rev,'reason','Test transactionnel B19')
      || case when f.unit='DATE' then jsonb_build_object('user_date','2026-11-06')
              else jsonb_build_object('user_value','17') end);
    perform public.lfo_correct_document_extraction_field(f.user_id,
      jsonb_build_object('field_id',f.id,'action','review','expected_revision',rev+1));
    select * into strict d from public.document_field_decisions where field_id=f.id order by decision_rank desc limit 1;
    if f.unit='DATE' then
      assert d.after_date is not distinct from f.normalized_date, 'Confirmation de date après correction mal tracée';
    else
      assert d.after_value is not distinct from f.normalized_value, 'Confirmation de montant après correction mal tracée';
    end if;
    perform public.lfo_correct_document_extraction_field(f.user_id,
      jsonb_build_object('field_id',f.id,'action','reject','expected_revision',rev+2,'reason','Test transactionnel B19'));
    perform public.lfo_correct_document_extraction_field(f.user_id,
      jsonb_build_object('field_id',f.id,'action','review','expected_revision',rev+3));
    select * into strict d from public.document_field_decisions where field_id=f.id order by decision_rank desc limit 1;
    assert d.before_status='REJECTED' and d.before_value is null and d.before_date is null,
      'Une case écartée est encore comptée comme une valeur dans la piste';
    select coalesce(user_value,normalized_value),coalesce(user_date,normalized_date)
      into restored_value,restored_date from public.document_extraction_fields where id=f.id;
    if f.unit='DATE' then
      assert d.after_date is not distinct from f.normalized_date and restored_date=f.normalized_date,
        'Confirmation de date après rejet mal tracée';
    else
      assert d.after_value is not distinct from f.normalized_value and restored_value=f.normalized_value,
        'Confirmation de montant zéro après rejet mal tracée';
    end if;
  end loop;
  assert (select count(*)=2 from public.document_extraction_fields where run_id='0cead24b-2922-4148-9782-29dfea7b059a' and box_code in ('L1.interest','L1.date')),
    'Les deux cas synthétiques ne sont pas présents';
end;
$test$;
rollback;
select 'PASS: correction/review et reject/review, MONEY zéro et DATE ; transaction annulée' as result,
  (select status from public.document_extraction_runs where id='0cead24b-2922-4148-9782-29dfea7b059a') as restored_run_status,
  has_function_privilege('anon','public.lfo_correct_document_extraction_field(uuid,jsonb)','EXECUTE') as anon_execute,
  has_function_privilege('authenticated','public.lfo_correct_document_extraction_field(uuid,jsonb)','EXECUTE') as authenticated_execute,
  has_function_privilege('service_role','public.lfo_correct_document_extraction_field(uuid,jsonb)','EXECUTE') as server_execute;
