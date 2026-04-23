import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { vacancyService } from "../services/vacancy.service.js";
import { uploadSessionService } from "../services/upload-session.service.js";

export const vacancyRouter = Router();

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
      cb(null, `vacancy_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: maxMb * 1024 * 1024 },
});

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
});

vacancyRouter.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = await vacancyService.listVacancies(parsed.data);
  res.json(data);
});

vacancyRouter.post("/upload/preview", uploadDisk.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { message: "file is required (multipart field name: file)" } });
  const lower = (req.file.originalname || "").toLowerCase();
  if (!lower.endsWith(".csv")) {
    return res.status(400).json({ error: { message: "Only .csv files are supported for this upload" } });
  }
  try {
    const { uploadId } = await uploadSessionService.createFromMulterFile(req.file);
    const preview = await vacancyService.previewVacancyCsvFromUpload({ uploadId });
    res.json(preview);
  } catch (e) {
    const status = e?.statusCode ?? 400;
    res.status(status).json({ error: { message: e?.message ?? "Preview failed" } });
  }
});

vacancyRouter.post("/upload/commit", async (req, res) => {
  try {
    const result = await vacancyService.commitMappedVacancyCsv(req.body ?? {});
    res.json(result);
  } catch (e) {
    const status = e?.statusCode ?? 400;
    res.status(status).json({ error: { message: e?.message ?? "Commit failed" } });
  }
});

vacancyRouter.post("/upload", uploadDisk.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { message: "file is required (multipart field name: file)" } });
  const lower = (req.file.originalname || "").toLowerCase();
  if (!lower.endsWith(".csv")) {
    return res.status(400).json({ error: { message: "Only .csv files are supported for this upload" } });
  }
  try {
    const result = await vacancyService.importVacancyCsvFromPath(req.file.path);
    res.json(result);
  } catch (e) {
    const status = e?.statusCode ?? 400;
    res.status(status).json({ error: { message: e?.message ?? "Import failed" } });
  }
});
