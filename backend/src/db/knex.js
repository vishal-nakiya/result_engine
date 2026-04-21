import knex from "knex";
import "dotenv/config";

let _db;

function parsePgUrl(url) {
  // Accepts standard DATABASE_URL (postgresql://user:pass@host:port/db)
  return { connectionString: url };
}

export function db() {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  _db = knex({
    client: "pg",
    connection: parsePgUrl(connectionString),
    pool: { min: 2, max: 20 },
  });
  return _db;
}

