/**
 * Preuve de SÉRIALISATION du plafond de quote-part immobilière.
 *
 * Ce contrôle ne peut pas vivre dans `smoke-real-estate.ts` : celui-ci s'exécute dans une
 * transaction unique annulée à la fin, alors que prouver la concurrence exige DEUX
 * transactions simultanées, dont l'une doit valider pour que l'autre la voie.
 *
 * Ce que le script prouve, et que ni la RPC ni un `check` ne peuvent prouver :
 *
 *   1. deux écritures concurrentes sur le MÊME concours ne peuvent pas porter le cumul des
 *      quote-parts au-delà de 1 ;
 *   2. la seconde BLOQUE réellement sur le verrou pendant que la première est ouverte,
 *      au lieu de lire un total périmé ;
 *   3. une fois la première validée, la seconde est refusée, et rien de supérieur à 1 ne
 *      reste persisté.
 *
 * Sans le verrou de la ligne de dette, les deux transactions liraient un cumul de 0 avant
 * leurs insertions respectives et poseraient 0,6 + 0,6 = 1,2 : la même dette serait
 * attribuée à 120 %, et l'equity immobilière surévaluée d'autant.
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const client = () => new Client({ connectionString, ssl: false });

const setup = client();
const first = client();
const second = client();

const liabilityId = randomUUID();
const propertyA = randomUUID();
const propertyB = randomUUID();

await setup.connect();
const owner = await setup.query<{ id: string }>(
  "select id from auth.users order by created_at asc limit 1",
);
assert(owner.rows[0], "Aucun utilisateur disponible pour le smoke test");
const userId = owner.rows[0].id;

async function cleanup(): Promise<void> {
  await setup
    .query("delete from public.real_estate_financing_links where liability_id = $1", [liabilityId])
    .catch(() => undefined);
  await setup
    .query("delete from public.properties where id = any($1::uuid[])", [[propertyA, propertyB]])
    .catch(() => undefined);
  await setup
    .query("delete from public.liabilities where id = $1", [liabilityId])
    .catch(() => undefined);
}

try {
  await first.connect();
  await second.connect();

  await setup.query(
    `insert into public.liabilities
       (id, user_id, lender, name, principal, current_balance, annual_rate, monthly_payment,
        payment_count, first_payment_date, maturity_date, data_kind, confidence)
     values ($1, $2, 'Banque concurrence', 'Crédit concurrence', 100000, 80000, 0.02, 500,
             240, date '2020-01-05', date '2040-01-05', 'ACTUAL', 'HIGH')`,
    [liabilityId, userId],
  );
  await setup.query(
    `insert into public.properties (id, user_id, name, ownership_share, debt_financed)
     values ($1, $3, 'Bien concurrence A', 1, true), ($2, $3, 'Bien concurrence B', 1, true)`,
    [propertyA, propertyB, userId],
  );

  const link = async (target: pg.Client, propertyId: string, share: number) => {
    await target.query("begin");
    await target.query(
      `insert into public.real_estate_financing_links
         (user_id, property_id, liability_id, allocation_share, data_kind, confidence)
       values ($1, $2, $3, $4, 'USER_ASSUMPTION', 'HIGH')`,
      [userId, propertyId, liabilityId, share],
    );
  };

  // La première transaction pose 60 % et NE VALIDE PAS : elle détient le verrou.
  await link(first, propertyA, 0.6);

  // La seconde tente 60 % à son tour. Elle doit rester bloquée tant que la première
  // n'est pas retombée : c'est exactement ce que le verrou garantit.
  const pending = link(second, propertyB, 0.6);
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
    `La seconde écriture n'a pas été sérialisée : elle s'est terminée (${observed}) alors que la première était encore ouverte. Le cumul de quote-parts n'est donc pas protégé sous concurrence.`,
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
    "La seconde écriture a été acceptée après validation de la première : le cumul de quote-parts dépasse 1.",
  );
  assert(
    refused.includes("comptée deux fois") || refused.toLowerCase().includes("serializ"),
    `La seconde écriture a été refusée pour une autre raison que le plafond de quote-part : ${refused}`,
  );
  await second.query("rollback").catch(() => undefined);

  const persisted = await setup.query<{ total: string }>(
    `select coalesce(sum(allocation_share), 0)::text as total
       from public.real_estate_financing_links where liability_id = $1`,
    [liabilityId],
  );
  assert(
    Number(persisted.rows[0].total) <= 1.00000001,
    `Cumul de quote-parts persisté à ${persisted.rows[0].total} : l'invariant a cédé.`,
  );

  console.log(
    `Smoke Real Estate concurrence vert : seconde écriture sérialisée par le verrou de la ligne de dette, refusée après validation de la première, cumul persisté à ${persisted.rows[0].total}.`,
  );
} finally {
  await first.query("rollback").catch(() => undefined);
  await second.query("rollback").catch(() => undefined);
  await cleanup();
  await first.end().catch(() => undefined);
  await second.end().catch(() => undefined);
  await setup.end().catch(() => undefined);
}
