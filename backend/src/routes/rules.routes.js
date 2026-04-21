import { Router } from "express";
import { z } from "zod";
import { rulesEngine } from "../services/rules.engine.js";

export const rulesRouter = Router();

rulesRouter.get("/", async (_req, res) => {
  res.json(await rulesEngine.listRules());
});

const upsertSchema = z.object({
  ruleKey: z.string().min(1),
  value: z.unknown(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

rulesRouter.put("/", async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await rulesEngine.upsertRule(parsed.data));
});

const bulkSchema = z.object({
  rules: z.array(upsertSchema).min(1),
  deletedRuleKeys: z.array(z.string().min(1)).optional(),
});

rulesRouter.put("/bulk", async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const results = [];
  for (const r of parsed.data.rules) {
    // sequential to keep DB load predictable; can be batched later
    // eslint-disable-next-line no-await-in-loop
    results.push(await rulesEngine.upsertRule(r));
  }
  if (parsed.data.deletedRuleKeys?.length) {
    await rulesEngine.deleteRules(parsed.data.deletedRuleKeys);
  }
  res.json({ updated: results.length, results });
});

