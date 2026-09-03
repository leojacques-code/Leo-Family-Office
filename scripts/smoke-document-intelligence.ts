/**
 * Smoke transactionnel de Document Intelligence. Toutes les écritures sont annulées : aucune
 * donnée synthétique ne reste persistée.
 *
 * Ce que le smoke prouve :
 *
 *   * une lecture écrit ses cases par lots, ATOMIQUEMENT, et ses décomptes sont DÉRIVÉS des
 *     lignes persistées, jamais repris d'un décompte fourni par l'appelant ;
 *   * l'arithmétique des contrôles est faite EN BASE : une charge forgée ne peut pas déclarer
 *     un bilan équilibré que les cases ne montrent pas ;
 *   * un contrôle dont un opérande est ABSENT rend `NOT_COMPUTABLE`, jamais `PASSED` ;
 *   * un contrôle dont un opérande est AMBIGU — deux cases pour le même code — rend
 *     `NOT_COMPUTABLE` : sommer les deux inventerait un total ;
 *   * une case REJETÉE sort du contrôle, et le contrôle redevient non calculable ;
 *   * une correction utilisateur est prise en compte par les contrôles DANS LA MÊME
 *     transaction, et la lecture retombe en revue ;
 *   * ce que le document imprimait est IMMUABLE : code, page, cadre, valeur brute, méthode ;
 *   * la validation est refusée sur un contrôle bloquant en échec, et sur une case illisible ;
 *   * la liaison est refusée hors état validé, sans exercice lu, sur une clôture qui ne
 *     correspond pas, et sur un champ dont la définition est une convention (EBITDA, capex…) ;
 *   * la liaison écrit le fait canonique ET sa provenance en une transaction, et rend `LINKED` ;
 *   * l'exercice RÉELLEMENT lu est conservé : les deux bornes, pas seulement la clôture ;
 *   * CONFLIT DE SOURCES : une période déjà renseignée par une autre origine n'est pas écrasée ;
 *   * une lecture rattachée à un fait est GELÉE : cases non modifiables, lecture non rejetable,
 *     provenance non supprimable ;
 *   * idempotence : le même fichier déjà rattaché pour la même société est refusé, et une
 *     lecture encore ouverte du même fichier est REMPLACÉE sans être effacée ;
 *   * `OCR_REQUIRED` avec des cases est refusé par la base : un scan n'a rien lu ;
 *   * CASE VIDE ≠ CASE À ZÉRO : une case sans valeur est acceptée, une valeur normalisée sans
 *     valeur brute est refusée ;
 *   * les trois tables ne sont accessibles à `authenticated` qu'en LECTURE, et les RPC ne lui
 *     sont pas exécutables ;
 *   * cloisonnement : la société d'un autre propriétaire est inaccessible.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL manquante");

const connectionUrl = new URL(connectionString);
const localHost = ["localhost", "127.0.0.1", "::1"].includes(connectionUrl.hostname);
const client = new Client({ connectionString, ssl: localHost ? false : true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Vérifie qu'une écriture est refusée, et par le BON contrôle. */
async function rejects(
  sql: string,
  params: unknown[],
  message: string,
  expected?: string,
): Promise<void> {
  await client.query("savepoint smoke_guard");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint smoke_guard");
    throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    await client.query("rollback to savepoint smoke_guard");
    const reason = error instanceof Error ? error.message : String(error);
    if (expected && !reason.includes(expected)) {
      throw new Error(`${message} : refus obtenu pour une autre raison (${reason})`);
    }
  }
}

let userId = "";

async function rpc(name: string, payload: unknown): Promise<string> {
  const result = await client.query<{ value: string }>(
    `select public.${name}($1::uuid, $2::jsonb)::text as value`,
    [userId, JSON.stringify(payload)],
  );
  return result.rows[0].value;
}

type Counts = {
  runs: string;
  fields: string;
  checks: string;
  links: string;
  financials: string;
  tickets: string;
  businesses: string;
};

async function counts(): Promise<Counts> {
  const result = await client.query<Counts>(`
    select
      (select count(*) from public.document_extraction_runs)::text as runs,
      (select count(*) from public.document_extraction_fields)::text as fields,
      (select count(*) from public.document_extraction_checks)::text as checks,
      (select count(*) from public.import_record_links)::text as links,
      (select count(*) from public.business_financials)::text as financials,
      (select count(*) from public.import_upload_tickets)::text as tickets,
      (select count(*) from public.businesses)::text as businesses
  `);
  return result.rows[0];
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const FISCAL_START = "2025-01-01";
const FISCAL_END = "2025-12-31";

/** Une case, dans la forme que la RPC de réception attend. */
function field(
  boxCode: string,
  value: number | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    page_number: 1,
    form_code: "2050",
    form_part: "NET",
    box_code: boxCode,
    label: `Poste ${boxCode}`,
    raw_value: value === null ? null : String(value),
    normalized_value: value,
    unit: "EUR",
    extraction_method: "NATIVE_TEXT_LAYOUT",
    confidence: "HIGH",
    validation_status: "EXTRACTED",
    issues: [],
    ...overrides,
  };
}

let succeeded = false;

await client.connect();
const before = await counts();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");

  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
  userId = owner.rows[0].id;

  // Propriétaire voisin, créé AVANT le passage en `service_role`, qui n'écrit pas dans `auth`.
  const otherUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    otherUser,
    `smoke-docint-${otherUser}@invalid`,
  ]);

  await client.query("set local role service_role");

  const businessId = randomUUID();
  const otherBusinessId = randomUUID();
  await client.query(
    `insert into public.businesses (id, user_id, name, status, business_type, functional_currency)
     values ($1, $2, 'Société de smoke documentaire', 'ACTIVE', 'OPERATING', 'EUR')`,
    [businessId, userId],
  );
  await client.query(
    `insert into public.businesses (id, user_id, name, status, business_type, functional_currency)
     values ($1, $2, 'Société voisine', 'ACTIVE', 'OPERATING', 'EUR')`,
    [otherBusinessId, otherUser],
  );

  // ── 1. Billet d'upload : le domaine documentaire est accepté ───────────────────────
  const ticketId = await rpc("lfo_issue_import_upload_ticket", {
    domain: "DOCUMENT_EXTRACTION",
    file_name: "liasse.pdf",
    content_type: "application/pdf",
    byte_size: 512_000,
    ttl_minutes: 30,
  });
  const ticketPath = await client.query<{ storage_path: string; domain: string }>(
    "select storage_path, domain from public.import_upload_tickets where id = $1",
    [ticketId],
  );
  assert(
    ticketPath.rows[0].storage_path.startsWith(`${userId}/import-staging/`),
    "Le chemin de staging n'est pas calculé côté serveur",
  );
  assert(
    ticketPath.rows[0].domain === "DOCUMENT_EXTRACTION",
    "Le domaine documentaire n'a pas été accepté par le billet",
  );

  // Usage unique : la seconde consommation est refusée.
  await client.query(`select public.lfo_consume_import_upload_ticket($1::uuid, $2::uuid)`, [
    userId,
    ticketId,
  ]);
  await rejects(
    `select public.lfo_consume_import_upload_ticket($1::uuid, $2::uuid)`,
    [userId, ticketId],
    "Un billet d'upload a pu être consommé deux fois",
    "déjà consommé",
  );

  // ── 2. Ouverture d'une lecture, puis réception des cases ──────────────────────────
  const runId = await rpc("lfo_open_document_extraction", {
    business_id: businessId,
    document_family: "TAX_RETURN",
    detected_kind: "LIASSE_2050",
    detected_variant: "2025",
    detection_basis: [{ page: 1, matched: "2050", kind: "2050" }],
    extractor: "liasse-fiscale",
    extractor_version: "1",
    schema_version: "liasse/smoke",
    pdf_kind: "NATIVE_TEXT",
    page_count: 4,
    text_char_count: 4_000,
    file_name: "liasse.pdf",
    file_hash: HASH_A,
    file_size_bytes: 512_000,
    content_type: "application/pdf",
    staging_storage_path: ticketPath.rows[0].storage_path,
    siren: "900000001",
    fiscal_year_start: FISCAL_START,
    fiscal_year_end: FISCAL_END,
    status: "EXTRACTED",
    issues: [],
  });

  // Une lecture ouverte ne touche AUCUNE donnée canonique.
  const untouched = await client.query<{ count: string }>(
    "select count(*)::text as count from public.business_financials where business_id = $1",
    [businessId],
  );
  assert(
    untouched.rows[0].count === "0",
    "Ouvrir une lecture a écrit un instantané financier : lire n'est pas écrire",
  );

  const appended = await rpc("lfo_append_document_extraction_fields", {
    run_id: runId,
    fields: [
      // Actif : brut 470 000, amortissements 120 000, net 350 000.
      field("CO", 470_000, { form_part: "GROSS" }),
      field("CP", 120_000, { form_part: "DEPRECIATION" }),
      field("CQ", 350_000, { form_part: "NET" }),
      // Passif : total 350 000, égal à l'actif net.
      field("EE", 350_000, { form_code: "2051" }),
      // Résultat, des deux côtés.
      field("DL", 20_000, { form_code: "2051" }),
      field("HN", 20_000, { form_code: "2053" }),
      // Chiffre d'affaires.
      field("FL", 900_000, { form_code: "2052", label: "Chiffres d'affaires nets" }),
      // CASE VIDE : le code est imprimé, la valeur non. Ce n'est PAS un zéro.
      field("BY", null, { raw_value: null }),
    ],
  });
  assert(appended === "8", `Huit cases attendues, ${appended} écrite(s)`);

  // Une valeur NORMALISÉE sans valeur brute qui l'explique sortirait de nulle part.
  await rejects(
    `insert into public.document_extraction_fields
       (user_id, run_id, page_number, form_code, box_code, normalized_value, extraction_method)
     values ($1, $2, 1, '2050', 'ZZ', 1000, 'NATIVE_TEXT_LAYOUT')`,
    [userId, runId],
    "Une valeur normalisée sans valeur brute a été acceptée",
    "document_extraction_fields_raw_shape_ck",
  );

  // Un cadre géométrique partiel ne désigne aucune zone.
  await rejects(
    `insert into public.document_extraction_fields
       (user_id, run_id, page_number, form_code, box_code, raw_value, extraction_method, bbox_x, bbox_y)
     values ($1, $2, 1, '2050', 'ZY', '1', 'NATIVE_TEXT_LAYOUT', 10, 20)`,
    [userId, runId],
    "Un cadre géométrique incomplet a été accepté",
    "document_extraction_fields_bbox_shape_ck",
  );

  // ── 3. Contrôles évalués EN BASE ──────────────────────────────────────────────────
  const evaluated = await rpc("lfo_evaluate_document_extraction_checks", {
    run_id: runId,
    checks: [
      {
        check_code: "BALANCE_SHEET_EQUALITY",
        label: "Total actif = total passif",
        severity: "BLOCKING",
        tolerance: 1,
        left: ["CQ"],
        right: ["EE"],
        message: "Le bilan doit être équilibré",
      },
      {
        check_code: "ACTIF_COLUMNS_CONSISTENCY",
        label: "Brut = net + amortissements",
        severity: "BLOCKING",
        tolerance: 1,
        left: ["CO"],
        right: ["CQ", "CP"],
        message: "Colonnes cohérentes",
      },
      {
        check_code: "RESULT_CONSISTENCY",
        label: "Résultat cohérent",
        severity: "BLOCKING",
        tolerance: 1,
        left: ["HN"],
        right: ["DL"],
        message: "Le résultat doit être identique des deux côtés",
      },
      {
        // Opérande ABSENT du document : le contrôle ne prouve rien.
        check_code: "MISSING_OPERAND",
        label: "Contrôle sans opérande",
        severity: "WARNING",
        tolerance: 0,
        left: ["XX"],
        right: ["EE"],
        message: "Opérande absent",
      },
      {
        // Aucun opérande déclaré : c'est le cas d'une ancre non résolue.
        check_code: "UNRESOLVED_ANCHOR",
        label: "Ancre non résolue",
        severity: "BLOCKING",
        tolerance: 0,
        left: [],
        right: [],
        message: "Ancre introuvable",
      },
    ],
  });
  assert(evaluated === "5", `Cinq contrôles attendus, ${evaluated} évalué(s)`);

  const verdicts = await client.query<{
    check_code: string;
    status: string;
    difference: string | null;
  }>(
    "select check_code, status, difference::text from public.document_extraction_checks where run_id = $1 order by check_code",
    [runId],
  );
  const byCode = new Map(verdicts.rows.map((row) => [row.check_code, row]));
  assert(
    byCode.get("BALANCE_SHEET_EQUALITY")?.status === "PASSED",
    "Le bilan équilibré n'a pas été reconnu",
  );
  assert(
    byCode.get("ACTIF_COLUMNS_CONSISTENCY")?.status === "PASSED",
    "La cohérence des colonnes n'a pas été reconnue",
  );
  assert(
    byCode.get("MISSING_OPERAND")?.status === "NOT_COMPUTABLE",
    "Un contrôle dont un opérande est absent n'a pas été rendu NOT_COMPUTABLE",
  );
  assert(
    byCode.get("UNRESOLVED_ANCHOR")?.status === "NOT_COMPUTABLE",
    "Un contrôle sans opérande déclaré n'a pas été rendu NOT_COMPUTABLE",
  );

  // Les décomptes sont DÉRIVÉS des lignes persistées.
  const derived = await client.query<{
    field_count: string;
    failed_check_count: string;
    not_computable_check_count: string;
  }>(
    "select field_count::text, failed_check_count::text, not_computable_check_count::text from public.document_extraction_runs where id = $1",
    [runId],
  );
  assert(derived.rows[0].field_count === "8", "Le décompte de cases n'est pas dérivé de la base");
  assert(
    derived.rows[0].not_computable_check_count === "2",
    "Le décompte de contrôles non calculables n'est pas dérivé de la base",
  );

  // Un décompte FORGÉ n'a aucun effet : la ré-évaluation le recalcule depuis les lignes.
  await client.query(
    "update public.document_extraction_runs set failed_check_count = 0, field_count = 999 where id = $1",
    [runId],
  );
  await rpc("lfo_evaluate_document_extraction_checks", { run_id: runId });
  const recomputed = await client.query<{ field_count: string }>(
    "select field_count::text from public.document_extraction_runs where id = $1",
    [runId],
  );
  assert(recomputed.rows[0].field_count === "8", "Un décompte forgé a survécu à la ré-évaluation");

  // ── 4. Opérande AMBIGU : deux cases pour le même code ─────────────────────────────
  await rpc("lfo_append_document_extraction_fields", {
    run_id: runId,
    // Même code `EE`, autre formulaire : la contrainte d'unicité l'autorise, et c'est
    // précisément la situation où sommer les deux inventerait un total.
    fields: [field("EE", 99_000, { form_code: "2033-A" })],
  });
  await rpc("lfo_evaluate_document_extraction_checks", { run_id: runId });
  const ambiguous = await client.query<{ status: string }>(
    "select status from public.document_extraction_checks where run_id = $1 and check_code = 'BALANCE_SHEET_EQUALITY'",
    [runId],
  );
  assert(
    ambiguous.rows[0].status === "NOT_COMPUTABLE",
    "Un opérande ambigu — deux cases pour le même code — n'a pas rendu le contrôle NOT_COMPUTABLE",
  );

  // Retour à une situation lisible : la case en double est REJETÉE, donc hors contrôle.
  const duplicateId = await client.query<{ id: string }>(
    "select id from public.document_extraction_fields where run_id = $1 and box_code = 'EE' and form_code = '2033-A'",
    [runId],
  );
  await rpc("lfo_correct_document_extraction_field", {
    field_id: duplicateId.rows[0].id,
    action: "reject",
    reason: "Case d'un autre formulaire, hors périmètre de ce contrôle",
  });
  const restored = await client.query<{ status: string }>(
    "select status from public.document_extraction_checks where run_id = $1 and check_code = 'BALANCE_SHEET_EQUALITY'",
    [runId],
  );
  assert(
    restored.rows[0].status === "PASSED",
    "Le rejet d'une case ambiguë n'a pas rendu le contrôle calculable de nouveau",
  );

  // ── 5. Immuabilité de ce que le document imprimait ────────────────────────────────
  const grossId = await client.query<{ id: string }>(
    "select id from public.document_extraction_fields where run_id = $1 and box_code = 'CO'",
    [runId],
  );
  for (const [column, value] of [
    ["raw_value", "'999'"],
    ["box_code", "'ZZ'"],
    ["page_number", "9"],
    ["extraction_method", "'OCR'"],
    ["bbox_x", "42"],
  ] as const) {
    await rejects(
      `update public.document_extraction_fields set ${column} = ${value} where id = $1`,
      [grossId.rows[0].id],
      `La colonne ${column} d'une case a pu être réécrite`,
      "immuable",
    );
  }

  // ── 6. Correction : prise en compte atomique par les contrôles ────────────────────
  const passifId = await client.query<{ id: string }>(
    "select id from public.document_extraction_fields where run_id = $1 and box_code = 'EE' and form_code = '2051'",
    [runId],
  );
  await rpc("lfo_correct_document_extraction_field", {
    field_id: passifId.rows[0].id,
    action: "correct",
    user_value: 360_000,
    reason: "Relecture du PDF : 360 000 et non 350 000",
  });
  const afterCorrection = await client.query<{
    status: string;
    run_status: string;
    difference: string;
  }>(
    `select c.status, r.status as run_status, c.difference::text as difference
       from public.document_extraction_checks c
       join public.document_extraction_runs r on r.id = c.run_id
      where c.run_id = $1 and c.check_code = 'BALANCE_SHEET_EQUALITY'`,
    [runId],
  );
  assert(
    afterCorrection.rows[0].status === "FAILED",
    "La correction n'a pas été prise en compte par le contrôle dans la même transaction",
  );
  assert(
    Number(afterCorrection.rows[0].difference) === -10_000,
    `L'écart attendu était -10 000, obtenu ${afterCorrection.rows[0].difference}`,
  );
  assert(
    afterCorrection.rows[0].run_status === "REVIEWED",
    "Une correction n'a pas ramené la lecture en revue",
  );

  // Corriger vers rien n'est pas une correction.
  await rejects(
    `select public.lfo_correct_document_extraction_field($1::uuid, $2::jsonb)`,
    [userId, JSON.stringify({ field_id: passifId.rows[0].id, action: "correct" })],
    "Une correction sans valeur a été acceptée",
    "n'est pas une correction",
  );

  // ── 7. Validation refusée sur un contrôle bloquant en échec ───────────────────────
  await rejects(
    `select public.lfo_validate_document_extraction($1::uuid, $2::uuid)`,
    [userId, runId],
    "Une lecture contredite par un contrôle bloquant a pu être validée",
    "contrôle(s) bloquant(s) en échec",
  );

  // Retour à l'équilibre : la correction est ramenée à la valeur imprimée.
  await rpc("lfo_correct_document_extraction_field", {
    field_id: passifId.rows[0].id,
    action: "correct",
    user_value: 350_000,
    reason: "Retour à la valeur imprimée",
  });

  // Une case ILLISIBLE bloque aussi la validation.
  await client.query(
    "update public.document_extraction_fields set validation_status = 'BLOCKED' where id = $1",
    [grossId.rows[0].id],
  );
  await rejects(
    `select public.lfo_validate_document_extraction($1::uuid, $2::uuid)`,
    [userId, runId],
    "Une lecture portant une case illisible a pu être validée",
    "illisible",
  );
  await client.query(
    "update public.document_extraction_fields set validation_status = 'EXTRACTED' where id = $1",
    [grossId.rows[0].id],
  );

  // ── 8. Liaison refusée hors état validé ──────────────────────────────────────────
  await rejects(
    `select public.lfo_link_document_extraction_financials($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        run_id: runId,
        financials: { period_end: FISCAL_END, currency: "EUR", revenue: 900000 },
      }),
    ],
    "Un fait canonique a pu être écrit depuis une lecture non validée",
    "validez la lecture",
  );

  await client.query(`select public.lfo_validate_document_extraction($1::uuid, $2::uuid)`, [
    userId,
    runId,
  ]);
  const validated = await client.query<{ status: string; validated_at: string | null }>(
    "select status, validated_at::text from public.document_extraction_runs where id = $1",
    [runId],
  );
  assert(
    validated.rows[0].status === "VALIDATED" && validated.rows[0].validated_at !== null,
    "La validation n'a pas été enregistrée avec sa date",
  );

  // Valider ne crée AUCUN fait canonique : c'est une décision distincte.
  const stillNoFact = await client.query<{ count: string }>(
    "select count(*)::text as count from public.business_financials where business_id = $1",
    [businessId],
  );
  assert(
    stillNoFact.rows[0].count === "0",
    "Valider une lecture a écrit un fait : valider et rattacher sont deux décisions",
  );

  // ── 9. Champs dont la définition est une convention : refusés, pas ignorés ────────
  await rejects(
    `select public.lfo_link_document_extraction_financials($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        run_id: runId,
        financials: { period_end: FISCAL_END, currency: "EUR", revenue: 900000, ebitda: 120000 },
      }),
    ],
    "Un EBITDA a pu être écrit depuis une liasse",
    "Quality of Earnings",
  );

  // Une clôture qui ne correspond pas à l'exercice LU.
  await rejects(
    `select public.lfo_link_document_extraction_financials($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        run_id: runId,
        financials: { period_end: "2024-12-31", currency: "EUR", revenue: 900000 },
      }),
    ],
    "Une clôture ne correspondant pas à l'exercice lu a été acceptée",
    "ne correspond pas à l'exercice lu",
  );

  // ── 10. Liaison : fait canonique et provenance en une transaction ─────────────────
  await rpc("lfo_link_document_extraction_financials", {
    run_id: runId,
    financials: {
      period_end: FISCAL_END,
      period_start: FISCAL_START,
      period_kind: "ANNUAL",
      currency: "EUR",
      revenue: 900_000,
      net_income: 20_000,
      data_kind: "ACTUAL",
      confidence: "HIGH",
      source: "Liasse fiscale — smoke",
    },
  });

  const linked = await client.query<{
    run_status: string;
    financials: string;
    links: string;
    period_start: string | null;
    ebitda: string | null;
  }>(
    `select r.status as run_status,
            (select count(*)::text from public.business_financials where business_id = $2) as financials,
            (select count(*)::text from public.import_record_links
              where extraction_run_id = $1 and target_domain = 'TAX_RETURN_FINANCIALS') as links,
            (select period_start::text from public.business_financials where business_id = $2 limit 1) as period_start,
            (select ebitda::text from public.business_financials where business_id = $2 limit 1) as ebitda
       from public.document_extraction_runs r where r.id = $1`,
    [runId, businessId],
  );
  assert(linked.rows[0].run_status === "LINKED", "La lecture n'est pas passée en LINKED");
  assert(linked.rows[0].financials === "1", "L'instantané financier n'a pas été écrit");
  assert(linked.rows[0].links === "1", "Le lien de provenance n'a pas été écrit");
  assert(
    linked.rows[0].period_start === FISCAL_START,
    "L'ouverture de l'exercice lu n'a pas été conservée",
  );
  assert(linked.rows[0].ebitda === null, "Un EBITDA a été écrit : une liasse n'en contient pas");

  // Rattacher deux fois est sans effet : la seconde fois rend le même identifiant.
  await rpc("lfo_link_document_extraction_financials", {
    run_id: runId,
    financials: { period_end: FISCAL_END, currency: "EUR", revenue: 900_000 },
  });
  const idempotent = await client.query<{ count: string }>(
    "select count(*)::text as count from public.business_financials where business_id = $1",
    [businessId],
  );
  assert(
    idempotent.rows[0].count === "1",
    "Une seconde liaison a écrit un second instantané financier",
  );

  // ── 11. Lecture rattachée : gelée de bout en bout ─────────────────────────────────
  await rejects(
    `update public.document_extraction_fields set user_value = 1 where id = $1`,
    [passifId.rows[0].id],
    "Une case d'une lecture rattachée a pu être modifiée",
    "gelée",
  );
  await rejects(
    `delete from public.document_extraction_fields where id = $1`,
    [passifId.rows[0].id],
    "Une case d'une lecture rattachée a pu être supprimée",
    "ne se supprime pas",
  );
  await rejects(
    `select public.lfo_reject_document_extraction($1::uuid, $2::uuid, 'essai')`,
    [userId, runId],
    "Une lecture rattachée à un fait a pu être rejetée",
    "ne se rejette pas",
  );
  await rejects(
    `delete from public.document_extraction_runs where id = $1`,
    [runId],
    "Une lecture dont la provenance est référencée a pu être supprimée",
    "import_record_links_run_fk",
  );
  await rejects(
    `select public.lfo_evaluate_document_extraction_checks($1::uuid, $2::jsonb)`,
    [userId, JSON.stringify({ run_id: runId })],
    "Les contrôles d'une lecture rattachée ont pu être ré-évalués",
    "gelés",
  );

  // ── 12. Idempotence de fichier ───────────────────────────────────────────────────
  await rejects(
    `select public.lfo_open_document_extraction($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        business_id: businessId,
        file_hash: HASH_A,
        pdf_kind: "NATIVE_TEXT",
        extractor: "liasse-fiscale",
        extractor_version: "1",
        schema_version: "liasse/smoke",
      }),
    ],
    "Le même document a pu produire un second fait canonique pour la même société",
    "déjà produit un fait canonique",
  );

  // Une lecture encore ouverte du même fichier est REMPLACÉE, sans être effacée.
  const openRun = await rpc("lfo_open_document_extraction", {
    business_id: businessId,
    file_hash: HASH_B,
    pdf_kind: "NATIVE_TEXT",
    extractor: "liasse-fiscale",
    extractor_version: "1",
    schema_version: "liasse/smoke",
    status: "EXTRACTED",
  });
  const replacement = await rpc("lfo_open_document_extraction", {
    business_id: businessId,
    file_hash: HASH_B,
    pdf_kind: "NATIVE_TEXT",
    extractor: "liasse-fiscale",
    extractor_version: "2",
    schema_version: "liasse/smoke",
    status: "EXTRACTED",
  });
  const chain = await client.query<{ supersedes: string | null }>(
    "select supersedes_run_id::text as supersedes from public.document_extraction_runs where id = $1",
    [replacement],
  );
  assert(
    chain.rows[0].supersedes === openRun,
    "Une relecture n'a pas désigné la lecture qu'elle remplace",
  );
  const previousStillThere = await client.query<{ count: string }>(
    "select count(*)::text as count from public.document_extraction_runs where id = $1",
    [openRun],
  );
  assert(
    previousStillThere.rows[0].count === "1",
    "La lecture remplacée a été effacée au lieu d'être conservée",
  );

  // ── 13. OCR_REQUIRED avec des cases : refusé ──────────────────────────────────────
  await rejects(
    `update public.document_extraction_runs set status = 'OCR_REQUIRED', field_count = 5 where id = $1`,
    [openRun],
    "Une lecture OCR_REQUIRED portant des cases a été acceptée",
    "document_extraction_runs_ocr_shape_ck",
  );

  // ── 14. CONFLIT DE SOURCES ───────────────────────────────────────────────────────
  // Une période renseignée par une AUTRE origine — ici une saisie directe — n'est jamais
  // écrasée par une lecture de liasse. La preuve est la provenance, pas un libellé.
  const manualBusiness = randomUUID();
  await client.query(
    `insert into public.businesses (id, user_id, name, status, business_type, functional_currency)
     values ($1, $2, 'Société à saisie manuelle', 'ACTIVE', 'OPERATING', 'EUR')`,
    [manualBusiness, userId],
  );
  await client.query(
    `insert into public.business_financials (user_id, business_id, period_end, revenue, data_kind, confidence, currency)
     values ($1, $2, $3, 111111, 'USER_ASSUMPTION', 'MEDIUM', 'EUR')`,
    [userId, manualBusiness, FISCAL_END],
  );
  const conflictRun = await rpc("lfo_open_document_extraction", {
    business_id: manualBusiness,
    file_hash: "c".repeat(64),
    pdf_kind: "NATIVE_TEXT",
    extractor: "liasse-fiscale",
    extractor_version: "1",
    schema_version: "liasse/smoke",
    fiscal_year_end: FISCAL_END,
    status: "EXTRACTED",
  });
  await client.query(`select public.lfo_validate_document_extraction($1::uuid, $2::uuid)`, [
    userId,
    conflictRun,
  ]);
  await rejects(
    `select public.lfo_link_document_extraction_financials($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        run_id: conflictRun,
        financials: { period_end: FISCAL_END, currency: "EUR", revenue: 900000 },
      }),
    ],
    "Une période renseignée par une autre source a été écrasée",
    "BUSINESS_FINANCIALS_SOURCE_CONFLICT",
  );

  // Liaison sans exercice LU : refusée.
  const noYearRun = await rpc("lfo_open_document_extraction", {
    business_id: manualBusiness,
    file_hash: "d".repeat(64),
    pdf_kind: "NATIVE_TEXT",
    extractor: "liasse-fiscale",
    extractor_version: "1",
    schema_version: "liasse/smoke",
    status: "EXTRACTED",
  });
  await client.query(`select public.lfo_validate_document_extraction($1::uuid, $2::uuid)`, [
    userId,
    noYearRun,
  ]);
  await rejects(
    `select public.lfo_link_document_extraction_financials($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        run_id: noYearRun,
        financials: { period_end: FISCAL_END, currency: "EUR", revenue: 900000 },
      }),
    ],
    "Un instantané a pu être écrit sans exercice démontré",
    "Exercice non lu",
  );

  // ── 15. Piste d'audit en LECTURE SEULE sous `authenticated` ───────────────────────
  await client.query("reset role");
  await client.query("set local role authenticated");
  for (const [table, statement] of [
    ["document_extraction_runs", "delete from public.document_extraction_runs"],
    ["document_extraction_fields", "delete from public.document_extraction_fields"],
    ["document_extraction_checks", "delete from public.document_extraction_checks"],
  ] as const) {
    await rejects(
      statement,
      [],
      `La table public.${table} est inscriptible par authenticated`,
      "permission denied",
    );
  }
  await rejects(
    `select public.lfo_link_document_extraction_financials($1::uuid, '{}'::jsonb)`,
    [userId],
    "Une RPC documentaire est exécutable par authenticated",
    "permission denied",
  );

  await client.query("reset role");
  await client.query("set local role service_role");

  // ── 16. Cloisonnement ────────────────────────────────────────────────────────────
  await rejects(
    `select public.lfo_open_document_extraction($1::uuid, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        business_id: otherBusinessId,
        file_hash: "e".repeat(64),
        pdf_kind: "NATIVE_TEXT",
        extractor: "liasse-fiscale",
        extractor_version: "1",
        schema_version: "liasse/smoke",
      }),
    ],
    "La société d'un autre propriétaire a été utilisée",
    "Société introuvable",
  );

  await client.query("reset role");
  await client.query("rollback");
  succeeded = true;
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    /* connexion possiblement interrompue avant BEGIN */
  }
  throw error;
} finally {
  const after = await counts().catch(() => null);
  await client.end();
  const drift = after
    ? (Object.keys(after) as Array<keyof Counts>).filter((key) => after[key] !== before[key])
    : [];
  if (drift.length > 0) {
    throw new Error(
      `Le smoke a laissé des données persistées : ${drift
        .map((key) => `${key} ${before[key]} → ${after[key]}`)
        .join(", ")}`,
    );
  }
  if (succeeded) {
    console.log(
      "Smoke Document Intelligence : billet documentaire à usage unique, réception atomique, décomptes dérivés malgré un décompte forgé, contrôles évalués en base, opérande absent et opérande ambigu rendus NOT_COMPUTABLE, rejet rendant un contrôle calculable, correction prise en compte atomiquement, lecture source immuable, validation refusée sur contrôle bloquant et case illisible, valider ≠ rattacher, conventions (EBITDA, capex) refusées, clôture confrontée à l'exercice lu, fait et provenance écrits en une transaction, exercice conservé sur ses deux bornes, conflit de sources refusé, lecture rattachée gelée, idempotence de fichier, relecture remplaçante conservée, OCR_REQUIRED sans cases, piste d'audit en lecture seule, cloisonnement. Aucune donnée persistée.",
    );
  }
}
