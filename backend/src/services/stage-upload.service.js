import { createReadStream } from "node:fs";
import { parse as parseStream } from "csv-parse";
import { z } from "zod";
import { db } from "../db/knex.js";
import { newId } from "../db/ids.js";
import { logService } from "./log.service.js";
import { uploadSessionService } from "./upload-session.service.js";

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

function normalizeHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function inferAutoMapping(headers, dbCols, headerAliases = {}) {
  const mapping = {};
  const normalizedToOriginal = new Map(headers.map((h) => [normalizeHeader(h), h]));
  for (const col of dbCols) {
    if (normalizedToOriginal.has(col)) mapping[col] = normalizedToOriginal.get(col);
    if (!mapping[col] && headerAliases[col]) {
      for (const a of headerAliases[col]) {
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

function parseBoolLoose(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y" || s === "t") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n" || s === "" || s === "f") return false;
  return null;
}

function parseNum(v) {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return n;
}

const STAGES = {
  pst: {
    title: "PST",
    table: "pst_results",
    dbCols: [
      "roll_no",
      "registrationNo",
      "status",
      "height",
      "chest_not_expanded",
      "chest_expanded",
      "weight",
      "ht_rlx_code",
      "chst_rlx_code",
      "height_relax",
      "chest_relax",
      "height_chest_relax",
      "final_pet_pst_status",
      "remarks",
      "pregnant",
    ],
    requiredAnyOf: [["roll_no", "registrationNo"]],
    headerAliases: {
      roll_no: ["rollno", "rollnumber", "roll_no"],
      registrationNo: ["registrationno", "registration_no"],
      status: ["pst_status", "final_pet_pst_status"],
      height: ["pst_height"],
      chest_not_expanded: ["pst_chest_not_expanded"],
      chest_expanded: ["pst_chest_expanded"],
      weight: ["pst_weight"],
      ht_rlx_code: ["ht_rlx_code"],
      chst_rlx_code: ["chst_rlx_code"],
      height_relax: ["height_relax"],
      chest_relax: ["chest_relax"],
      height_chest_relax: ["height_chest_relax"],
      final_pet_pst_status: ["final_pet_pst_status"],
      remarks: ["final_remarks", "remarks"],
      pregnant: ["pregnant", "pregnancy", "positive_pregnancy_test"],
    },
  },
  pet: {
    title: "PET",
    table: "pet_results",
    dbCols: ["roll_no", "registrationNo", "status", "remarks", "pregnant"],
    requiredAnyOf: [["roll_no", "registrationNo"]],
    headerAliases: {
      roll_no: ["rollno", "rollnumber", "roll_no"],
      registrationNo: ["registrationno", "registration_no"],
      status: ["pet_status"],
      remarks: ["final_remarks", "remarks"],
      pregnant: ["pregnant", "pregnancy", "positive_pregnancy_test"],
    },
  },
};

const commitSchema = z
  .object({
    uploadId: z.string().min(1).optional(),
    csvText: z.string().min(1).optional(),
    mapping: z.record(z.string(), z.string()),
    examType: z.string().optional(),
  })
  .refine((v) => Boolean(v.uploadId) || Boolean(v.csvText), { message: "uploadId or csvText is required" });

export const stageUploadService = {
  async previewStageFromUpload(stageKey, { uploadId }) {
    const stage = STAGES[stageKey];
    if (!stage) {
      const err = new Error("Unknown stage");
      err.statusCode = 400;
      throw err;
    }

    const session = uploadSessionService.get(uploadId);
    if (!session?.filePath) {
      const err = new Error("Upload session not found (re-upload CSV)");
      err.statusCode = 400;
      throw err;
    }

    const { headers, previewRows, totalRows } = await parsePreviewFromFile(session.filePath);
    const autoMapping = inferAutoMapping(headers, stage.dbCols, stage.headerAliases);
    const unmapped = stage.dbCols.filter((c) => !autoMapping[c]);
    await logService.write("info", "Stage CSV preview generated", { stage: stageKey, rows: totalRows });

    return {
      uploadId,
      headers,
      candidateColumns: stage.dbCols,
      autoMapping,
      unmapped,
      previewRows,
      totalRows,
      stage: stageKey,
    };
  },

  async commitStage(stageKey, body) {
    const stage = STAGES[stageKey];
    if (!stage) {
      const err = new Error("Unknown stage");
      err.statusCode = 400;
      throw err;
    }

    const parsed = commitSchema.safeParse(body);
    if (!parsed.success) {
      const err = new Error("Invalid commit payload");
      err.statusCode = 400;
      err.details = parsed.error.flatten();
      throw err;
    }

    const { uploadId, csvText, mapping, examType } = parsed.data;
    const filePath = uploadId ? uploadSessionService.get(uploadId)?.filePath : null;
    if (uploadId && !filePath) {
      const err = new Error("Upload session not found (re-upload CSV)");
      err.statusCode = 400;
      throw err;
    }
    const ex = String(examType ?? "CAPF_GD_2025").trim() || "CAPF_GD_2025";

    // require at least one identifier mapping
    const idOk = Boolean(mapping.roll_no) || Boolean(mapping.registrationNo);
    if (!idOk) {
      const err = new Error("Missing mapping: roll_no OR registrationNo is required");
      err.statusCode = 400;
      throw err;
    }

    const k = db();
    const now = new Date();

    const errors = [];
    const batchSize = Number(process.env.CSV_STAGE_BATCH_SIZE ?? 1000);
    let inserted = 0;
    let updated = 0;

    const pending = [];
    let rowNo = 1;

    async function flushBatch() {
      if (!pending.length) return;

      const rollNos = pending.map((r) => r.rollNo).filter(Boolean);
      const regNos = pending.map((r) => r.registrationNo).filter(Boolean);

      const candidateByRoll = new Map();
      if (rollNos.length) {
        const rows = await k("candidates").whereIn("roll_no", rollNos).select(["id", "roll_no as rollNo"]);
        for (const r of rows) candidateByRoll.set(String(r.rollNo), r.id);
      }

      const candidateByReg = new Map();
      if (regNos.length) {
        const rows = await k("candidates")
          .whereIn(k.raw("(raw_data->>'registrationNo')"), regNos)
          .select(["id", k.raw("(raw_data->>'registrationNo') as regNo")]);
        for (const r of rows) candidateByReg.set(String(r.regno ?? r.regNo ?? ""), r.id);
      }

      const upsertRows = [];
      for (const r of pending) {
        const id = (r.rollNo && candidateByRoll.get(r.rollNo)) || (r.registrationNo && candidateByReg.get(r.registrationNo)) || null;
        if (!id) {
          if (errors.length < 2000) {
            errors.push({
              row: r._rowNo,
              error: `Candidate not found for ${r.rollNo ? `roll_no=${r.rollNo}` : `registrationNo=${r.registrationNo}`}`,
            });
          }
          continue;
        }

        if (stageKey === "pst") {
          upsertRows.push({
            id: newId(),
            candidate_id: id,
            exam_type: ex,
            status: r.status,
            height: r.height,
            chest_not_expanded: r.chestNotExpanded,
            chest_expanded: r.chestExpanded,
            weight: r.weight,
            ht_rlx_code: r.htRlxCode,
            chst_rlx_code: r.chstRlxCode,
            height_relax: r.heightRelax,
            chest_relax: r.chestRelax,
            height_chest_relax: r.heightChestRelax,
            final_pet_pst_status: r.finalPetPstStatus,
            remarks: r.remarks,
            pregnant: r.pregnant,
            raw_data: JSON.stringify(r.rawData),
            created_at: now,
            updated_at: now,
          });
        } else if (stageKey === "pet") {
          upsertRows.push({
            id: newId(),
            candidate_id: id,
            exam_type: ex,
            status: r.status,
            remarks: r.remarks,
            pregnant: r.pregnant,
            raw_data: JSON.stringify(r.rawData),
            created_at: now,
            updated_at: now,
          });
        }
      }

      if (upsertRows.length) {
        const conflictCols = ["candidate_id", "exam_type"];
        const updateCols =
          stageKey === "pst"
            ? [
                "status",
                "height",
                "chest_not_expanded",
                "chest_expanded",
                "weight",
                "ht_rlx_code",
                "chst_rlx_code",
                "height_relax",
                "chest_relax",
                "height_chest_relax",
                "final_pet_pst_status",
                "remarks",
                "pregnant",
                "raw_data",
                "updated_at",
              ]
            : ["status", "remarks", "pregnant", "raw_data", "updated_at"];

        // Postgres: one query does insert or update.
        await k(stage.table).insert(upsertRows).onConflict(conflictCols).merge(updateCols);
        // We can't reliably split inserted vs updated without extra queries; report as "updated" approximated.
        inserted += upsertRows.length;
      }

      pending.length = 0;
    }

    const consumeRow = async (row, _rowNo) => {
      const get = (col) => (mapping[col] ? row[mapping[col]] : undefined);

      const rollNo = mapping.roll_no ? String(get("roll_no") ?? "").trim() : "";
      const regNo = mapping.registrationNo ? String(get("registrationNo") ?? "").trim() : "";

      if (!rollNo && !regNo) {
        if (errors.length < 2000) errors.push({ row: _rowNo, error: "Missing roll_no/registrationNo" });
        return;
      }

      pending.push({
        _rowNo,
        rollNo: rollNo || null,
        registrationNo: regNo || null,
        status: String(get("status") ?? "").trim() || null,
        height: parseNum(get("height")),
        chestNotExpanded: parseNum(get("chest_not_expanded")),
        chestExpanded: parseNum(get("chest_expanded")),
        weight: parseNum(get("weight")),
        htRlxCode: String(get("ht_rlx_code") ?? "").trim() || null,
        chstRlxCode: String(get("chst_rlx_code") ?? "").trim() || null,
        heightRelax: mapping.height_relax ? parseBoolLoose(get("height_relax")) : null,
        chestRelax: mapping.chest_relax ? parseBoolLoose(get("chest_relax")) : null,
        heightChestRelax: mapping.height_chest_relax ? parseBoolLoose(get("height_chest_relax")) : null,
        finalPetPstStatus: String(get("final_pet_pst_status") ?? "").trim() || null,
        remarks: String(get("remarks") ?? "").trim() || null,
        pregnant: mapping.pregnant ? parseBoolLoose(get("pregnant")) : null,
        rawData: row,
      });

      if (pending.length >= batchSize) await flushBatch();
    };

    if (filePath) {
      await new Promise((resolve, reject) => {
        const parser = parseStream(streamParserOptions());
        const rs = createReadStream(filePath);
        parser.on("data", async (row) => {
          parser.pause();
          try {
            await consumeRow(row, rowNo);
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
      await new Promise((resolve, reject) => {
        const parser = parseStream(streamParserOptions());
        parser.on("data", async (row) => {
          parser.pause();
          try {
            await consumeRow(row, rowNo);
            rowNo += 1;
            parser.resume();
          } catch (e) {
            reject(e);
          }
        });
        parser.on("error", reject);
        parser.on("end", resolve);
        parser.write(String(csvText));
        parser.end();
      });
    }

    await flushBatch();

    if (errors.length) {
      return { ok: false, inserted, updated, errors: errors.slice(0, 2000), totalErrors: errors.length };
    }

    await logService.write("info", "Stage CSV committed", { stage: stageKey, examType: ex, inserted, updated });
    if (uploadId) await uploadSessionService.cleanup(uploadId);
    return { ok: true, stage: stageKey, examType: ex, inserted, updated };
  },
};

