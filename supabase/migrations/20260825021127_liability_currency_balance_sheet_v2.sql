-- La valeur native d'un passif doit porter sa devise, comme tout autre domaine du bilan.
-- Les contrats historiques sont en EUR ; le default préserve exactement leur économie.
alter table public.liabilities
  add column if not exists currency char(3) not null default 'EUR';

comment on column public.liabilities.currency is
  'Native currency of the observed liability balance; converted by Canonical Balance Sheet V2.';
