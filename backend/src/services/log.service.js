import { db } from "../db/knex.js";
import { newId } from "../db/ids.js";

export const logService = {
  async write(level, message, meta) {
    const k = db();
    await k("logs").insert({
      id: newId(),
      level,
      message,
      meta: meta == null ? null : JSON.stringify(meta),
    });
  },
};

