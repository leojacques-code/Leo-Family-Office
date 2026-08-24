-- Compatibilité des dossiers qui possèdent encore un échéancier DERIVED stocké.
-- Une ligne bancaire ACTUAL remplace la reconstruction du même numéro au moment de
-- l'insertion ; elle ne peut donc jamais échouer sur l'ancienne contrainte d'unicité.

create or replace function public.enforce_actual_schedule_priority()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.loan_schedules
   where liability_id = new.liability_id
     and payment_number = new.payment_number
     and data_kind <> 'ACTUAL';
  return new;
end;
$$;

drop trigger if exists loan_schedules_actual_priority on public.loan_schedules;
create trigger loan_schedules_actual_priority
before insert on public.loan_schedules
for each row
when (new.data_kind = 'ACTUAL')
execute function public.enforce_actual_schedule_priority();

revoke all on function public.enforce_actual_schedule_priority() from public, anon, authenticated;
