import fs from "node:fs";
import { createReadStream } from "node:fs";
import { parse as parseStream } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import { db } from "../db/knex.js";
import { uploadSessionService } from "./upload-session.service.js";

function normalizeHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function buildHeaderMap(headers) {
  const map = new Map();
  for (const h of headers) {
    map.set(normalizeHeader(h), h);
  }
  return map;
}

const VACANCY_COLUMNS = [
  "state_code",
  "state",
  "gender",
  "post_code",
  "force",
  "area",
  "category",
  "category_code",
  "vacancies",
  "initial",
  "current",
  "allocated",
  "left_vacancy",
  "allocated_hc",
  "allocated_hc_prev",
];

const HEADER_ALIASES = {
  state_code: ["s_code", "statecode", "statecode_considered_app"],
  state: ["state_name"],
  category_code: ["c_code", "cat_code"],
  vacancies: ["vac", "vacancy", "vacancy_count", "total_posts"],
  left_vacancy: ["left_vac", "leftvac", "left_vacancies"],
  min_marks: ["co_marks", "cutoff_marks", "cut_off_marks"],
  min_marks_parta: ["co_parta", "cutoff_parta", "cut_off_parta"],
  min_marks_partb: ["co_partb", "cutoff_partb", "cut_off_partb"],
  min_marks_cand_dob: ["co_dob", "cutoff_dob", "cut_off_dob"],
};

const REQUIRED_NORM = new Set([
  "state_code",
  "state",
  "gender",
  "post_code",
  "force",
  "area",
  "category",
  "vacancies",
]);

function requireCol(headerMap, norm) {
  const o = resolveHeader(headerMap, norm);
  if (!o) throw new Error(`Missing CSV column: ${norm.replace(/_/g, " ")}`);
  return o;
}

function resolveHeader(headerMap, norm) {
  if (!headerMap) return null;
  const direct = headerMap.get(norm);
  if (direct) return direct;
  const aliases = HEADER_ALIASES[norm] ?? [];
  for (const alias of aliases) {
    const hit = headerMap.get(alias);
    if (hit) return hit;
  }
  return null;
}

function numOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v) {
  const n = numOrNull(v);
  if (n == null) return null;
  return Math.trunc(n);
}

function intRequired(v, label) {
  const n = intOrNull(v);
  if (n == null) throw new Error(`${label} must be a whole number`);
  return n;
}

function dateOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function csvRowToDb(headerOrMapping, rec, mode = "headerMap") {
  const col = (norm) => {
    if (mode === "mapping") {
      const mapped = headerOrMapping?.[norm];
      return mapped ? rec[mapped] : "";
    }
    const c = resolveHeader(headerOrMapping, norm);
    return c == null ? "" : rec[c];
  };

  const stateCode = String(col("state_code") ?? "").trim();
  const stateName = String(col("state") ?? "").trim();
  const postCode = String(col("post_code") ?? "").trim();
  const forceVal = String(col("force") ?? "").trim();
  const areaVal = String(col("area") ?? "").trim();
  const catVal = String(col("category") ?? "").trim();
  const categoryCodeRaw = intOrNull(col("category_code"));
  const rowKeyRaw = String(col("key") ?? "").trim();
  const genderVal = intRequired(col("gender"), "gender");
  const rowKey =
    rowKeyRaw ||
    [stateCode, genderVal, postCode, forceVal, areaVal, catVal, categoryCodeRaw ?? ""]
      .map((v) => String(v ?? "").trim())
      .join("-");

  if (!stateCode) throw new Error("state_code is required on each row");
  if (!stateName) throw new Error("state is required on each row (used to populate states; not stored on vacancy row)");
  if (!rowKey) throw new Error("key is required on each row");
  if (!postCode) throw new Error("post_code is required on each row");
  if (!forceVal) throw new Error("force is required on each row");
  if (!areaVal) throw new Error("area is required on each row");
  if (!catVal) throw new Error("category is required on each row");

  return {
    _state_name: stateName,
    state_code: stateCode,
    gender: genderVal,
    post_code: postCode,
    force: forceVal,
    area: areaVal,
    category: catVal,
    category_code: categoryCodeRaw,
    vacancies: intOrNull(col("vacancies")),
    initial: intOrNull(col("initial")),
    current_count: intOrNull(col("current")),
    allocated: intOrNull(col("allocated")),
    left_vacancy: intOrNull(col("left_vacancy")),
    allocated_hc: intOrNull(col("allocated_hc")),
    allocated_hc_prev: intOrNull(col("allocated_hc_prev")),
    row_key: rowKey,
    min_marks_prev: null,
    min_marks_parta_prev: null,
    min_marks_partb_prev: null,
    min_marks_cand_dob_prev: null,
    min_marks: null,
    min_marks_parta: null,
    min_marks_partb: null,
    min_marks_cand_dob: null,
  };
}

function validateHeaders(headers) {
  const headerMap = buildHeaderMap(headers);
  for (const norm of REQUIRED_NORM) {
    requireCol(headerMap, norm);
  }
  return headerMap;
}

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

function inferAutoMapping(headers) {
  const mapping = {};
  const normalizedToOriginal = new Map(headers.map((h) => [normalizeHeader(h), h]));
  for (const col of VACANCY_COLUMNS) {
    if (normalizedToOriginal.has(col)) {
      mapping[col] = normalizedToOriginal.get(col);
      continue;
    }
    const aliases = HEADER_ALIASES[col] ?? [];
    for (const alias of aliases) {
      if (normalizedToOriginal.has(alias)) {
        mapping[col] = normalizedToOriginal.get(alias);
        break;
      }
    }
  }
  return mapping;
}

export async function importVacancyCsvFromPath(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const records = parseSync(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  if (!records.length) throw new Error("CSV has no data rows");

  const headers = Object.keys(records[0] ?? {});
  const headerMap = validateHeaders(headers);

  const dbRows = [];
  const statePairs = new Map();
  for (const rec of records) {
    const row = csvRowToDb(headerMap, rec);
    const { _state_name, ...rest } = row;
    statePairs.set(rest.state_code, _state_name);
    dbRows.push(rest);
  }

  const ts = new Date();
  const k = db();
  const chunkSize = 200;

  await k.transaction(async (trx) => {
    for (const [code, name] of statePairs) {
      // eslint-disable-next-line no-await-in-loop
      await trx("states")
        .insert({ state_code: code, state_name: name, created_at: ts, updated_at: ts })
        .onConflict("state_code")
        .merge(["state_name", "updated_at"]);
    }

    for (let i = 0; i < dbRows.length; i += chunkSize) {
      const chunk = dbRows.slice(i, i + chunkSize).map((r) => ({
        ...r,
        created_at: ts,
        updated_at: ts,
      }));
      // eslint-disable-next-line no-await-in-loop
      await trx("vacancy_rows")
        .insert(chunk)
        .onConflict("row_key")
        .merge([
          "state_code",
          "gender",
          "post_code",
          "force",
          "area",
          "category",
          "category_code",
          "vacancies",
          "initial",
          "current_count",
          "allocated",
          "left_vacancy",
          "allocated_hc",
          "allocated_hc_prev",
          "min_marks_prev",
          "min_marks_parta_prev",
          "min_marks_partb_prev",
          "min_marks_cand_dob_prev",
          "min_marks",
          "min_marks_parta",
          "min_marks_partb",
          "min_marks_cand_dob",
          "updated_at",
        ]);
    }
  });

  return {
    ok: true,
    rowsUpserted: dbRows.length,
    statesTouched: statePairs.size,
    rowsInFile: records.length,
  };
}

export async function previewVacancyCsvFromUpload({ uploadId }) {
  const session = uploadSessionService.get(uploadId);
  if (!session?.filePath) {
    const err = new Error("Upload session not found (re-upload vacancy CSV)");
    err.statusCode = 400;
    throw err;
  }

  const { headers, previewRows, totalRows } = await parsePreviewFromFile(session.filePath);
  const autoMapping = inferAutoMapping(headers);
  const unmapped = VACANCY_COLUMNS.filter((c) => !autoMapping[c]);
  return {
    uploadId,
    headers,
    vacancyColumns: VACANCY_COLUMNS,
    autoMapping,
    unmapped,
    previewRows,
    totalRows,
  };
}

export async function commitMappedVacancyCsv({ uploadId, mapping }) {
  const filePath = uploadId ? uploadSessionService.get(uploadId)?.filePath : null;
  if (!filePath) {
    const err = new Error("Upload session not found (re-upload vacancy CSV)");
    err.statusCode = 400;
    throw err;
  }
  if (!mapping || typeof mapping !== "object") {
    const err = new Error("mapping is required");
    err.statusCode = 400;
    throw err;
  }

  const required = ["state_code", "state", "gender", "post_code", "force", "area", "category"];
  for (const r of required) {
    if (!mapping[r]) {
      const err = new Error(`Missing required mapping for ${r}`);
      err.statusCode = 400;
      throw err;
    }
  }

  const k = db();
  const ts = new Date();
  const statePairs = new Map();
  const dbRows = [];

  const errors = [];
  let totalErrors = 0;
  const errorStats = {};

  function addError(row, error) {
    totalErrors += 1;
    errorStats[error] = (errorStats[error] ?? 0) + 1;
    if (errors.length < 2000) errors.push({ row, error });
  }

  let rowNo = 1;
  await new Promise((resolve, reject) => {
    const parser = parseStream(streamParserOptions());
    const rs = createReadStream(filePath);
    parser.on("data", (row) => {
      parser.pause();
      try {
        const allEmpty = Object.values(row ?? {}).every((v) => String(v ?? "").trim() === "");
        if (!allEmpty) {
          const out = csvRowToDb(mapping, row, "mapping");
          const { _state_name, ...rest } = out;
          statePairs.set(rest.state_code, _state_name);
          dbRows.push(rest);
        }
        rowNo += 1;
        parser.resume();
      } catch (e) {
        addError(rowNo, e?.message ?? "Invalid row");
        rowNo += 1;
        parser.resume();
      }
    });
    parser.on("error", reject);
    parser.on("end", resolve);
    rs.on("error", reject);
    rs.pipe(parser);
  });

  if (!dbRows.length && !totalErrors) {
    const err = new Error("CSV has no data rows");
    err.statusCode = 400;
    throw err;
  }

  const chunkSize = 200;
  await k.transaction(async (trx) => {
    for (const [code, name] of statePairs) {
      // eslint-disable-next-line no-await-in-loop
      await trx("states")
        .insert({ state_code: code, state_name: name, created_at: ts, updated_at: ts })
        .onConflict("state_code")
        .merge(["state_name", "updated_at"]);
    }

    for (let i = 0; i < dbRows.length; i += chunkSize) {
      const chunk = dbRows.slice(i, i + chunkSize).map((r) => ({
        ...r,
        created_at: ts,
        updated_at: ts,
      }));
      // eslint-disable-next-line no-await-in-loop
      await trx("vacancy_rows")
        .insert(chunk)
        .onConflict("row_key")
        .merge([
          "state_code",
          "gender",
          "post_code",
          "force",
          "area",
          "category",
          "category_code",
          "vacancies",
          "initial",
          "current_count",
          "allocated",
          "left_vacancy",
          "allocated_hc",
          "allocated_hc_prev",
          "min_marks_prev",
          "min_marks_parta_prev",
          "min_marks_partb_prev",
          "min_marks_cand_dob_prev",
          "min_marks",
          "min_marks_parta",
          "min_marks_partb",
          "min_marks_cand_dob",
          "updated_at",
        ]);
    }
  });

  if (uploadId) await uploadSessionService.cleanup(uploadId);

  if (totalErrors) {
    return {
      ok: false,
      rowsUpserted: dbRows.length,
      statesTouched: statePairs.size,
      totalErrors,
      errorStats,
      errors: errors.slice(0, 2000),
    };
  }

  return {
    ok: true,
    rowsUpserted: dbRows.length,
    statesTouched: statePairs.size,
  };
}

export async function listVacancies({ page = 1, pageSize = 50, q = "" } = {}) {
  const k = db();
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const offset = (p - 1) * ps;
  const term = String(q ?? "").trim();

  let base = k("vacancy_rows as v").leftJoin("states as s", "s.state_code", "v.state_code");
  if (term) {
    const like = `%${term.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    base = base.where((qb) => {
      qb.whereILike("s.state_name", like)
        .orWhereILike("v.state_code", like)
        .orWhereILike("v.post_code", like)
        .orWhereILike("v.force", like)
        .orWhereILike("v.category", like)
        .orWhereILike("v.row_key", like);
    });
  }

  const [{ count }] = await base.clone().clearSelect().clearOrder().count({ count: "*" });
  const total = Number(count) || 0;

  const rows = await base
    .clone()
    .select(
      "v.id",
      "v.state_code",
      "s.state_name",
      "v.gender",
      "v.post_code",
      "v.force",
      "v.area",
      "v.category",
      "v.category_code",
      "v.vacancies",
      "v.initial",
      "v.current_count",
      "v.allocated",
      "v.left_vacancy",
      "v.allocated_hc",
      "v.allocated_hc_prev",
      "v.row_key",
      "v.min_marks_prev",
      "v.min_marks_parta_prev",
      "v.min_marks_partb_prev",
      "v.min_marks_cand_dob_prev",
      "v.min_marks",
      "v.min_marks_parta",
      "v.min_marks_partb",
      "v.min_marks_cand_dob",
      "v.created_at",
      "v.updated_at"
    )
    .orderBy(["v.state_code", "v.force", "v.post_code", "v.category", "v.row_key"])
    .offset(offset)
    .limit(ps);

  const out = rows.map((r) => ({
    id: r.id,
    state_code: r.state_code,
    state_name: r.state_name,
    gender: r.gender,
    post_code: r.post_code,
    force: r.force,
    area: r.area,
    category: r.category,
    category_code: r.category_code,
    vacancies: r.vacancies,
    initial: r.initial,
    current: r.current_count,
    allocated: r.allocated,
    left_vacancy: r.left_vacancy,
    allocated_hc: r.allocated_hc,
    allocated_hc_prev: r.allocated_hc_prev,
    key: r.row_key,
    min_marks_prev: r.min_marks_prev,
    min_marks_parta_prev: r.min_marks_parta_prev,
    min_marks_partb_prev: r.min_marks_partb_prev,
    min_marks_cand_dob_prev: r.min_marks_cand_dob_prev,
    min_marks: r.min_marks,
    min_marks_parta: r.min_marks_parta,
    min_marks_partb: r.min_marks_partb,
    min_marks_cand_dob: r.min_marks_cand_dob,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  return {
    page: p,
    pageSize: ps,
    total,
    rows: out,
  };
}

export const vacancyService = {
  importVacancyCsvFromPath,
  previewVacancyCsvFromUpload,
  commitMappedVacancyCsv,
  listVacancies,
};