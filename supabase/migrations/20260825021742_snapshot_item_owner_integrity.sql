-- Empêche qu'un item portant user A puisse référencer le snapshot de user B,
-- même via un client authentifié qui connaîtrait un UUID externe.
create unique index if not exists net_worth_snapshots_id_user_uidx
  on public.net_worth_snapshots(id, user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'net_worth_snapshot_items_owner_fk'
       and conrelid = 'public.net_worth_snapshot_items'::regclass
  ) then
    alter table public.net_worth_snapshot_items
      add constraint net_worth_snapshot_items_owner_fk
      foreign key (snapshot_id, user_id)
      references public.net_worth_snapshots(id, user_id)
      on delete cascade;
  end if;
end;
$$;
