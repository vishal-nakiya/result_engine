import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { db } from "../db/knex.js";

const REQUIRED_NORMALIZED = new Set([
  "stateid",
  "statename",
  "statecode",
  "distid",
  "distcode",
  "districtname",
  "description",
  "createdbyid",
  "createdbyroleid",
  "updatedbyid",
  "isactive",
  "ipaddress",
  "isnaxaldistrict",
  "isboarderdistrict",
  "present_active",
]);

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

function requireColumn(headerMap, normKey) {
  const orig = headerMap.get(normKey);
  if (!orig) throw new Error(`Missing required column (expected like "${normKey.replace(/_/g, " ")}")`);
  return orig;
}

function parseBool(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (["t", "true", "1", "yes", "y"].includes(s)) return true;
  if (["f", "false", "0", "no", "n"].includes(s)) return false;
  return null;
}

function parseBoolDefault(v, defaultValue = false) {
  const b = parseBool(v);
  return b == null ? defaultValue : b;
}

function rowToRecord(headerMap, record) {
  const g = (norm) => {
    const col = headerMap.get(norm);
    if (!col) return "";
    return record[col];
  };

  const stateId = String(g("stateid") ?? "").trim();
  const stateName = String(g("statename") ?? "").trim();
  const stateCode = String(g("statecode") ?? "").trim();
  const distId = String(g("distid") ?? "").trim();
  const distCode = String(g("distcode") ?? "").trim();
  const districtName = String(g("districtname") ?? "").trim();

  if (!stateId || !stateName || !stateCode || !distId || !districtName) {
    throw new Error("Each row must have stateId, stateName, stateCode, distId, and districtName");
  }

  return {
    state_id: stateId,
    state_name: stateName,
    state_code: stateCode,
    dist_id: distId,
    dist_code: distCode || null,
    district_name: districtName,
    description: String(g("description") ?? "").trim() || null,
    created_by_id: String(g("createdbyid") ?? "").trim() || null,
    created_by_role_id: String(g("createdbyroleid") ?? "").trim() || null,
    updated_by_id: String(g("updatedbyid") ?? "").trim() || null,
    is_active: parseBool(g("isactive")),
    ip_address: String(g("ipaddress") ?? "").trim() || null,
    is_naxal_district: parseBoolDefault(g("isnaxaldistrict"), false),
    is_border_district: parseBoolDefault(g("isboarderdistrict"), false),
    present_active: parseBool(g("present_active")),
  };
}

function validateHeaders(headers) {
  const headerMap = buildHeaderMap(headers);
  for (const norm of REQUIRED_NORMALIZED) {
    requireColumn(headerMap, norm);
  }
  return headerMap;
}

export async function importStateDistrictCsvFromPath(filePath) {
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

  const rows = [];
  for (const rec of records) {
    rows.push(rowToRecord(headerMap, rec));
  }

  const byDist = new Map();
  for (const r of rows) byDist.set(r.dist_id, r);
  const uniqueRows = [...byDist.values()];
  const ts = new Date();
  for (const r of uniqueRows) {
    r.created_at = ts;
    r.updated_at = ts;
  }

  const k = db();
  const chunkSize = 200;
  let inserted = 0;

  await k.transaction(async (trx) => {
    for (let i = 0; i < uniqueRows.length; i += chunkSize) {
      const chunk = uniqueRows.slice(i, i + chunkSize);
      // eslint-disable-next-line no-await-in-loop
      await trx("state_district_master")
        .insert(chunk)
        .onConflict("dist_id")
        .merge([
          "state_id",
          "state_name",
          "state_code",
          "dist_code",
          "district_name",
          "description",
          "created_by_id",
          "created_by_role_id",
          "updated_by_id",
          "is_active",
          "ip_address",
          "is_naxal_district",
          "is_border_district",
          "present_active",
          "updated_at",
        ]);
      inserted += chunk.length;
    }
  });

  return { ok: true, rowsUpserted: inserted, rowsInFile: records.length, distinctDistIds: uniqueRows.length };
}

export async function listStateDistricts({ page = 1, pageSize = 50, q = "" } = {}) {
  const k = db();
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const offset = (p - 1) * ps;
  const term = String(q ?? "").trim();

  let base = k("state_district_master");
  if (term) {
    const like = `%${term.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    base = base.where((qb) => {
      qb.whereILike("state_name", like)
        .orWhereILike("district_name", like)
        .orWhereILike("state_id", like)
        .orWhereILike("dist_id", like)
        .orWhereILike("state_code", like)
        .orWhereILike("dist_code", like);
    });
  }

  const [{ count }] = await base.clone().clearSelect().clearOrder().count({ count: "*" });
  const total = Number(count) || 0;

  const rows = await base
    .clone()
    .select([
      "id",
      "state_code",
      "state_name",
      "dist_code",
      "district_name",
      "description",
      "is_active",
      "is_naxal_district",
      "is_border_district",
      "present_active",
      "created_at",
      "updated_at",
    ])
    .orderBy(["state_code", "state_name", "district_name", "dist_id"])
    .offset(offset)
    .limit(ps);

  return {
    page: p,
    pageSize: ps,
    total,
    rows,
  };
}

export const stateDistrictService = {
  importStateDistrictCsvFromPath,
  listStateDistricts,
};
