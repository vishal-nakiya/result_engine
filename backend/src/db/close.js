import { db } from "./knex.js";

export async function closeDb() {
  try {
    await db().destroy();
  } catch {
    // ignore
  }
}

