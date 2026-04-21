import { Router } from "express";
import { z } from "zod";
import { db } from "../db/knex.js";

export const logsRouter = Router();

logsRouter.get("/", async (req, res) => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { page, pageSize, level } = parsed.data;
  const k = db();
  const base = k("logs");
  if (level) base.where({ level });
  const [totalRow, rows] = await Promise.all([
    base.clone().count("* as c").first(),
    base
      .clone()
      .select(["id", "timestamp", "level", "message", "meta"])
      .orderBy("timestamp", "desc")
      .offset((page - 1) * pageSize)
      .limit(pageSize),
  ]);

  res.json({ page, pageSize, total: Number(totalRow?.c ?? 0), rows });
});

