import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { stateDistrictService } from "../services/state-district.service.js";
import { uploadSessionService } from "../services/upload-session.service.js";

export const stateDistrictsRouter = Router();

const maxMb = Number(process.env.MAX_UPLOAD_MB ?? 200);

const uploadDisk = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        const dir = await uploadSessionService.ensureDir();
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "");
      cb(null, `state_dist_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: maxMb * 1024 * 1024 },
});

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
});

stateDistrictsRouter.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = await stateDistrictService.listStateDistricts(parsed.data);
  res.json(data);
});

stateDistrictsRouter.post("/upload", uploadDisk.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { message: "file is required (multipart field name: file)" } });
  const lower = (req.file.originalname || "").toLowerCase();
  if (!lower.endsWith(".csv")) {
    return res.status(400).json({ error: { message: "Only .csv files are supported for this upload" } });
  }
  try {
    const result = await stateDistrictService.importStateDistrictCsvFromPath(req.file.path);
    res.json(result);
  } catch (e) {
    const status = e?.statusCode ?? 400;
    res.status(status).json({ error: { message: e?.message ?? "Import failed" } });
  }
});
