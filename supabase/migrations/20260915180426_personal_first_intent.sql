-- Préférence de présentation, sans création ni modification de faits financiers.
alter table public.profiles add column first_intent text;
alter table public.profiles add constraint profiles_first_intent_ck
  check (first_intent is null or first_intent in ('BUDGET','WEALTH','PROJECT','INVESTMENTS'));
comment on column public.profiles.first_intent is
  'Première intention déclarée, facultative et réversible. Ne fixe aucune hypothèse ni allocation financière.';
