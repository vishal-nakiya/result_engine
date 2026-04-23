import { createReadStream } from "node:fs";
import { parse as parseStream } from "csv-parse";
import { z } from "zod";
import { db } from "../db/knex.js";
import { newId } from "../db/ids.js";
import { logService } from "./log.service.js";
import { uploadSessionService } from "./upload-session.service.js";

const CANDIDATE_COLUMNS = [
  "registration_no",
  "roll_no",
  "name",
  "dob",
  "gender",
  "category",
  "is_esm",
  "ncc_cert",
  "marks_cbe",
  "normalized_marks",
  "part_a_marks",
  "part_b_marks",
  "part_c_marks",
  "part_d_english_marks",
  "part_d_hindi_marks",
  "ncc_bonus_marks",
  "age_years",
  "arc_code",
  "post_preference",
  "state_code",
  "district_code",
  "state_name",
  "naxal",
  "border",
  "pst_status",
  "pet_status",
  "dv_result",
  "med_result",
  "debarred",
  "withheld",
];

function normalizeHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

const HEADER_ALIASES = {
  roll_no: ["rollno", "rollnumber", "roll_number", "roll_no"],
  registration_no: ["reg_num", "registrationno", "registration_no"],
  name: ["candidate_name", "newname"],
  dob: ["date_of_birth"],
  gender: ["gender_app"],
  category: ["category_app", "cat1"],
  is_esm: ["isesm", "whether_ex_serviceman", "cat2"],
  ncc_cert: ["ncc_type_app", "type_of_ncc_certificate", "ncc_cert"],
  marks_cbe: ["score", "total_marks", "total_marks_new", "part_a", "part_b", "score"],
  normalized_marks: ["normalized_score", "nscore"],
  part_a_marks: ["parta_gi", "part_a"],
  part_b_marks: ["partb_ga", "part_b"],
  part_c_marks: ["part_c"],
  part_d_english_marks: ["part_de"],
  part_d_hindi_marks: ["part_dh"],
  ncc_bonus_marks: ["ncc_bonus"],
  age_years: ["age"],
  arc_code: ["ar_code"],
  post_preference: ["pref", "post_preference"],
  state_code: ["s_code", "statecode_considered_app"],
  district_code: ["d_code"],
  state_name: ["state"],
  naxal: ["naxal", "naxal_district"],
  border: ["border", "border_district"],
  pst_status: ["pst_status"],
  pet_status: ["pet_status"],
  dv_result: ["dv_result"],
  med_result: ["med_result"],
  debarred: ["debarred"],
  withheld: ["withheld"],
};

function inferAutoMapping(headers) {
  const mapping = {};
  const normalizedToOriginal = new Map(headers.map((h) => [normalizeHeader(h), h]));
  for (const col of CANDIDATE_COLUMNS) {
    const preferAlias = col === "gender" || col === "category";

    if (preferAlias && HEADER_ALIASES[col]) {
      for (const a of HEADER_ALIASES[col]) {
        if (normalizedToOriginal.has(a)) {
          mapping[col] = normalizedToOriginal.get(a);
          break;
        }
      }
    }

    if (!mapping[col] && normalizedToOriginal.has(col)) mapping[col] = normalizedToOriginal.get(col);
    if (!mapping[col] && HEADER_ALIASES[col]) {
      for (const a of HEADER_ALIASES[col]) {
        if (normalizedToOriginal.has(a)) {
          mapping[col] = normalizedToOriginal.get(a);
          break;
        }
      }
    }
  }
  return mapping;
}

function buildPreviewRows(records, limit = 25) {
  return records.slice(0, limit);
}

function stripDeprecatedCols(cols = []) {
  const deprecated = new Set(["father_name", "domicile_state", "district", "height", "chest", "weight", "is_pwd", "status"]);
  return cols.filter((c) => !deprecated.has(String(c)));
}

const commitSchema = z
  .object({
    // New flow (recommended): uploadId points to a server-side temp file
    uploadId: z.string().min(1).optional(),
    // Old flow: frontend sends entire CSV as text (kept for backward compat)
    csvText: z.string().min(1).optional(),
    mapping: z.record(z.string(), z.string()), // db_col -> csv_header
    stage: z.string().optional(),
  })
  .refine((v) => Boolean(v.uploadId) || Boolean(v.csvText), { message: "uploadId or csvText is required" });

function streamParserOptions() {
  return {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
  };
}

async function parsePreviewFromFile(filePath, limit = 25) {
  const records = [];
  let headers = [];
  let totalRows = 0;

  await new Promise((resolve, reject) => {
    const parser = parseStream(streamParserOptions());
    const rs = createReadStream(filePath);

    parser.on("readable", () => {
      let record;
      // eslint-disable-next-line no-cond-assign
      while ((record = parser.read())) {
        totalRows += 1;
        if (!headers.length) headers = Object.keys(record);
        if (records.length < limit) records.push(record);
      }
    });
    parser.on("error", reject);
    parser.on("end", resolve);
    rs.on("error", reject);
    rs.pipe(parser);
  });

  return { headers, previewRows: records, totalRows };
}

function parseBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "t" || s === "1" || s === "yes" || s === "y" || s === "positive" || s === "p") return true;
  if (s === "false" || s === "f" || s === "0" || s === "no" || s === "n" || s === "") return false;
  return null;
}

function normalizeNccCert(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const s = raw.toUpperCase();
  // If already a single letter, accept directly
  if (s === "A" || s === "B" || s === "C") return s;
  // Otherwise extract A/B/C from common strings like:
  // "NCC 'C' Certificate", "NCC C", "CERTIFICATE B", etc.
  const m = s.match(/\b([ABC])\b/);
  if (m) return m[1];
  // Fallback: if contains "A"/"B"/"C" anywhere, pick first occurrence (rare messy exports)
  for (const ch of ["A", "B", "C"]) {
    if (s.includes(ch)) return ch;
  }
  return null;
}

function parseDateDDMMYYYY(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // accept DD-MM-YYYY or DD/MM/YYYY or ISO
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) {
    const [_, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`; // date-only (no timezone)
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`; // normalize to date-only
  return null;
}

function normalizeStatus(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "cleared" || s === "rejected" || s === "debarred" || s === "withheld" || s === "tu") return s;
  return null;
}

function normalizeGender(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "2" || s === "M" || s === "MALE") return "M";
  if (s === "1" || s === "F" || s === "FEMALE") return "F";
  if (s === "3" || s === "O" || s === "OTHER") return "O";
  return null;
}

function normalizeCategory(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (["UR", "OBC", "SC", "ST", "EWS"].includes(s)) return s;
  if (s === "1") return "SC";
  if (s === "2") return "ST";
  if (s === "6") return "OBC";
  // Master sheet defines CAT1=9 as UR.
  if (s === "9" || s === "0") return "UR";
  return null;
}

function normalizeEsm(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return false;
  if (s === "3") return true;
  if (["Y", "YES", "TRUE", "T", "1"].includes(s)) return true;
  if (["N", "NO", "FALSE", "F", "0"].includes(s)) return false;
  return false;
}

export const csvService = {
  async previewCsvFromUpload({ uploadId }) {
    const session = uploadSessionService.get(uploadId);
    if (!session?.filePath) {
      const err = new Error("Upload session not found (re-upload CSV)");
      err.statusCode = 400;
      throw err;
    }

    const { headers, previewRows, totalRows } = await parsePreviewFromFile(session.filePath);
    const candidateColumns = stripDeprecatedCols(CANDIDATE_COLUMNS);
    const autoMappingRaw = inferAutoMapping(headers);
    const autoMapping = Object.fromEntries(
      Object.entries(autoMappingRaw).filter(([k]) => candidateColumns.includes(k))
    );
    const unmapped = candidateColumns.filter((c) => !autoMapping[c]);
    await logService.write("info", "CSV preview generated", { rows: totalRows });
    return {
      uploadId,
      headers,
      candidateColumns,
      autoMapping,
      unmapped,
      previewRows,
      totalRows,
    };
  },

  async commitMappedCsv(body) {
    const parsed = commitSchema.safeParse(body);
    if (!parsed.success) {
      const err = new Error("Invalid commit payload");
      err.statusCode = 400;
      err.details = parsed.error.flatten();
      throw err;
    }

    const { uploadId, csvText, mapping, stage } = parsed.data;
    const filePath = uploadId ? uploadSessionService.get(uploadId)?.filePath : null;
    if (uploadId && !filePath) {
      const err = new Error("Upload session not found (re-upload CSV)");
      err.statusCode = 400;
      throw err;
    }

    const k = db();
    const hasRawData = await k.schema.hasColumn("candidates", "raw_data");
    if (!hasRawData) {
      // Keep all CSV fields without forcing a wide schema.
      await k.schema.alterTable("candidates", (t) => {
        t.jsonb("raw_data").nullable();
      });
    }

    const required = ["roll_no", "name", "dob", "gender", "category"];
    for (const r of required) {
      if (!mapping[r]) {
        const err = new Error(`Missing required mapping for ${r}`);
        err.statusCode = 400;
        throw err;
      }
    }

    const seenRoll = new Set();
    const errors = [];
    let totalErrors = 0;
    const errorStats = {};
    let inserted = 0;

    const batchSize = Number(process.env.CSV_INSERT_BATCH_SIZE ?? 1000);
    const pending = [];

    const now = new Date();

    function addError(row, error) {
      totalErrors += 1;
      errorStats[error] = (errorStats[error] ?? 0) + 1;
      if (errors.length < 2000) errors.push({ row, error });
    }

    async function flushBatch() {
      if (!pending.length) return;

      // DB duplicate check by rollNo (chunked)
      const rollNos = pending.map((r) => r.roll_no);
      const existing = await k("candidates").whereIn("roll_no", rollNos).select(["roll_no as rollNo"]);
      const existingSet = new Set(existing.map((r) => String(r.rollNo)));
      const rowsToInsert = pending.filter((r) => !existingSet.has(String(r.roll_no)));

      if (existingSet.size) {
        for (const rollNo of existingSet) {
          addError(null, `roll_no already exists: ${rollNo}`);
        }
      }

      if (rowsToInsert.length) {
        await k("candidates").insert(rowsToInsert);
        inserted += rowsToInsert.length;
      }
      pending.length = 0;
    }

    const consumeRecord = async (row, rowNo) => {
      // Some SSC exports contain thousands of trailing comma-only rows.
      // Treat fully-empty records as non-data and skip without counting as an error.
      const allEmpty = Object.values(row ?? {}).every((v) => String(v ?? "").trim() === "");
      if (allEmpty) return;

      const get = (col) => row[mapping[col]];

      const rollNo = String(get("roll_no") ?? "").trim();
      const registrationNo = mapping.registration_no ? String(get("registration_no") ?? "").trim() : "";
      const name = String(get("name") ?? "").trim();
      const dob = parseDateDDMMYYYY(get("dob"));
      const gender = normalizeGender(get("gender"));
      const category = normalizeCategory(get("category"));

      if (!rollNo || !name || !dob || !gender || !category) {
        addError(rowNo, "Missing required fields");
        return;
      }
      if (seenRoll.has(rollNo)) {
        addError(rowNo, "Duplicate roll_no in file");
        return;
      }
      seenRoll.add(rollNo);

      const isPwd = parseBool(get("is_pwd"));
      if (isPwd === null) {
        addError(rowNo, "Invalid is_pwd value");
        return;
      }

      const data = {
        id: newId(),
        roll_no: rollNo,
        registration_no: registrationNo || null,
        name,
        father_name: mapping.father_name ? String(get("father_name") ?? "").trim() || null : null,
        dob,
        gender,
        category,
        is_esm: mapping.is_esm ? normalizeEsm(get("is_esm")) : false,
        domicile_state: mapping.domicile_state ? String(get("domicile_state") ?? "").trim() || null : null,
        district: mapping.district ? String(get("district") ?? "").trim() || null : null,
        height: mapping.height ? Number(get("height") ?? NaN) : null,
        chest: mapping.chest ? Number(get("chest") ?? NaN) : null,
        weight: mapping.weight ? Number(get("weight") ?? NaN) : null,
        is_pwd: isPwd,
        ncc_cert: mapping.ncc_cert ? normalizeNccCert(get("ncc_cert")) : null,
        marks_cbe: mapping.marks_cbe ? Number(get("marks_cbe") ?? NaN) : null,
        normalized_marks: mapping.normalized_marks ? Number(get("normalized_marks") ?? NaN) : null,
        part_a_marks: mapping.part_a_marks ? Number(get("part_a_marks") ?? NaN) : null,
        part_b_marks: mapping.part_b_marks ? Number(get("part_b_marks") ?? NaN) : null,
        part_c_marks: mapping.part_c_marks ? Number(get("part_c_marks") ?? NaN) : null,
        part_d_english_marks: mapping.part_d_english_marks ? Number(get("part_d_english_marks") ?? NaN) : null,
        part_d_hindi_marks: mapping.part_d_hindi_marks ? Number(get("part_d_hindi_marks") ?? NaN) : null,
        ncc_bonus_marks: mapping.ncc_bonus_marks ? Number(get("ncc_bonus_marks") ?? NaN) : null,
        age_years: mapping.age_years ? Number(get("age_years") ?? NaN) : null,
        arc_code: mapping.arc_code ? String(get("arc_code") ?? "").trim() || null : null,
        post_preference: mapping.post_preference ? String(get("post_preference") ?? "").trim() || null : null,
        state_code: mapping.state_code ? String(get("state_code") ?? "").trim() || null : null,
        district_code: mapping.district_code ? String(get("district_code") ?? "").trim() || null : null,
        state_name: mapping.state_name ? String(get("state_name") ?? "").trim() || null : null,
        naxal: mapping.naxal ? parseBool(get("naxal")) : null,
        border: mapping.border ? parseBool(get("border")) : null,
        pst_status: mapping.pst_status ? String(get("pst_status") ?? "").trim().toUpperCase() || null : null,
        pet_status: mapping.pet_status ? String(get("pet_status") ?? "").trim().toUpperCase() || null : null,
        dv_result: mapping.dv_result ? String(get("dv_result") ?? "").trim().toUpperCase() || null : null,
        // DME/medical defaults to Fit/Qualified when missing.
        med_result: mapping.med_result
          ? (String(get("med_result") ?? "").trim().toUpperCase() || "Q")
          : "Q",
        debarred: mapping.debarred ? parseBool(get("debarred")) : null,
        withheld: mapping.withheld ? parseBool(get("withheld")) : null,
        status: normalizeStatus(mapping.status ? get("status") : null) ?? "withheld",
        raw_data: JSON.stringify(stage ? { ...row, _upload_meta: { stage } } : row),
        created_at: now,
        updated_at: now,
      };

      for (const n of [
        "height",
        "chest",
        "weight",
        "marks_cbe",
        "normalized_marks",
        "part_a_marks",
        "part_b_marks",
        "part_c_marks",
        "part_d_english_marks",
        "part_d_hindi_marks",
        "ncc_bonus_marks",
        "age_years",
      ]) {
        if (data[n] == null) continue;
        if (!Number.isFinite(data[n])) {
          addError(rowNo, `Invalid number for ${n}`);
          return;
        }
      }

      pending.push(data);
      if (pending.length >= batchSize) await flushBatch();
    };

    if (filePath) {
      let rowNo = 1;
      await new Promise((resolve, reject) => {
        const parser = parseStream(streamParserOptions());
        const rs = createReadStream(filePath);
        parser.on("data", async (row) => {
          parser.pause();
          try {
            await consumeRecord(row, rowNo);
            rowNo += 1;
            parser.resume();
          } catch (e) {
            reject(e);
          }
        });
        parser.on("error", reject);
        parser.on("end", resolve);
        rs.on("error", reject);
        rs.pipe(parser);
      });
    } else {
      // Backward compat (small files only)
      const lines = String(csvText).split(/\r?\n/);
      const tmp = lines.join("\n");
      let rowNo = 1;
      await new Promise((resolve, reject) => {
        const parser = parseStream(streamParserOptions());
        parser.on("data", async (row) => {
          parser.pause();
          try {
            await consumeRecord(row, rowNo);
            rowNo += 1;
            parser.resume();
          } catch (e) {
            reject(e);
          }
        });
        parser.on("error", reject);
        parser.on("end", resolve);
        parser.write(tmp);
        parser.end();
      });
    }

    await flushBatch();

    if (totalErrors) {
      return { ok: false, inserted, errors: errors.slice(0, 2000), totalErrors, errorStats };
    }

    await logService.write("info", "CSV committed to candidates", { inserted });
    if (uploadId) await uploadSessionService.cleanup(uploadId);
    return { ok: true, inserted };
  },
};

