import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { db } from "../db/knex.js";

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

const REQUIRED_NORM = new Set([
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
  "key",
  "min_marks_prev",
  "min_marks_parta_prev",
  "min_marks_partb_prev",
  "min_marks_cand_dob_prev",
  "min_marks",
  "min_marks_parta",
  "min_marks_partb",
  "min_marks_cand_dob",
]);

function requireCol(headerMap, norm) {
  const o = headerMap.get(norm);
  if (!o) throw new Error(`Missing CSV column: ${norm.replace(/_/g, " ")}`);
  return o;
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

function csvRowToDb(headerMap, rec) {
  const col = (norm) => {
    const c = headerMap.get(norm);
    return c == null ? "" : rec[c];
  };

  const stateCode = String(col("state_code") ?? "").trim();
  const stateName = String(col("state") ?? "").trim();
  const rowKey = String(col("key") ?? "").trim();

  if (!stateCode) throw new Error("state_code is required on each row");
  if (!stateName) throw new Error("state is required on each row (used to populate states; not stored on vacancy row)");
  if (!rowKey) throw new Error("key is required on each row");

  const postCode = String(col("post_code") ?? "").trim();
  const forceVal = String(col("force") ?? "").trim();
  const areaVal = String(col("area") ?? "").trim();
  const catVal = String(col("category") ?? "").trim();
  if (!postCode) throw new Error("post_code is required on each row");
  if (!forceVal) throw new Error("force is required on each row");
  if (!areaVal) throw new Error("area is required on each row");
  if (!catVal) throw new Error("category is required on each row");

  return {
    _state_name: stateName,
    state_code: stateCode,
    gender: intRequired(col("gender"), "gender"),
    post_code: postCode,
    force: forceVal,
    area: areaVal,
    category: catVal,
    category_code: intOrNull(col("category_code")),
    vacancies: intOrNull(col("vacancies")),
    initial: intOrNull(col("initial")),
    current_count: intOrNull(col("current")),
    allocated: intOrNull(col("allocated")),
    left_vacancy: intOrNull(col("left_vacancy")),
    allocated_hc: intOrNull(col("allocated_hc")),
    allocated_hc_prev: intOrNull(col("allocated_hc_prev")),
    row_key: rowKey,
    min_marks_prev: numOrNull(col("min_marks_prev")),
    min_marks_parta_prev: numOrNull(col("min_marks_parta_prev")),
    min_marks_partb_prev: numOrNull(col("min_marks_partb_prev")),
    min_marks_cand_dob_prev: dateOrNull(col("min_marks_cand_dob_prev")),
    min_marks: numOrNull(col("min_marks")),
    min_marks_parta: numOrNull(col("min_marks_parta")),
    min_marks_partb: numOrNull(col("min_marks_partb")),
    min_marks_cand_dob: dateOrNull(col("min_marks_cand_dob")),
  };
}

function validateHeaders(headers) {
  const headerMap = buildHeaderMap(headers);
  for (const norm of REQUIRED_NORM) {
    requireCol(headerMap, norm);
  }
  return headerMap;
}

export async function importVacancyCsvFromPath(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const records = parse(raw, {
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
  listVacancies,
};