/**
 * Smoke transactionnel de B19 : revue des candidats d'un échéancier de dette
 * (`20261012140000_document_schedule_review`). Toutes les écritures sont annulées.
 *
 * Ce que le smoke prouve :
 *
 *   * une lecture d'échéancier vise une DETTE (jamais une société, jamais les deux), porte son
 *     format tabulaire (`NOT_PDF`) et sa localisation de case (ligne, colonne, cellule) ;
 *   * les contrôles sont CALCULÉS EN BASE sur les cases persistées : réussi, échoué, et non
 *     calculable quand un opérande est vide ;
 *   * une décision transmet la révision qu'elle a lue ; une révision périmée échoue en LF409 ;
 *     la piste des décisions garde avant, après, motif, acteur établi par le serveur et rôle
 *     constaté ; elle est immuable et non supprimable tant que la lecture existe ;
 *   * clé d'acteur et clé inconnue refusées ; correction de date par `user_date`, de montant
 *     par `user_value` (ni NaN ni notation exponentielle) ; une case de texte ne se corrige pas ;
 *   * la validation exige une devise, aucune date en double, des dates croissantes, aucun
 *     contrôle bloquant en échec ; elle n'écrit AUCUNE ligne de `loan_schedules` ;
 *   * le même fichier ne se valide qu'une fois par dette ; une lecture ouverte du même contenu
 *     est remplacée et l'ancienne reste consultable ;
 *   * `authenticated` lit seulement, et la dette d'un autre propriétaire est inaccessible ;
 *   * supprimer la lecture emporte ses décisions, sans laisser d'orphelin.
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

async function rejects(sql: string, params: unknown[], message: string, expected: string) {
  await client.query("savepoint smoke_guard");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint smoke_guard");
    throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    await client.query("rollback to savepoint smoke_guard");
    const reason = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code ?? "";
    if (!reason.includes(expected) && code !== expected)
      throw new Error(`${message} : refus obtenu pour une autre raison (${code} ${reason})`);
  }
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

let succeeded = false;
await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '60s'");
  const owner = await client.query<{ id: string }>(
    "select id from auth.users order by created_at asc limit 1",
  );
  assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
  const userId = owner.rows[0].id;
  const otherUser = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    otherUser,
    `smoke-schedule-${otherUser}@invalid`,
  ]);
  await client.query("set local role service_role");

  const rpc = async (name: string, payload: unknown, user = userId) =>
    (
      await client.query<{ value: string }>(
        `select public.${name}($1::uuid, $2::jsonb)::text as value`,
        [user, JSON.stringify(payload)],
      )
    ).rows[0]!.value;

  const debt = await rpc("lfo_record_outstanding_debt", {
    name: "Prêt échéancier smoke",
    lender: null,
    balance: "2000",
    currency: "EUR",
    observed_at: "2026-09-20",
    notes: null,
  });
  const otherDebt = await rpc(
    "lfo_record_outstanding_debt",
    {
      name: "Prêt d'un autre propriétaire",
      lender: null,
      balance: "10",
      currency: "EUR",
      observed_at: "2026-09-20",
      notes: null,
    },
    otherUser,
  );
  const schedulesBefore = await client.query<{ count: string }>(
    "select count(*)::text as count from public.loan_schedules where user_id = $1",
    [userId],
  );

  const open = (overrides: Record<string, unknown> = {}) => ({
    liability_id: debt,
    status: "EXTRACTED",
    source_format: "CSV",
    sheet_name: null,
    file_name: "echeancier.csv",
    file_hash: HASH_A,
    file_size_bytes: 210,
    content_type: "text/csv",
    document_id: null,
    extractor: "lfo-schedule-tabular",
    extractor_version: "1.0.0",
    schema_version: "schedule-columns-v1",
    currency: "EUR",
    currency_source: "DECLARED",
    line_count: 2,
    first_due_date: "2026-10-05",
    last_due_date: "2026-11-05",
    completeness: "PARTIAL",
    completeness_reasons: ["Capital initial du contrat non déclaré."],
    issues: [],
    error: null,
    ...overrides,
  });
  const openSql = "select public.lfo_open_schedule_extraction($1::uuid, $2::jsonb)";

  // ── 1. Ouverture : cible, charge stricte, cloisonnement ────────────────────────────
  await rejects(
    openSql,
    [userId, JSON.stringify(open({ actor_user_id: userId }))],
    "Une clé d'acteur a été acceptée à l'ouverture",
    "LF422",
  );
  await rejects(
    openSql,
    [userId, JSON.stringify(open({ business_id: randomUUID() }))],
    "Une clé inconnue a été acceptée à l'ouverture",
    "LF422",
  );
  await rejects(
    openSql,
    [userId, JSON.stringify(open({ liability_id: otherDebt }))],
    "La dette d'un autre propriétaire a reçu une lecture",
    "LF404",
  );
  await rejects(
    openSql,
    [userId, JSON.stringify(open({ source_format: "PDF" }))],
    "Un échéancier tabulaire a été déclaré PDF",
    "document_extraction_runs_pdf_kind_v2_ck",
  );
  const runId = await rpc("lfo_open_schedule_extraction", open());
  const run = await client.query<{ pdf_kind: string; business_id: string | null }>(
    "select pdf_kind, business_id from public.document_extraction_runs where id = $1",
    [runId],
  );
  assert(
    run.rows[0]!.pdf_kind === "NOT_PDF" && run.rows[0]!.business_id === null,
    "La lecture n'est pas tabulaire ou vise une société",
  );

  // ── 2. Cases localisées ───────────────────────────────────────────────────────────
  const money = (line: number, key: string, letter: string, raw: string | null) => ({
    box_code: `L${line}.${key}`,
    row_number: line + 1,
    column_key: key,
    column_label: key,
    cell_ref: `${letter}${line + 1}`,
    raw_value: raw,
    normalized_value: raw,
    unit: "MONEY",
    extraction_method: "TABULAR_CELL",
    validation_status: "EXTRACTED",
  });
  const date = (line: number, raw: string) => ({
    box_code: `L${line}.date`,
    row_number: line + 1,
    column_key: "date",
    column_label: "date",
    cell_ref: `A${line + 1}`,
    raw_value: raw,
    normalized_date: raw,
    unit: "DATE",
    extraction_method: "TABULAR_CELL",
    validation_status: "EXTRACTED",
  });
  const fields = [
    date(1, "2026-10-05"),
    money(1, "opening", "B", "2000"),
    money(1, "principal", "C", "1000"),
    money(1, "closing", "D", "1000"),
    date(2, "2026-11-05"),
    money(2, "opening", "B", "1000"),
    money(2, "principal", "C", "900"),
    money(2, "closing", "D", null),
    {
      box_code: "L1.colE",
      row_number: 2,
      column_key: "colE",
      column_label: "commentaire",
      cell_ref: "E2",
      raw_value: "texte",
      unit: "TEXT",
      extraction_method: "TABULAR_CELL",
      validation_status: "UNKNOWN_BOX",
    },
  ];
  const appended = await rpc("lfo_append_document_extraction_fields", { run_id: runId, fields });
  assert(Number(appended) === fields.length, "Toutes les cases n'ont pas été reçues");
  await rejects(
    "select public.lfo_append_document_extraction_fields($1::uuid, $2::jsonb)",
    [
      userId,
      JSON.stringify({ run_id: runId, fields: [{ ...money(3, "x", "B", "1"), row_number: null }] }),
    ],
    "Une case sans page ni ligne a été acceptée",
    "document_extraction_fields_location_ck",
  );

  // ── 3. Contrôles calculés EN BASE ────────────────────────────────────────────────
  await rpc("lfo_evaluate_document_extraction_checks", {
    run_id: runId,
    checks: [
      {
        check_code: "ROW_BALANCE:1",
        severity: "BLOCKING",
        tolerance: 0,
        left: ["L1.opening"],
        right: ["L1.principal", "L1.closing"],
      },
      {
        check_code: "ROW_BALANCE:2",
        severity: "BLOCKING",
        tolerance: 0,
        left: ["L2.opening"],
        right: ["L2.principal", "L2.closing"],
      },
      {
        check_code: "CHAIN:1",
        severity: "BLOCKING",
        tolerance: 0,
        left: ["L1.closing"],
        right: ["L2.opening"],
      },
    ],
  });
  const statusOf = async (code: string) =>
    (
      await client.query<{ status: string }>(
        "select status from public.document_extraction_checks where run_id = $1 and check_code = $2",
        [runId, code],
      )
    ).rows[0]!.status;
  assert((await statusOf("ROW_BALANCE:1")) === "PASSED", "Ligne 1 cohérente non reconnue");
  assert((await statusOf("CHAIN:1")) === "PASSED", "Chaînage cohérent non reconnu");
  assert(
    (await statusOf("ROW_BALANCE:2")) === "NOT_COMPUTABLE",
    "Une clôture VIDE n'a pas rendu le contrôle non calculable (elle aurait valu zéro)",
  );

  // ── 4. Décisions : révision, piste, conflit ─────────────────────────────────────
  const fieldId = async (code: string) =>
    (
      await client.query<{ id: string; revision: number }>(
        "select id, decision_revision as revision from public.document_extraction_fields where run_id = $1 and box_code = $2",
        [runId, code],
      )
    ).rows[0]!;
  const closing2 = await fieldId("L2.closing");
  const correctSql = "select public.lfo_correct_document_extraction_field($1::uuid, $2::jsonb)";
  const decide = (payload: Record<string, unknown>) => [userId, JSON.stringify(payload)];
  await rejects(
    correctSql,
    decide({ field_id: closing2.id, action: "correct", user_value: "100" }),
    "Une décision sans révision attendue a été acceptée",
    "LF422",
  );
  await rejects(
    correctSql,
    decide({
      field_id: closing2.id,
      action: "correct",
      user_value: "100",
      expected_revision: 0,
      actor_user_id: userId,
    }),
    "Une clé d'acteur a été acceptée dans une décision",
    "LF422",
  );
  for (const bad of ["NaN", "1e3", "abc"]) {
    await rejects(
      correctSql,
      decide({ field_id: closing2.id, action: "correct", user_value: bad, expected_revision: 0 }),
      `Le montant « ${bad} » a été accepté`,
      "LF422",
    );
  }
  await rejects(
    correctSql,
    decide({
      field_id: closing2.id,
      action: "correct",
      user_value: "123456789012345.5",
      expected_revision: 0,
    }),
    "Un montant hors des bornes de numeric(20,6) a atteint la base",
    "LF422",
  );
  await rejects(
    correctSql,
    decide({ field_id: closing2.id, action: "correct", user_value: "-100", expected_revision: 0 }),
    "Un solde négatif a été accepté en correction",
    "seul le capital",
  );
  // Un capital négatif (intérêts capitalisés) est une valeur fidèle : il est accepté.
  const principal2 = await fieldId("L2.principal");
  await rpc("lfo_correct_document_extraction_field", {
    field_id: principal2.id,
    action: "correct",
    user_value: "-5",
    expected_revision: 0,
    reason: "Intérêts capitalisés",
  });
  await rpc("lfo_correct_document_extraction_field", {
    field_id: principal2.id,
    action: "correct",
    user_value: "900",
    expected_revision: 1,
    reason: "Retour à la valeur imprimée",
  });
  await rpc("lfo_correct_document_extraction_field", {
    field_id: closing2.id,
    action: "correct",
    user_value: "100",
    expected_revision: 0,
    reason: "Relu sur le PDF bancaire",
  });
  assert((await statusOf("ROW_BALANCE:2")) === "PASSED", "La correction n'a pas été réévaluée");
  await rejects(
    correctSql,
    decide({ field_id: closing2.id, action: "review", expected_revision: 0 }),
    "Une décision sur une révision périmée a écrasé la précédente",
    "LF409",
  );
  const date2 = await fieldId("L2.date");
  await rejects(
    correctSql,
    decide({ field_id: date2.id, action: "correct", user_value: "1", expected_revision: 0 }),
    "Une date a été corrigée par un montant",
    "LF422",
  );
  await rejects(
    correctSql,
    decide({
      field_id: date2.id,
      action: "correct",
      user_date: "2026-02-30",
      expected_revision: 0,
    }),
    "Une date inexistante a été acceptée en correction",
    "LF422",
  );
  const text = await fieldId("L1.colE");
  await rejects(
    correctSql,
    decide({ field_id: text.id, action: "correct", user_value: "1", expected_revision: 0 }),
    "Une case de texte a été corrigée",
    "LF422",
  );
  const trail = await client.query<{
    action: string;
    before_status: string;
    after_value: string;
    reason: string;
    actor_user_id: string;
    executed_by: string;
    decision_rank: number;
  }>(
    `select action, before_status, after_value::text, reason, actor_user_id::text, executed_by, decision_rank
       from public.document_field_decisions where field_id = $1`,
    [closing2.id],
  );
  assert(trail.rows.length === 1, "La décision n'a pas laissé exactement une trace");
  const entry = trail.rows[0]!;
  assert(
    entry.action === "CORRECT" &&
      entry.before_status === "EXTRACTED" &&
      Number(entry.after_value) === 100 &&
      entry.reason === "Relu sur le PDF bancaire" &&
      entry.actor_user_id === userId &&
      entry.executed_by === "service_role" &&
      entry.decision_rank === 1,
    "La piste ne garde pas avant, après, motif, acteur vérifié et rôle constaté",
  );
  await rejects(
    "update public.document_field_decisions set reason = 'réécrit' where field_id = $1",
    [closing2.id],
    "Une décision a été réécrite",
    "immuable",
  );
  await rejects(
    "delete from public.document_field_decisions where field_id = $1",
    [closing2.id],
    "Une décision a été supprimée alors que sa lecture existe",
    "non supprimable",
  );

  // ── 5. Validation ───────────────────────────────────────────────────────────────
  const validateSql = "select public.lfo_validate_document_extraction($1::uuid, $2::uuid)";
  // Date en double : la ligne 2 est corrigée à la date de la ligne 1.
  await rpc("lfo_correct_document_extraction_field", {
    field_id: date2.id,
    action: "correct",
    user_date: "2026-10-05",
    expected_revision: 0,
    reason: "Test de doublon",
  });
  await rejects(validateSql, [userId, runId], "Une date en double a été validée", "en double");
  await rpc("lfo_correct_document_extraction_field", {
    field_id: date2.id,
    action: "correct",
    user_date: "2026-09-05",
    expected_revision: 1,
    reason: "Test d'ordre",
  });
  await rejects(
    validateSql,
    [userId, runId],
    "Des dates non croissantes ont été validées",
    "non croissantes",
  );
  await rpc("lfo_correct_document_extraction_field", {
    field_id: date2.id,
    action: "review",
    expected_revision: 2,
  });
  await client.query(
    "update public.document_extraction_runs set currency = null, currency_source = null where id = $1",
    [runId],
  );
  await rejects(
    validateSql,
    [userId, runId],
    "Un échéancier sans devise a été validé",
    "sans devise",
  );
  await client.query(
    "update public.document_extraction_runs set currency = 'EUR', currency_source = 'DECLARED' where id = $1",
    [runId],
  );
  // Dépôt interrompu : la lecture annonce plus de lignes qu'elle n'en a persisté.
  await client.query("update public.document_extraction_runs set line_count = 3 where id = $1", [
    runId,
  ]);
  await rejects(
    validateSql,
    [userId, runId],
    "Une lecture tronquée a été validée",
    "Lecture incomplète",
  );
  await client.query("update public.document_extraction_runs set line_count = 2 where id = $1", [
    runId,
  ]);
  await client.query(validateSql, [userId, runId]);
  const validated = await client.query<{ status: string }>(
    "select status from public.document_extraction_runs where id = $1",
    [runId],
  );
  assert(validated.rows[0]!.status === "VALIDATED", "La lecture cohérente n'a pas été validée");
  const schedulesAfter = await client.query<{ count: string }>(
    "select count(*)::text as count from public.loan_schedules where user_id = $1",
    [userId],
  );
  assert(
    schedulesAfter.rows[0]!.count === schedulesBefore.rows[0]!.count,
    "Valider une lecture a écrit dans loan_schedules : le rattachement est B20",
  );

  // ── 6. Même fichier, lecture remplaçante ───────────────────────────────────────
  await rejects(
    openSql,
    [userId, JSON.stringify(open())],
    "Le même fichier validé a été relu",
    "LF409",
  );
  // Un fichier encore EN REVUE n'est pas relu : ses décisions seraient perdues en silence.
  const inReview = await rpc(
    "lfo_open_schedule_extraction",
    open({ file_hash: HASH_B, line_count: 1, completeness: "COMPLETE", completeness_reasons: [] }),
  );
  await rejects(
    openSql,
    [userId, JSON.stringify(open({ file_hash: HASH_B }))],
    "Un fichier en revue a été relu, effaçant ses décisions",
    "déjà en revue",
  );
  await rpc("lfo_append_document_extraction_fields", {
    run_id: inReview,
    fields: [
      date(1, "2026-10-05"),
      { ...money(1, "opening", "B", "abc"), normalized_value: null, validation_status: "BLOCKED" },
      money(1, "closing", "D", "0"),
    ],
  });
  const blockedId = (
    await client.query<{ id: string }>(
      "select id from public.document_extraction_fields where run_id = $1 and box_code = 'L1.opening'",
      [inReview],
    )
  ).rows[0]!.id;
  await rejects(
    correctSql,
    decide({ field_id: blockedId, action: "review", expected_revision: 0 }),
    "Une case illisible a été confirmée, levant son blocage",
    "illisible",
  );
  // Une décision RELIT la complétude : la lecture annoncée complète ne l'est pas (dette
  // connue par son seul encours, donc sans capital initial déclaré).
  await rpc("lfo_correct_document_extraction_field", {
    field_id: blockedId,
    action: "reject",
    expected_revision: 0,
    reason: "Cellule illisible",
  });
  // Sans contrôle évalué, la lecture n'est pas validable (dépôt interrompu avant les contrôles).
  await rejects(
    validateSql,
    [userId, inReview],
    "Une lecture jamais contrôlée a été validée",
    "Aucun contrôle",
  );
  const completeness = await client.query<{ completeness: string; reasons: string[] }>(
    "select completeness, completeness_reasons as reasons from public.document_extraction_runs where id = $1",
    [inReview],
  );
  assert(
    completeness.rows[0]!.completeness === "PARTIAL" &&
      completeness.rows[0]!.reasons.some((reason) => reason.includes("non déclaré")),
    "La complétude n'a pas été relue après la décision",
  );

  // Seule une lecture EN ÉCHEC du même contenu est remplacée.
  const failedOpen = {
    file_hash: HASH_C,
    status: "FAILED",
    line_count: null,
    first_due_date: null,
    last_due_date: null,
    completeness: null,
    completeness_reasons: [],
    error: "Lecture d’échéancier en échec : voir les anomalies.",
  };
  const failed = await rpc("lfo_open_schedule_extraction", open(failedOpen));
  const retried = await rpc("lfo_open_schedule_extraction", open(failedOpen));
  const replaced = await client.query<{ supersedes: string | null }>(
    "select supersedes_run_id::text as supersedes from public.document_extraction_runs where id = $1",
    [retried],
  );
  assert(
    replaced.rows[0]!.supersedes === failed,
    "La relecture d'un échec ne désigne pas la lecture remplacée",
  );

  // Confirmer revient à la valeur de la pièce, après correction comme après écartement.
  // Ces vérifications sont isolées pour préserver les hypothèses du reste du smoke.
  await client.query("savepoint confirmation_trace");
  for (const [code, correction] of [
    ["L1.principal", { user_value: "17" }],
    ["L1.date", { user_date: "2026-10-06" }],
  ] as const) {
    const field = await fieldId(code);
    const decideCurrent = async (action: string, extra: Record<string, string> = {}) => {
      const current = await fieldId(code);
      await rpc("lfo_correct_document_extraction_field", {
        field_id: current.id,
        action,
        expected_revision: current.revision,
        reason: "Recette synthétique de la piste de confirmation",
        ...extra,
      });
    };
    const lastTrace = async () =>
      (
        await client.query<{
          before_status: string;
          before_empty: boolean;
          after_matches_source: boolean;
        }>(
          `select d.before_status,
          d.before_value is null and d.before_date is null as before_empty,
          case when f.unit = 'DATE' then d.after_date is not distinct from f.normalized_date
               else d.after_value is not distinct from f.normalized_value end as after_matches_source
        from public.document_field_decisions d
        join public.document_extraction_fields f on f.id = d.field_id and f.user_id = d.user_id
        where d.field_id = $1 order by d.decision_rank desc limit 1`,
          [field.id],
        )
      ).rows[0]!;
    await decideCurrent("correct", correction);
    await decideCurrent("review");
    assert(
      (await lastTrace()).after_matches_source,
      `${code} : confirmation sans valeur de la pièce dans la piste`,
    );
    await decideCurrent("reject");
    await decideCurrent("review");
    const restored = await lastTrace();
    assert(
      restored.before_status === "REJECTED" &&
        restored.before_empty &&
        restored.after_matches_source,
      `${code} : la piste confond une case écartée avec sa valeur imprimée`,
    );
  }
  await client.query("rollback to savepoint confirmation_trace");

  // ── 7. Droits : lecture seule pour `authenticated`, RPC refusées ────────────────
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await rejects(
    "insert into public.document_field_decisions (user_id, run_id, field_id, decision_rank, action, before_status, after_status, actor_user_id) values ($1, $2, $3, 9, 'REVIEW', 'EXTRACTED', 'REVIEWED', $1)",
    [userId, runId, closing2.id],
    "authenticated a écrit une décision",
    "permission denied",
  );
  await rejects(
    correctSql,
    decide({ field_id: closing2.id, action: "review", expected_revision: 1 }),
    "authenticated a exécuté une RPC de décision",
    "permission denied",
  );
  await client.query("set local role service_role");

  // ── 8. Supprimer la lecture emporte ses décisions ────────────────────────────────
  await client.query("delete from public.document_extraction_runs where id = $1", [runId]);
  const orphans = await client.query<{ count: string }>(
    "select count(*)::text as count from public.document_field_decisions where run_id = $1",
    [runId],
  );
  assert(orphans.rows[0]!.count === "0", "Des décisions ont survécu à leur lecture");

  succeeded = true;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
if (succeeded)
  console.log(
    "Smoke échéancier B19 : lecture visant une dette, tabulaire NOT_PDF et localisée, charge stricte et cloisonnement, contrôles calculés en base (réussi, non calculable sur case vide), décisions à révision attendue (conflit LF409), piste immuable avec acteur vérifié et rôle constaté, corrections typées (date, montant fini, texte refusé), validation exigeant devise et dates cohérentes sans écrire loan_schedules, montants bornés et non négatifs hors capital, case illisible jamais confirmée, complétude relue après décision, lecture tronquée ou jamais contrôlée non validable, même fichier validé une fois, fichier en revue jamais relu, seul un échec remplacé, lecture seule pour authenticated, décisions emportées par leur lecture (transaction annulée).",
  );
