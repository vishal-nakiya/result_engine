import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import "dotenv/config";
import { db } from "../src/db/knex.js";
import { newId } from "../src/db/ids.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readCsvIfExists(csvPath) {
  if (!fs.existsSync(csvPath)) return null;
  const text = fs.readFileSync(csvPath, "utf8");
  return parse(text, { columns: true, skip_empty_lines: true, trim: true });
}

function parseBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n" || s === "") return false;
  return false;
}

function parseDateDDMMYYYY(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) {
    const [_, dd, mm, yyyy] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;
  return null;
}

async function ensureCutoffs(k) {
  const rows = [
    { category: "UR", min_percentage: 30 },
    { category: "OBC", min_percentage: 25 },
    { category: "EWS", min_percentage: 25 },
    { category: "SC", min_percentage: 20 },
    { category: "ST", min_percentage: 20 },
  ];
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    await k("cutoff_marks")
      .insert(r)
      .onConflict("category")
      .merge({ min_percentage: r.min_percentage });
  }
}

async function main() {
  const k = db();
  await ensureCutoffs(k);

  const repoRoot = path.resolve(__dirname, "..");
  const dbDir = path.join(repoRoot, "db");

  const candidatesCsv = readCsvIfExists(path.join(dbDir, "sample_data_set.csv"));
  if (candidatesCsv?.length) {
    const now = new Date();
    const data = candidatesCsv
      .map((r) => ({
        id: newId(),
        roll_no: String(r.roll_no ?? r.rollNo ?? "").trim(),
        name: String(r.name ?? "").trim(),
        father_name: String(r.father_name ?? r.fatherName ?? "").trim() || null,
        dob: parseDateDDMMYYYY(r.dob),
        gender: String(r.gender ?? "").trim(),
        category: String(r.category ?? "UR").trim().toUpperCase(),
        is_esm: parseBool(r.is_esm),
        domicile_state: String(r.domicile_state ?? "").trim() || null,
        district: String(r.district ?? "").trim() || null,
        height: r.height ? Number(r.height) : null,
        chest: r.chest ? Number(r.chest) : null,
        weight: r.weight ? Number(r.weight) : null,
        is_pwd: parseBool(r.is_pwd),
        ncc_cert: String(r.ncc_cert ?? "").trim() || null,
        marks_cbe: r.marks_cbe ? Number(r.marks_cbe) : null,
        normalized_marks: r.normalized_marks ? Number(r.normalized_marks) : null,
        part_a_marks: r.part_a_marks ? Number(r.part_a_marks) : null,
        part_b_marks: r.part_b_marks ? Number(r.part_b_marks) : null,
        status: String(r.status ?? "withheld").trim(),
        created_at: now,
        updated_at: now,
      }))
      .filter((r) => r.roll_no && r.name && r.dob && r.gender && r.category);

    if (data.length) {
      await k("candidates").insert(data).onConflict("roll_no").ignore();
      // eslint-disable-next-line no-console
      console.log(`Seeded candidates: ${data.length}`);
    }
  }

  const vacancyCsv = readCsvIfExists(path.join(dbDir, "vacancy.csv"));
  if (vacancyCsv?.length) {
    const data = vacancyCsv.map((r) => ({
      id: newId(),
      force_code: String(r.force_code ?? r.forceCode ?? "").trim().toUpperCase(),
      force_name: String(r.force_name ?? r.forceName ?? "").trim(),
      state: String(r.state ?? "").trim(),
      district: String(r.district ?? "").trim(),
      category: String(r.category ?? "UR").trim().toUpperCase(),
      gender: String(r.gender ?? "").trim(),
      total_posts: Number(r.total_posts ?? r.totalPosts ?? 0),
      esm_reserved: Number(r.esm_reserved ?? r.esmReserved ?? 0),
    }));
    await k("vacancy").insert(data);
    // eslint-disable-next-line no-console
    console.log(`Seeded vacancy: ${data.length}`);
  }

  await k.destroy();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

