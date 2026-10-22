-- B16 : contrat de dette ADAPTATIF (document 04, étape C).
--
--     MONTANT OU DURÉE SELON LA DONNÉE CONNUE        TERME DÉDUIT ≠ TERME DÉCLARÉ
--
-- Pour un prêt amortissable à échéance constante, le document 04 demande « taux nominal,
-- convention, fréquence, première échéance ; montant ou durée selon donnée connue », et
-- interdit de supposer vrais simultanément un montant et une durée qui ne bouclent pas.
-- `liabilities_terms_completeness_ck` exigeait pourtant mensualité, nombre d'échéances ET
-- maturité pour tout contrat : un utilisateur qui ne connaissait que sa mensualité devait
-- inventer une durée, et le formulaire proposait « aujourd'hui + un an ».
--
-- La contrainte successeure exige, pour un CONTRAT, les termes de structure (capital, taux,
-- première échéance, profil, fréquence, convention, type de taux, différé) et AU MOINS UN
-- terme qui fixe la durée : nombre d'échéances, maturité, ou mensualité pour un prêt
-- amortissable. Le Debt Engine déduit les autres à la lecture (`resolveContractTerms`) ;
-- rien de déduit n'est persisté. La branche OUTSTANDING_ONLY est reprise à l'identique.
--
-- Aucune donnée n'est réécrite : les lignes existantes portent les trois termes et
-- satisfont la nouvelle contrainte. Une mensualité historique à 0 (que le moteur lisait
-- déjà comme « non déclarée ») est lue comme telle ; les nouvelles écritures la refusent par
-- validation applicative.
--
-- Définition de départ relue en base (`pg_get_constraintdef`) le 24 septembre 2026, et nom
-- successeur vérifié libre.

alter table public.liabilities
  drop constraint liabilities_terms_completeness_ck;

alter table public.liabilities
  add constraint liabilities_terms_completeness_v2_ck
  check (
    (
      terms_status = 'CONTRACT'
      and lender is not null
      and principal is not null
      and annual_rate is not null
      and first_payment_date is not null
      and rate_type is not null
      and deferral_kind is not null
      and deferral_months is not null
      and deferral_interest_treatment is not null
      and amortisation_profile is not null
      and payment_frequency is not null
      and interest_convention is not null
      and (
        payment_count is not null
        or maturity_date is not null
        or (amortisation_profile = 'AMORTIZING' and monthly_payment is not null)
      )
    )
    or (
      terms_status = 'OUTSTANDING_ONLY'
      and principal is null
      and annual_rate is null
      and monthly_payment is null
      and payment_count is null
      and first_payment_date is null
      and maturity_date is null
      and rate_type is null
      and deferral_kind is null
      and deferral_months is null
      and deferral_interest_treatment is null
      and amortisation_profile is null
      and payment_frequency is null
      and interest_convention is null
      and monthly_insurance is null
      and recurring_fees is null
      and payment_includes_insurance is null
      and balloon_amount is null
      and facility_id is null
    )
  );

-- Une maturité déclarée ne précède jamais la première échéance, et un nombre d'échéances
-- déclaré est au moins 1. Contrôles d'intégrité de forme, pas de calcul financier.
alter table public.liabilities
  add constraint liabilities_contract_dates_ck
  check (
    maturity_date is null or first_payment_date is null or maturity_date >= first_payment_date
  ),
  add constraint liabilities_payment_count_ck
  check (payment_count is null or payment_count >= 1);
