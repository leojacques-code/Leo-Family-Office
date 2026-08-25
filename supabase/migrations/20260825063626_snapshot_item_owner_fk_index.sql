create index if not exists net_worth_snapshot_items_owner_snapshot_idx
  on public.net_worth_snapshot_items(user_id, snapshot_id);
