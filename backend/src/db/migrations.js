import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./knex.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function repoRoot() {
  // backend/src/db -> backend/src -> backend -> repo root
  return path.resolve(__dirname, "..", "..", "..");
}

function migrationsDir() {
  return path.join(repoRoot(), "db", "migrations");
}

function listSqlMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((f) => ({ name: f, fullPath: path.join(dir, f) }));
}

export async function runSqlMigrations() {
  const k = db();
  // Ensure UUID function exists for schemas/migrations that rely on it
  try {
    await k.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  } catch {
    // Some managed DBs disallow uuid-ossp; pgcrypto provides gen_random_uuid()
    try {
      await k.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    } catch {
      // ignore — migrations may still work if UUIDs aren't required
    }
  }
  await k.raw(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const dir = migrationsDir();
  const files = listSqlMigrations(dir);
  if (!files.length) return { applied: 0, skipped: 0, dir };

  const appliedRows = await k("app_migrations").select(["name"]);
  const applied = new Set(appliedRows.map((r) => r.name));

  let appliedCount = 0;
  let skippedCount = 0;
  for (const f of files) {
    if (applied.has(f.name)) {
      skippedCount += 1;
      continue;
    }
    const sql = fs.readFileSync(f.fullPath, "utf8");
    // eslint-disable-next-line no-await-in-loop
    await k.transaction(async (trx) => {
      await trx.raw(sql);
      await trx("app_migrations").insert({ name: f.name });
    });
    appliedCount += 1;
  }

  return { applied: appliedCount, skipped: skippedCount, dir };
}

