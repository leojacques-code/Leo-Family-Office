// Clés de recette : JWT HS256 anon et service_role signés par un secret ÉPHÉMÈRE généré
// hors dépôt. Même forme que les clés « legacy » d'un projet Supabase. Aucune n'est un secret
// de production ; elles ne donnent accès qu'à la base jetable de 127.0.0.1.
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const dir = process.env.RECETTE_DIR;
if (!dir) throw new Error("RECETTE_DIR requis");
const secret = readFileSync(`${dir}/jwt_secret.txt`, "utf8").trim();
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sign = (role) => {
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase",
    role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600,
  })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
};
writeFileSync(`${dir}/anon.key`, sign("anon"));
writeFileSync(`${dir}/service.key`, sign("service_role"));
console.log("clés de recette écrites dans RECETTE_DIR (hors dépôt)");
