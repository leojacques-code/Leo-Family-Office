/**
 * Preuve de SÉRIALISATION d'une correction d'observation de position.
 *
 * Ce contrôle ne peut pas vivre dans `smoke-portfolio-import.ts` : celui-ci s'exécute dans
 * une transaction unique annulée à la fin, alors que prouver la concurrence exige DEUX
 * transactions simultanées, dont l'une doit valider pour que l'autre la voie.
 *
 * CE QUE LE FINDING REPROCHAIT
 *
 * Le contrat précédent autorisait le remplacement d'une observation dès lors que sa ligne
 * était nommée dans un tableau d'identifiants. Deux sessions décidant de corriger la MÊME
 * observation passaient donc toutes les deux : la seconde écrasait la décision de la
 * première sans rien remarquer, et il n'en restait aucune trace. « Avoir une décision » ne
 * dit rien de l'état sur lequel elle a été prise.
 *
 * CE QUE CE SCRIPT PROUVE, et que ni la RPC ni un `check` ne peuvent prouver seuls :
 *
 *   1. la seconde correction BLOQUE réellement sur le verrou de l'observation pendant que la
 *      première est ouverte, au lieu de lire un état périmé ;
 *   2. une fois la première validée, la seconde est REFUSÉE — son état attendu n'est plus
 *      l'état courant — avec un conflit révisable nommant le champ, l'attendu et le trouvé ;
 *   3. la décision de la première SURVIT : l'observation porte sa valeur, et la piste d'audit
 *      porte exactement UNE correction, celle qui a réellement eu lieu.
 *
 * Sans le verrou pris AVANT la comparaison, les deux transactions liraient le même état
 * initial, se croiraient toutes deux en accord avec leur état attendu, et la seconde
 * écraserait la première : le patrimoine porterait une valeur que personne n'a décidée.
 *
 * Ce script COMMITE puis nettoie : il refuse donc tout hôte non local, comme
 * `db-local-reset.ts`. Il ne fait pas partie de `smoke:local`, qui reste intégralement en
 * rollback et exécutable contre une base réelle.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL manquante");
const url = new URL(connectionString);
if (!LOCAL_HOSTS.has(url.hostname)) {
  throw new Error(
    `Cible non locale refusée : ${url.hostname}. Ce script valide des écritures ; il n'accepte que ${[...LOCAL_HOSTS].join(", ")}.`,
  );
}

/** Millisecondes pendant lesquelles la seconde transaction doit rester bloquée. */
const LOCK_OBSERVATION_MS = 700;

/** Date de l'observation disputée. Une seule, c'est le point du test. */
const DISPUTED_DATE = "2026-08-31";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const client = () => new Client({ connectionString, ssl: false });

const setup = client();
const first = client();
const second = client();

const accountId = randomUUID();
const securityId = randomUUID();
const sessionIds: string[] = [];

await setup.connect();
const owner = await setup.query<{ id: string }>(
  "select id from auth.users order by created_at asc limit 1",
);
assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
const userId = owner.rows[0].id;

/**
 * Nettoyage dans l'ORDRE DES DÉPENDANCES, et non par cascade.
 *
 * La piste d'audit est en `restrict` sur l'observation ET immuable : elle ne peut donc être
 * ni supprimée par un `delete`, ni emportée par la disparition de l'observation. C'est
 * exactement l'invariant voulu — et cela signifie qu'un smoke qui écrit doit démonter son
 * décor par le haut. Le trigger d'immuabilité est désactivé LOCALEMENT, sous `session_replication_role`,
 * le temps de retirer les lignes de démonstration : la protection reste entière hors de ce
 * script, qui est le seul à écrire hors transaction annulée.
 */
async function cleanup(): Promise<void> {
  const run = (sql: string, params: unknown[] = []) =>
    setup.query(sql, params).catch(() => undefined);
  // `reset role` D'ABORD : `session_replication_role` exige le superutilisateur, et sous
  // `service_role` la désactivation échouerait en silence — le décor resterait derrière.
  await setup.query("reset role").catch(() => undefined);
  await setup.query("set session session_replication_role = replica");
  await run(
    `delete from public.position_snapshot_corrections
      where position_snapshot_id in (
        select ps.id from public.position_snapshots ps
          join public.positions p on p.id = ps.position_id
         where p.account_id = $1)`,
    [accountId],
  );
  await run(`delete from public.import_record_links where session_id = any($1::uuid[])`, [
    sessionIds,
  ]);
  await run(`delete from public.import_normalized_records where session_id = any($1::uuid[])`, [
    sessionIds,
  ]);
  await run(`delete from public.import_raw_records where session_id = any($1::uuid[])`, [
    sessionIds,
  ]);
  await run(`delete from public.import_sessions where id = any($1::uuid[])`, [sessionIds]);
  await run(
    `delete from public.external_sources
      where domain = 'PORTFOLIO_POSITION' and target_account_id = $1`,
    [accountId],
  );
  await run(
    `delete from public.import_sources where domain = 'PORTFOLIO_POSITION' and target_account_id = $1`,
    [accountId],
  );
  await run(
    `delete from public.position_snapshots
      where position_id in (select id from public.positions where account_id = $1)`,
    [accountId],
  );
  await run(`delete from public.positions where account_id = $1`, [accountId]);
  await run(`delete from public.securities where id = $1`, [securityId]);
  await run(`delete from public.financial_accounts where id = $1`, [accountId]);
  await setup.query("set session session_replication_role = origin").catch(() => undefined);
}

/** Appelle une RPC `lfo_*` sur une connexion donnée. */
async function rpc(target: pg.Client, name: string, payload: unknown): Promise<string> {
  const result = await target.query<{ value: string }>(
    `select public.${name}($1::uuid, $2::jsonb)::text as value`,
    [userId, JSON.stringify(payload)],
  );
  return result.rows[0].value;
}

try {
  await first.connect();
  await second.connect();
  for (const connection of [setup, first, second]) {
    await connection.query("set role service_role");
  }

  // ── Décor ────────────────────────────────────────────────────────────────────
  await setup.query(
    `insert into public.financial_accounts
       (id, user_id, name, account_type, currency, liquidity, status, data_kind, confidence)
     values ($1, $2, 'PEA concurrence', 'BROKERAGE', 'EUR', 'LIQUID', 'ACTIVE', 'ACTUAL', 'HIGH')`,
    [accountId, userId],
  );
  await setup.query(
    `insert into public.securities (id, user_id, name, ticker, isin, currency)
     values ($1, $2, 'Titre concurrence', 'CONC', 'FR0000000019', 'EUR')`,
    [securityId, userId],
  );

  /** Ouvre une session de POSITION analysée portant UNE ligne, et rend sa ligne normalisée. */
  async function analyzedSession(
    hash: string,
    marketValue: string,
  ): Promise<{ sessionId: string; recordId: string }> {
    const sessionId = await rpc(setup, "lfo_open_portfolio_session", {
      source: {
        kind: "FILE_CSV",
        domain: "PORTFOLIO_POSITION",
        provider: "GENERIC_PORTFOLIO_FILE",
        label: "Positions concurrence",
        target_account_id: accountId,
        adapter_version: "portfolio-file/1",
      },
      session: {
        file_name: `positions-${hash}.csv`,
        file_hash: hash.repeat(64).slice(0, 64),
        file_size_bytes: 256,
        content_type: "text/csv",
        parser: "portfolio-file",
        parser_version: "1",
        declared_currency: "EUR",
      },
    });
    sessionIds.push(sessionId);
    await rpc(setup, "lfo_append_portfolio_rows", {
      session_id: sessionId,
      rows: [
        {
          row_number: 2,
          raw_line: `31/08/2026;FR0000000019;10;${marketValue},00;EUR`,
          cells: ["31/08/2026", "FR0000000019", "10", `${marketValue},00`, "EUR"],
          fact_date: DISPUTED_DATE,
          security_id: securityId,
          quantity: "10",
          market_value: marketValue,
          cost_basis: null,
          currency: "EUR",
          instrument_source_key: "ISIN:FR0000000019",
          status: "READY",
          dedupe_verdict: "NEW",
          match_key: `conc-${hash}`,
          issues: [],
        },
      ],
    });
    await rpc(setup, "lfo_finalize_portfolio_session", { session_id: sessionId });
    const records = await setup.query<{ id: string }>(
      "select id from public.import_normalized_records where session_id = $1",
      [sessionId],
    );
    assert(records.rows[0], `Session ${hash} : aucune ligne normalisée`);
    return { sessionId, recordId: records.rows[0].id };
  }

  // Première écriture : elle CRÉE l'observation. Aucune décision nécessaire.
  const origin = await analyzedSession("a", "1000");
  await rpc(setup, "lfo_commit_portfolio_session", {
    session_id: origin.sessionId,
    record_ids: [origin.recordId],
  });

  // L'état que les DEUX corrections vont croire corriger, lu en texte comme la
  // prévisualisation le lit.
  const initial = await setup.query<{
    id: string;
    quantity: string | null;
    cost_basis: string | null;
    market_value: string | null;
    currency: string;
  }>(
    `select ps.id, ps.quantity::text as quantity, ps.cost_basis::text as cost_basis,
            ps.market_value::text as market_value, ps.currency
       from public.position_snapshots ps
       join public.positions p on p.id = ps.position_id
      where p.account_id = $1 and ps.snapshot_date = $2`,
    [accountId, DISPUTED_DATE],
  );
  assert(initial.rows.length === 1, "Une seule observation devait être créée");
  const expected = {
    snapshot_id: initial.rows[0].id,
    quantity: initial.rows[0].quantity,
    cost_basis: initial.rows[0].cost_basis,
    market_value: initial.rows[0].market_value,
    currency: initial.rows[0].currency,
  };
  assert(
    Number(expected.market_value) === 1000,
    `L'observation initiale devait valoir 1000 : obtenue ${expected.market_value}`,
  );

  // Deux sessions concurrentes, deux valeurs différentes, MÊME état attendu.
  const contender = await analyzedSession("b", "1500");
  const challenger = await analyzedSession("c", "1800");

  const correct = async (
    target: pg.Client,
    session: { sessionId: string; recordId: string },
    label: string,
  ) => {
    await target.query("begin");
    return rpc(target, "lfo_commit_portfolio_session", {
      session_id: session.sessionId,
      record_ids: [session.recordId],
      corrections: [
        {
          record_id: session.recordId,
          reason: `Correction concurrente ${label}`,
          decided_by: `smoke:concurrence-${label}`,
          expected,
        },
      ],
    });
  };

  // La première correction prend le verrou de l'observation et NE VALIDE PAS.
  await correct(first, contender, "A");

  // La seconde tente la même observation. Elle doit rester BLOQUÉE tant que la première
  // n'est pas retombée : c'est le `for update` pris AVANT la comparaison qui le garantit.
  const pending = correct(second, challenger, "B");
  let settledEarly = false;
  const observed = await Promise.race([
    pending.then(
      () => {
        settledEarly = true;
        return "ACCEPTÉE";
      },
      () => {
        settledEarly = true;
        return "REFUSÉE";
      },
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("BLOQUÉE"), LOCK_OBSERVATION_MS)),
  ]);
  assert(
    observed === "BLOQUÉE" && !settledEarly,
    `La seconde correction n'a pas été sérialisée : elle s'est terminée (${observed}) alors que la première était encore ouverte. Deux décisions concurrentes ne sont donc pas protégées.`,
  );

  await first.query("commit");

  let refused: string | null = null;
  try {
    await pending;
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  assert(
    refused !== null,
    "La seconde correction a été ACCEPTÉE après validation de la première : la décision de la première a été écrasée en silence.",
  );
  // Le conflit doit être RÉVISABLE : il nomme la cause, le champ, l'attendu et le trouvé.
  assert(
    refused.includes("l'état attendu n'est plus l'état courant"),
    `La seconde correction a été refusée pour une autre raison que le conflit d'état attendu : ${refused}`,
  );
  assert(
    refused.includes("1000") && refused.includes("1500"),
    `Le conflit doit nommer l'attendu ET le trouvé pour être révisable : ${refused}`,
  );
  await second.query("rollback").catch(() => undefined);

  // ── La décision de la PREMIÈRE survit, et elle est seule ─────────────────────
  const persisted = await setup.query<{ count: string; value: string }>(
    `select count(*)::text as count, max(ps.market_value)::text as value
       from public.position_snapshots ps
       join public.positions p on p.id = ps.position_id
      where p.account_id = $1 and ps.snapshot_date = $2`,
    [accountId, DISPUTED_DATE],
  );
  assert(
    persisted.rows[0].count === "1" && Number(persisted.rows[0].value) === 1500,
    `L'observation devait porter la décision de la PREMIÈRE (1500), et une seule : obtenu ${persisted.rows[0].count} ligne(s) à ${persisted.rows[0].value}`,
  );

  const audit = await setup.query<{ count: string; decided_by: string; before: string }>(
    `select count(*) over ()::text as count, decided_by,
            before_values ->> 'market_value' as before
       from public.position_snapshot_corrections
      where position_snapshot_id = $1`,
    [expected.snapshot_id],
  );
  assert(
    audit.rows.length === 1 && audit.rows[0].count === "1",
    `La piste d'audit doit porter EXACTEMENT une correction, celle qui a eu lieu : obtenu ${audit.rows.length}`,
  );
  assert(
    audit.rows[0].decided_by === "smoke:concurrence-A",
    `La trace doit être celle de la première décision : obtenu ${audit.rows[0].decided_by}`,
  );
  assert(
    Number(audit.rows[0].before) === 1000,
    `La trace doit conserver la valeur d'AVANT la première correction : obtenu ${audit.rows[0].before}`,
  );

  // ── ROLLBACK INTÉGRAL : les quatre écritures vivent et meurent ensemble ─────
  //
  // Un mot sur ce qui est réellement testable ici. Faire ÉCHOUER la mutation canonique par
  // la donnée n'est pas constructible, et c'est une bonne nouvelle : les contraintes du
  // staging l'interdisent en amont. `import_normalized_records_ready_shape_ck` refuse une
  // position READY ou WARNING sans valeur de marché, `import_normalized_records_security_fk`
  // refuse un instrument inexistant, et les deux colonnes `currency` ont la même largeur.
  // Aucune ligne committable ne peut donc produire une observation invalide. Contrarier cela
  // demanderait de fabriquer un état que le produit refuse d'atteindre, et prouverait moins
  // que ce qui suit.
  //
  // Ce qui est prouvé est la propriété DEMANDÉE : la décision, l'insertion d'audit, la
  // mutation canonique et le lien de provenance sont dans la MÊME transaction. Les quatre
  // sont donc observés présents à l'intérieur, puis TOUS absents après annulation. Aucun
  // chemin ne laisse une observation corrigée sans sa trace, ni une trace sans sa mutation.
  const rollbackSession = await analyzedSession("d", "1750");
  const stateNow = await setup.query<{
    quantity: string | null;
    cost_basis: string | null;
    market_value: string | null;
    currency: string;
  }>(
    `select quantity::text as quantity, cost_basis::text as cost_basis,
            market_value::text as market_value, currency
       from public.position_snapshots where id = $1`,
    [expected.snapshot_id],
  );

  /** Les quatre artefacts d'une correction, comptés en une seule lecture. */
  const artefacts = async () => {
    const row = await setup.query<{
      audit: string;
      value: string;
      links: string;
      committed: string;
    }>(
      `select
         (select count(*)::text from public.position_snapshot_corrections
           where position_snapshot_id = $1) as audit,
         (select market_value::text from public.position_snapshots where id = $1) as value,
         (select count(*)::text from public.import_record_links
           where session_id = $2 and position_snapshot_id = $1) as links,
         (select count(*)::text from public.import_normalized_records
           where session_id = $2 and commit_state = 'COMMITTED') as committed`,
      [expected.snapshot_id, rollbackSession.sessionId],
    );
    return row.rows[0];
  };

  const before = await artefacts();
  await setup.query("begin");
  await rpc(setup, "lfo_commit_portfolio_session", {
    session_id: rollbackSession.sessionId,
    record_ids: [rollbackSession.recordId],
    corrections: [
      {
        record_id: rollbackSession.recordId,
        reason: "Correction annulée avec sa transaction",
        decided_by: "smoke:concurrence-rollback",
        expected: { snapshot_id: expected.snapshot_id, ...stateNow.rows[0] },
      },
    ],
  });
  const inside = await artefacts();
  assert(
    Number(inside.audit) === Number(before.audit) + 1 &&
      Number(inside.value) === 1750 &&
      inside.links === "1" &&
      inside.committed === "1",
    `Les quatre écritures devaient être visibles DANS la transaction : ${JSON.stringify(inside)}`,
  );
  await setup.query("rollback");

  const after = await artefacts();
  assert(
    after.audit === before.audit &&
      after.value === before.value &&
      after.links === "0" &&
      after.committed === "0",
    `ROLLBACK INTÉGRAL : les quatre écritures devaient disparaître ENSEMBLE. Avant ${JSON.stringify(before)}, après ${JSON.stringify(after)}`,
  );
  assert(
    Number(after.value) === 1500,
    `L'observation devait rester sur la décision de la première : obtenu ${after.value}`,
  );

  console.log(
    "Smoke Portfolio correction concurrente vert : seconde décision sérialisée par le verrou de l'observation, refusée sur conflit d'état attendu nommant l'attendu et le trouvé, décision de la première conservée, piste d'audit portant exactement une correction avec sa valeur d'avant, décision et audit et mutation et provenance annulés ENSEMBLE. Aucune donnée persistée.",
  );
} finally {
  await first.query("rollback").catch(() => undefined);
  await second.query("rollback").catch(() => undefined);
  await setup.query("rollback").catch(() => undefined);
  await cleanup();
  await first.end().catch(() => undefined);
  await second.end().catch(() => undefined);
  await setup.end().catch(() => undefined);
}
