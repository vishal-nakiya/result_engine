import { Router } from "express";
import { z } from "zod";
import { db } from "../db/knex.js";
import { allocationService } from "../services/allocation.service.js";

export const allocationRouter = Router();

allocationRouter.post("/run", async (_req, res) => {
  try {
    const result = await allocationService.allocateFromMerit();
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e?.statusCode ?? 500;
    res.status(status).json({ ok: false, error: { message: e?.message ?? "Allocation failed" } });
  }
});

allocationRouter.get("/", async (req, res) => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    forceCode: z.enum(["A", "B", "C", "D", "E", "F", "G", "H"]).optional(),
    state: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { page, pageSize, forceCode, state } = parsed.data;
  const k = db();
  const base = k("allocation as a")
    .leftJoin("candidates as c", "c.id", "a.candidate_id")
    .modify((qb) => {
      if (forceCode) qb.where("a.force_code", forceCode);
      if (state) {
        qb.where((b) => {
          b.whereILike("a.state_allocated", `%${state}%`).orWhereILike("a.state_code", `%${state}%`);
        });
      }
    });

  const [totalRow, rows] = await Promise.all([
    base.clone().count("* as c").first(),
    base
      .clone()
      .select([
        "a.id",
        "a.candidate_id as candidateId",
        "a.force_code as forceCode",
        "a.category_allocated as categoryAllocated",
        "a.state_allocated as stateAllocated",
        "a.district_allocated as districtAllocated",
        "a.merit_rank as meritRank",
        "a.created_at as createdAt",
        "a.vacancy_row_key as vacancyRowKey",
        "a.state_code as stateCode",
        "a.area as area",
        "a.post_code as postCode",
        "a.allocation_meta as allocationMeta",
        "c.roll_no as rollNo",
        "c.name as name",
        "c.category as category",
        "c.gender as gender",
        "c.is_esm as isEsm",
        "c.final_marks as finalMarks",
        "c.part_a_marks as partAMarks",
        "c.part_b_marks as partBMarks",
      ])
      .orderBy("a.merit_rank", "asc")
      .offset((page - 1) * pageSize)
      .limit(pageSize),
  ]);

  res.json({ page, pageSize, total: Number(totalRow?.c ?? 0), rows });
});

