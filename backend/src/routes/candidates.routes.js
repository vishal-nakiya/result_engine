import { Router } from "express";
import { z } from "zod";
import { candidateService } from "../services/candidate.service.js";
import { validateFilterGroup } from "../services/candidate-list-filter.js";

export const candidatesRouter = Router();

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().optional(),
  category: z.enum(["UR", "OBC", "SC", "ST", "EWS", "ESM"]).optional(),
  gender: z.enum(["M", "F"]).optional(),
  status: z.enum(["cleared", "rejected", "debarred", "withheld", "tu"]).optional(),
  includeEval: z.coerce.boolean().optional(),
  filterGroup: z
    .preprocess((val) => {
      if (val == null || val === "") return undefined;
      if (typeof val === "object" && val !== null) return val;
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return undefined;
        }
      }
      return undefined;
    }, z.any().optional()),
});

candidatesRouter.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const fg = validateFilterGroup(parsed.data.filterGroup);
  if (!fg.ok) return res.status(400).json({ error: { message: fg.error } });

  const data = await candidateService.listCandidates({ ...parsed.data, filterGroup: fg.group });
  res.json(data);
});

candidatesRouter.get("/:id", async (req, res) => {
  const c = await candidateService.getCandidate(req.params.id);
  if (!c) return res.status(404).json({ error: { message: "Not found" } });
  res.json(c);
});

