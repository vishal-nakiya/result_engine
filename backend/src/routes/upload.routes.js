import { Router } from "express";
import multer from "multer";
import path from "node:path";

import { csvService } from "../services/csv.service.js";
import { stageUploadService } from "../services/stage-upload.service.js";
import { uploadSessionService } from "../services/upload-session.service.js";

export const uploadRouter = Router();

const maxMb = Number(process.env.MAX_UPLOAD_MB ?? 200);
const maxJsonMb = Number(process.env.MAX_JSON_MB ?? maxMb);

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
      cb(null, `upload_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: maxMb * 1024 * 1024 },
});

uploadRouter.post("/csv", uploadDisk.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { message: "file is required" } });

  const { uploadId } = await uploadSessionService.createFromMulterFile(req.file);
  const preview = await csvService.previewCsvFromUpload({ uploadId });
  res.json(preview);
});

uploadRouter.post("/csv/commit", async (req, res) => {
  // Guardrail: prevent accidental huge JSON bodies in old flow.
  if (req.body?.csvText && Buffer.byteLength(String(req.body.csvText), "utf8") > maxJsonMb * 1024 * 1024) {
    return res.status(413).json({
      error: {
        message: `Commit payload too large. Re-upload and commit via uploadId (set MAX_JSON_MB if needed).`,
      },
    });
  }
  const result = await csvService.commitMappedCsv(req.body);
  res.json(result);
});

// PST
uploadRouter.post("/pst", uploadDisk.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { message: "file is required" } });
  const { uploadId } = await uploadSessionService.createFromMulterFile(req.file);
  const preview = await stageUploadService.previewStageFromUpload("pst", { uploadId });
  res.json(preview);
});

uploadRouter.post("/pst/commit", async (req, res) => {
  const result = await stageUploadService.commitStage("pst", req.body);
  res.json(result);
});

// PET
uploadRouter.post("/pet", uploadDisk.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { message: "file is required" } });
  const { uploadId } = await uploadSessionService.createFromMulterFile(req.file);
  const preview = await stageUploadService.previewStageFromUpload("pet", { uploadId });
  res.json(preview);
});

uploadRouter.post("/pet/commit", async (req, res) => {
  const result = await stageUploadService.commitStage("pet", req.body);
  res.json(result);
});

