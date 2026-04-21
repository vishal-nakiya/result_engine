import { Router } from "express";
import { processingService } from "../services/processing.service.js";
import { allocationService } from "../services/allocation.service.js";

export const processRouter = Router();

processRouter.post("/run", async (_req, res) => {
  const result = await processingService.runPipeline();
  res.json(result);
});

/** Re-run force allocation only (uses current merit_rank + vacancy_rows / legacy vacancy). */
processRouter.post("/allocate-only", async (_req, res) => {
  try {
    const result = await allocationService.allocateFromMerit();
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e?.statusCode ?? 500;
    res.status(status).json({ ok: false, error: { message: e?.message ?? "Allocation failed" } });
  }
});

