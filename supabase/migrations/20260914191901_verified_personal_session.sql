-- Lecture de révocation uniquement. Aucun utilisateur ni fait financier créé.
create schema if not exists lfo_private;
revoke all on schema lfo_private from public, anon, authenticated;
grant usage on schema lfo_private to service_role;

create or replace function lfo_private.verify_session(p_user_id uuid, p_session_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = p_session_id and s.user_id = p_user_id
      and (s.not_after is null or s.not_after > now())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  );
$$;
revoke all on function lfo_private.verify_session(uuid, uuid) from public, anon, authenticated;
grant execute on function lfo_private.verify_session(uuid, uuid) to service_role;

create or replace function public.lfo_verify_session(p_user_id uuid, p_session_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$ select lfo_private.verify_session(p_user_id, p_session_id); $$;
revoke all on function public.lfo_verify_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lfo_verify_session(uuid, uuid) to service_role;
