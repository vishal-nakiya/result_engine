import { Router } from "express";
import { db } from "../db/knex.js";

export const dashboardRouter = Router();

dashboardRouter.get("/stats", async (_req, res) => {
  const k = db();
  const [
    totalCandidatesRow,
    clearedRow,
    rejectedRow,
    withheldRow,
    allocatedRow,
    vacancyRow,
  ] = await Promise.all([
    k("candidates").count("* as c").first(),
    k("candidates").where({ status: "cleared" }).count("* as c").first(),
    k("candidates").where({ status: "rejected" }).count("* as c").first(),
    k("candidates").where({ status: "withheld" }).count("* as c").first(),
    k("allocation").count("* as c").first(),
    k("vacancy").sum({ s: "total_posts" }).first(),
  ]);

  const totalCandidates = Number(totalCandidatesRow?.c ?? 0);
  const cleared = Number(clearedRow?.c ?? 0);
  const rejected = Number(rejectedRow?.c ?? 0);
  const withheld = Number(withheldRow?.c ?? 0);
  const allocated = Number(allocatedRow?.c ?? 0);
  const totalPosts = Number(vacancyRow?.s ?? 0);

  res.json({
    totalCandidates,
    status: { cleared, rejected, withheld },
    allocated,
    totalPosts,
  });
});

