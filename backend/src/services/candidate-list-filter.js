/** Whitelist + SQL mapping for GET /candidates advanced filter tree. */

const FIELD_MAP = {
  meritRank: { col: "candidates.merit_rank", type: "number" },
  rollNo: { col: "candidates.roll_no", type: "string" },
  name: { col: "candidates.name", type: "string" },
  fatherName: { col: "candidates.father_name", type: "string" },
  category: { col: "candidates.category", type: "enum" },
  gender: { col: "candidates.gender", type: "gender" },
  dob: { col: "candidates.dob", type: "date" },
  normalizedMarks: { col: "candidates.normalized_marks", type: "number" },
  finalMarks: { col: "candidates.final_marks", type: "number" },
  marksCbe: { col: "candidates.marks_cbe", type: "number" },
  nccCert: { col: "candidates.ncc_cert", type: "string" },
  status: { col: "candidates.status", type: "enum" },
  isEsm: { col: "candidates.is_esm", type: "bool" },
  domicileState: { col: "candidates.domicile_state", type: "string" },
  district: { col: "candidates.district", type: "string" },
  ruleQualified: { col: "cre.qualified", type: "bool" },
  failReasonContains: { col: "cre.reasons", type: "jsonContains" },
};

const OPS_BY_TYPE = {
  number: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "isNull", "isNotNull"],
  string: ["eq", "ne", "contains", "startsWith", "isNull", "isNotNull"],
  enum: ["eq", "ne", "in", "isNull", "isNotNull"],
  gender: ["eq", "ne", "in", "isNull", "isNotNull"],
  date: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "isNull", "isNotNull"],
  bool: ["eq", "isNull", "isNotNull"],
  jsonContains: ["contains"],
};

const MAX_DEPTH = 6;
const MAX_NODES = 48;

function countNodes(group, depth = 0) {
  if (!group || typeof group !== "object") return 0;
  if (depth > MAX_DEPTH) return MAX_NODES + 1;
  let n = 1;
  for (const c of group.conditions ?? []) n += 1;
  for (const ch of group.children ?? []) n += countNodes(ch, depth + 1);
  return n;
}

export function filterGroupUsesCre(group) {
  if (!group || typeof group !== "object") return false;
  for (const c of group.conditions ?? []) {
    if (c?.field === "ruleQualified" || c?.field === "failReasonContains") return true;
  }
  for (const ch of group.children ?? []) {
    if (filterGroupUsesCre(ch)) return true;
  }
  return false;
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asBool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

function genderWhereIn(qb, col, male) {
  if (male) qb.whereIn(col, ["M", "m", "2", "MALE", "Male", "male"]);
  else qb.whereIn(col, ["F", "f", "1", "FEMALE", "Female", "female"]);
}

function applyCondition(qb, condition) {
  const { field, op, value } = condition;
  const meta = FIELD_MAP[field];
  if (!meta) return;
  const allowed = OPS_BY_TYPE[meta.type] ?? [];
  if (!allowed.includes(op)) return;

  const col = meta.col;

  if (op === "isNull") {
    qb.whereNull(col);
    return;
  }
  if (op === "isNotNull") {
    qb.whereNotNull(col);
    return;
  }

  if (meta.type === "jsonContains" && op === "contains") {
    const needle = String(value ?? "").trim();
    if (!needle) return;
    const esc = needle.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    qb.whereRaw(`cre.reasons::text ilike ? escape '\\'`, [`%${esc}%`]);
    return;
  }

  if (meta.type === "bool") {
    const b = asBool(value);
    if (b === null) return;
    if (op === "eq") qb.where(col, b);
    return;
  }

  if (meta.type === "gender") {
    if (op === "eq") {
      const g = String(value ?? "").trim().toUpperCase();
      if (g === "M") genderWhereIn(qb, col, true);
      else if (g === "F") genderWhereIn(qb, col, false);
      else qb.where(col, value);
      return;
    }
    if (op === "ne") {
      const g = String(value ?? "").trim().toUpperCase();
      if (g === "M") genderWhereIn(qb, col, false);
      else if (g === "F") genderWhereIn(qb, col, true);
      else qb.whereNot(col, value);
      return;
    }
    if (op === "in") {
      const parts = String(value ?? "")
        .split(/[,;|\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!parts.length) return;
      qb.where(function () {
        let first = true;
        for (const p of parts) {
          const fn = first ? "where" : "orWhere";
          first = false;
          this[fn](function () {
            if (p === "M") genderWhereIn(this, col, true);
            else if (p === "F") genderWhereIn(this, col, false);
            else this.where(col, p);
          });
        }
      });
      return;
    }
    return;
  }

  if (meta.type === "number") {
    if (op === "between") {
      const raw = String(value ?? "").split(/[,;]/).map((s) => s.trim());
      const a = asNum(raw[0]);
      const b = asNum(raw[1]);
      if (a === null || b === null) return;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      qb.whereBetween(col, [lo, hi]);
      return;
    }
    const n = asNum(value);
    if (n === null) return;
    if (op === "eq") qb.where(col, n);
    else if (op === "ne") qb.whereNot(col, n);
    else if (op === "gt") qb.where(col, ">", n);
    else if (op === "gte") qb.where(col, ">=", n);
    else if (op === "lt") qb.where(col, "<", n);
    else if (op === "lte") qb.where(col, "<=", n);
    return;
  }

  if (meta.type === "date") {
    if (op === "between") {
      const raw = String(value ?? "").split(/[,;]/).map((s) => s.trim());
      if (!raw[0] || !raw[1]) return;
      qb.whereBetween(col, [raw[0], raw[1]]);
      return;
    }
    const s = String(value ?? "").trim();
    if (!s) return;
    if (op === "eq") qb.whereRaw(`(candidates.dob)::date = (?::date)`, [s]);
    else if (op === "ne") qb.whereRaw(`(candidates.dob)::date <> (?::date)`, [s]);
    else if (op === "gt") qb.whereRaw(`(candidates.dob)::date > (?::date)`, [s]);
    else if (op === "gte") qb.whereRaw(`(candidates.dob)::date >= (?::date)`, [s]);
    else if (op === "lt") qb.whereRaw(`(candidates.dob)::date < (?::date)`, [s]);
    else if (op === "lte") qb.whereRaw(`(candidates.dob)::date <= (?::date)`, [s]);
    return;
  }

  if (meta.type === "string") {
    if (op === "eq") qb.where(col, String(value ?? ""));
    else if (op === "ne") qb.whereNot(col, String(value ?? ""));
    else if (op === "contains") {
      const like = `%${String(value ?? "").replace(/%/g, "\\%")}%`;
      qb.whereILike(col, like);
    } else if (op === "startsWith") {
      const like = `${String(value ?? "").replace(/%/g, "\\%")}%`;
      qb.whereILike(col, like);
    }
    return;
  }

  if (meta.type === "enum") {
    if (op === "in") {
      const parts = String(value ?? "")
        .split(/[,;|\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) return;
      qb.whereIn(col, parts);
      return;
    }
    if (op === "eq") qb.where(col, String(value ?? ""));
    else if (op === "ne") qb.whereNot(col, String(value ?? ""));
    return;
  }
}

function applyFilterGroupInner(qb, group, depth) {
  if (!group || typeof group !== "object") return;
  const op = group.op === "or" ? "or" : "and";
  const isOr = op === "or";
  const conditions = Array.isArray(group.conditions) ? group.conditions : [];
  const children = Array.isArray(group.children) ? group.children : [];
  if (!conditions.length && !children.length) return;

  qb.where(function () {
    const inner = this;
    let first = true;
    const add = (fn) => {
      if (first) {
        inner.where(fn);
        first = false;
      } else if (isOr) inner.orWhere(fn);
      else inner.andWhere(fn);
    };

    for (const ch of children) {
      add((w) => applyFilterGroupInner(w, ch, depth + 1));
    }
    for (const c of conditions) {
      if (!c || typeof c !== "object") continue;
      add((w) => {
        applyCondition(w, c);
      });
    }
  });
}

/**
 * @param {import("knex").Knex.QueryBuilder} qb
 * @param {object | null | undefined} group
 */
function groupHasParts(group) {
  if (!group || typeof group !== "object") return false;
  if (Array.isArray(group.conditions) && group.conditions.length) return true;
  if (Array.isArray(group.children) && group.children.length) return true;
  return false;
}

export function applyFilterGroup(qb, group) {
  if (!group || typeof group !== "object") return;
  if (!groupHasParts(group)) return;
  if (countNodes(group, 0) > MAX_NODES) return;
  applyFilterGroupInner(qb, group, 0);
}

function valueRequired(c) {
  return c.op !== "isNull" && c.op !== "isNotNull";
}

function validateConditionValue(c) {
  const meta = FIELD_MAP[c.field];
  if (!valueRequired(c)) return null;
  const v = c.value;
  if (v === undefined || v === null) return `value required for ${c.field} (${c.op})`;

  if (c.op === "between") {
    const parts = String(v)
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 2) return "between needs two values separated by comma";
    if (meta.type === "number") {
      if (!Number.isFinite(Number(parts[0])) || !Number.isFinite(Number(parts[1]))) {
        return "between needs numeric endpoints";
      }
    }
    return null;
  }

  if (meta.type === "number") {
    if (!Number.isFinite(Number(v))) return `invalid number for ${c.field}`;
    return null;
  }

  if (meta.type === "bool") {
    if (asBool(v) === null) return `invalid boolean for ${c.field}`;
    return null;
  }

  if (typeof v === "string" && v.trim() === "") {
    return `value required for ${c.field}`;
  }
  return null;
}

export function validateFilterGroup(group) {
  if (group == null) return { ok: true, group: null };
  if (typeof group !== "object") return { ok: false, error: "filterGroup must be an object" };
  if (!groupHasParts(group)) return { ok: true, group: null };
  if (countNodes(group, 0) > MAX_NODES) return { ok: false, error: "filterGroup too large" };
  const walk = (g, depth) => {
    if (depth > MAX_DEPTH) return "filterGroup nesting too deep";
    if (!g.op || (g.op !== "and" && g.op !== "or")) return "each group needs op: and | or";
    const conditions = g.conditions ?? [];
    const children = g.children ?? [];
    for (const c of conditions) {
      if (!c?.field || !c?.op) return "each condition needs field and op";
      if (!FIELD_MAP[c.field]) return `unknown field: ${c.field}`;
      const meta = FIELD_MAP[c.field];
      const allowed = OPS_BY_TYPE[meta.type] ?? [];
      if (!allowed.includes(c.op)) return `operator not allowed for ${c.field}`;
      const ve = validateConditionValue(c);
      if (ve) return ve;
    }
    for (const ch of children) {
      if (!groupHasParts(ch)) return "empty nested group";
      const err = walk(ch, depth + 1);
      if (err) return err;
    }
    return null;
  };
  const err = walk(group, 0);
  if (err) return { ok: false, error: err };
  return { ok: true, group };
}
