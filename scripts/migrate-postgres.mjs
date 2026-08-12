import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!/^postgres(?:ql)?:\/\//iu.test(databaseUrl)) {
  throw new Error("DATABASE_URL must be set to a PostgreSQL connection URL.");
}

const migrationUrls = [
  new URL("../postgres/0001_v5_1_system.sql", import.meta.url),
  new URL("../postgres/0002_adult_evaluation.sql", import.meta.url),
];
const insecureLocal = process.env.DATABASE_ALLOW_INSECURE_LOCAL?.trim().toLowerCase();
if (insecureLocal && insecureLocal !== "true" && insecureLocal !== "false") {
  throw new Error("DATABASE_ALLOW_INSECURE_LOCAL must be true or false when set.");
}
const ssl = insecureLocal === "true" ? undefined : { rejectUnauthorized: true };
const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl });

try {
  for (const migrationUrl of migrationUrls) {
    await pool.query(await readFile(migrationUrl, "utf8"));
  }
  process.stdout.write("PostgreSQL migrations 0001 and 0002 are ready.\n");
} finally {
  await pool.end();
}
