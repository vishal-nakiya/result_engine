import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";

import { apiRouter } from "./routes/index.js";
import { closeDb } from "./db/close.js";
import { runSqlMigrations } from "./db/migrations.js";

const app = express();

const maxJsonMb = Number(process.env.MAX_JSON_MB ?? process.env.MAX_UPLOAD_MB ?? 25);

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN?.split(",").map((s) => s.trim()) ?? "*",
    credentials: true,
  })
);
app.use(express.json({ limit: `${maxJsonMb}mb` }));
app.use(express.urlencoded({ extended: true, limit: `${maxJsonMb}mb` }));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  })
);
app.use(
  pinoHttp({
    redact: ["req.headers.authorization"],
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", apiRouter);

app.use((err, _req, res, _next) => {
  const status = err?.statusCode ?? 500;
  res.status(status).json({
    error: {
      message: err?.message ?? "Internal Server Error",
    },
  });
});

const port = Number(process.env.PORT ?? 4000);

async function main() {
  const shouldMigrate = String(process.env.RUN_MIGRATIONS_ON_START ?? "true").toLowerCase() !== "false";
  if (shouldMigrate) {
    await runSqlMigrations();
  }
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on :${port}`);
  });
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  await closeDb();
  process.exit(1);
});

process.on("SIGINT", async () => {
  await closeDb();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await closeDb();
  process.exit(0);
});

