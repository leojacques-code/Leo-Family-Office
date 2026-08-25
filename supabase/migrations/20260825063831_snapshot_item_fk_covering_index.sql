drop index if exists public.net_worth_snapshot_items_owner_snapshot_idx;

create index if not exists net_worth_snapshot_items_snapshot_owner_idx
  on public.net_worth_snapshot_items(snapshot_id, user_id);
