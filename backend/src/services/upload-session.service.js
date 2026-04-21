import fs from "node:fs/promises";
import path from "node:path";
import { newId } from "../db/ids.js";

const sessions = new Map();

function uploadsDir() {
  // Keep under project directory so it's easy to clean.
  return path.resolve(process.cwd(), "var", "uploads");
}

export const uploadSessionService = {
  async ensureDir() {
    await fs.mkdir(uploadsDir(), { recursive: true });
    return uploadsDir();
  },

  async createFromMulterFile(file) {
    if (!file?.path) throw new Error("Upload file path missing");
    const id = newId();
    const expiresAt = Date.now() + Number(process.env.UPLOAD_SESSION_TTL_MS ?? 6 * 60 * 60 * 1000); // 6h
    sessions.set(id, {
      id,
      filePath: file.path,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      createdAt: Date.now(),
      expiresAt,
    });
    return { uploadId: id };
  },

  get(uploadId) {
    const s = sessions.get(uploadId);
    if (!s) return null;
    if (s.expiresAt && Date.now() > s.expiresAt) {
      sessions.delete(uploadId);
      return null;
    }
    return s;
  },

  async cleanup(uploadId) {
    const s = sessions.get(uploadId);
    sessions.delete(uploadId);
    if (s?.filePath) {
      try {
        await fs.unlink(s.filePath);
      } catch {
        // ignore
      }
    }
  },
};

