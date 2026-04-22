import { db } from "../db/knex.js";
import { newId } from "../db/ids.js";
import { logService } from "./log.service.js";
import { rulesEngine } from "./rules.engine.js";

/** post_code in vacancy CSV is the force letter (A–H). */
const ALL_INDIA_POSTS = new Set(["G", "H"]);

const MERIT_FALLBACK_BASE = 5_000_000;

function normalizeStateText(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ");
}

function genderNum(g) {
  const s = String(g ?? "").trim().toUpperCase();
  if (s === "M" || s === "1" || s.startsWith("M")) return 1;
  if (s === "F" || s === "2" || s.startsWith("F")) return 2;
  return null;
}

function areaBucket(areaRaw) {
  const a = String(areaRaw ?? "").trim().toUpperCase();
  if (a === "B") return "Border";
  if (a === "N") return "Naxal";
  return "General";
}

function normalizeAllocationPriorityOrder(v) {
  const allowed = new Set(["Naxal", "Border", "General"]);
  const base = Array.isArray(v) ? v.map((x) => String(x ?? "").trim()) : [];
  const out = [];
  const seen = new Set();
  for (const x of base) {
    if (!allowed.has(x)) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  for (const x of ["Naxal", "Border", "General"]) {
    if (!seen.has(x)) out.push(x);
  }
  return out.slice(0, 3);
}

function remainingSlots(row) {
  const left = Number(row.left_vacancy);
  if (Number.isFinite(left) && left > 0) return left;
  const vac = Number(row.vacancies) || 0;
  const alloc = Number(row.allocated) || 0;
  return Math.max(0, vac - alloc);
}

function vacancyCategoryMatches(rowCategory, candidateCategory, isEsm) {
  const rc = String(rowCategory ?? "").trim().toUpperCase();
  const cc = String(candidateCategory ?? "").trim().toUpperCase();
  // Relaxation-category candidates (OBC/SC/ST) must not consume open UR seats.
  // ESM is intentionally exempt from this restriction.
  const usesRelaxationCategory = cc === "OBC" || cc === "SC" || cc === "ST";
  if (rc === "UR") {
    if (usesRelaxationCategory) return false;
    if (isEsm) return true;
    return cc === "UR";
  }
  if (rc === "ESM") return Boolean(isEsm);
  if (["OBC", "SC", "ST", "EWS"].includes(rc)) return !isEsm && cc === rc;
  return false;
}

function categoryAllocatedForInsert(rowCategory) {
  const rc = String(rowCategory ?? "").trim().toUpperCase();
  if (rc === "ESM") return "ESM";
  return rc;
}

function bucketForStateLegacy(stateName) {
  const s = String(stateName ?? "").toLowerCase();
  if (s.includes("chhattisgarh") || s.includes("jharkhand") || s.includes("bihar")) return "Naxal";
  if (s.includes("jammu") || s.includes("ladakh") || s.includes("punjab") || s.includes("rajasthan")) return "Border";
  return "General";
}

/** Resolve domicile text → states.state_code using preloaded rows (no per-candidate DB round trips). */
function resolveStateCodeDetail(domicileState, statesList) {
  const raw = String(domicileState ?? "").trim();
  if (!raw || !statesList?.length) return { stateCode: null, method: "no_states_reference", detail: "states list empty" };

  if (/^\d+$/.test(raw)) {
    const hit = statesList.find((s) => String(s.state_code) === raw);
    if (hit) return { stateCode: hit.state_code, method: "numeric_state_code", detail: `Matched states.state_code = ${raw}` };
  }

  const norm = normalizeStateText(raw);
  for (const s of statesList) {
    if (normalizeStateText(s.state_name) === norm) {
      return { stateCode: s.state_code, method: "exact_state_name", detail: `Matched states.state_name (normalized) = ${s.state_name}` };
    }
  }

  const hits = statesList.filter((s) => {
    const sn = normalizeStateText(s.state_name);
    return sn === norm || sn.includes(norm) || norm.includes(sn);
  });
  if (hits.length === 1) {
    return {
      stateCode: hits[0].state_code,
      method: "fuzzy_single",
      detail: `Single fuzzy match on state_name: ${hits[0].state_name} (${hits[0].state_code})`,
    };
  }
  if (hits.length > 1) {
    hits.sort((a, b) => String(a.state_name).length - String(b.state_name).length);
    const pick = hits[0];
    return {
      stateCode: pick.state_code,
      method: "fuzzy_shortest_name",
      detail: `Multiple fuzzy hits; chose shortest state_name: ${pick.state_name} (${pick.state_code}) among ${hits.length} candidates`,
    };
  }

  return { stateCode: null, method: "unresolved", detail: "No match in states / state_name list for domicile text" };
}

function resolveStateCodeFromList(domicileState, statesList) {
  return resolveStateCodeDetail(domicileState, statesList).stateCode;
}

function domicileFlagsFromMaster(masterRows, stateCode, districtText) {
  const dt = normalizeStateText(districtText);
  if (!stateCode || !dt) {
    return {
      isNaxal: false,
      isBorder: false,
      matchedDistrictName: null,
      matchDetail: !stateCode ? "No resolved state_code" : "Empty domicile district text",
    };
  }

  const rows = masterRows.filter((r) => String(r.state_code) === String(stateCode));
  let best = null;
  let matchHow = "";
  for (const r of rows) {
    const dn = normalizeStateText(r.district_name);
    if (!dn) continue;
    if (dt === dn) {
      best = r;
      matchHow = "exact_district_name";
      break;
    }
    if (dt.includes(dn) || dn.includes(dt)) {
      best = r;
      matchHow = matchHow || "partial_district_name";
    }
  }
  if (!best) {
    return {
      isNaxal: false,
      isBorder: false,
      matchedDistrictName: null,
      matchDetail: `No state_district_master row for state_code=${stateCode} matched district text (normalized)`,
    };
  }
  return {
    isNaxal: Boolean(best.is_naxal_district),
    isBorder: Boolean(best.is_border_district),
    matchedDistrictName: best.district_name,
    matchDetail: `Master row: district_name="${best.district_name}" · match=${matchHow || "partial_district_name"}`,
  };
}

function slotsForCandidatePdfOrder(rows, flags, priorityOrder) {
  const out = [];
  const seen = new Set();
  const push = (arr) => {
    for (const r of arr) {
      if (seen.has(r.row_key)) continue;
      seen.add(r.row_key);
      out.push(r);
    }
  };
  const order = normalizeAllocationPriorityOrder(priorityOrder);
  for (const bucket of order) {
    if (bucket === "Naxal" && !flags.isNaxal) continue;
    if (bucket === "Border" && !flags.isBorder) continue;
    push(rows.filter((r) => areaBucket(r.area) === bucket));
  }
  // Safety fallback for unknown/missing area values.
  push(rows.filter((r) => !["Naxal", "Border", "General"].includes(areaBucket(r.area))));
  return out;
}

function filterVacancyRow(r, c, stateCode, genderN, allIndiaPoolKey) {
  if (genderN != null && Number(r.gender) !== genderN) return false;
  if (!vacancyCategoryMatches(r.category, c.category, c.isEsm)) return false;
  if (ALL_INDIA_POSTS.has(String(r.post_code ?? "").toUpperCase())) {
    return String(r._poolKey ?? "") === String(allIndiaPoolKey ?? "");
  }
  return String(r.state_code) === String(stateCode ?? "");
}

function buildVacancyAllocationMeta({
  c,
  stateRes,
  flags,
  genderN,
  chosen,
  pickSource,
  statesList,
  catIns,
  rowPost,
}) {
  const st = statesList.find((s) => String(s.state_code) === String(stateRes.stateCode));
  return {
    version: 1,
    engine: "vacancy_rows",
    noticeSummary:
      "Vacancy-row allocation: walk cleared candidates in merit order (merit_rank, then final_marks). Match vacancy_rows by gender (1=M, 2=F), category rules, state_code from domicile (except All-India). Among rows, PDF order prefers Naxal (area N) for naxal-flag districts, Border (B) for border-flag districts, then General (G). Post codes G/H (NCB/SSF) use a merged All-India pool.",
    candidate: {
      id: c.id,
      rollNo: c.rollNo ?? null,
      category: c.category,
      genderRaw: c.gender,
      genderVacancyNumeric: genderN,
      isEsm: Boolean(c.isEsm),
      domicileStateRaw: c.domicileState ?? null,
      districtDomicileRaw: c.district ?? null,
      meritRankFromDb: c.meritRank ?? null,
      meritRankStoredOnAllocationRow: c.meritRankForAlloc,
      finalMarks: c.finalMarks != null ? Number(c.finalMarks) : null,
      normalizedMarks: c.normalizedMarks != null ? Number(c.normalizedMarks) : null,
    },
    domicileStateResolution: {
      method: stateRes.method,
      detail: stateRes.detail,
      resolvedStateCode: stateRes.stateCode,
      resolvedStateName: st?.state_name ?? null,
    },
    domicileDistrictFromMaster: {
      isNaxalDistrict: flags.isNaxal,
      isBorderDistrict: flags.isBorder,
      matchedMasterDistrictName: flags.matchedDistrictName,
      matchDetail: flags.matchDetail,
    },
    categoryMatching: {
      rule:
        "Vacancy row category ESM ⇒ candidate must have is_esm. Vacancy UR/OBC/SC/ST/EWS ⇒ candidate same category and not ESM.",
      vacancyRowCategory: chosen.category,
      categoryAllocated: catIns,
    },
    vacancyRowChosen: {
      rowKey: chosen.row_key,
      vacancyStateCode: chosen.state_code,
      vacancyStateName: chosen.state_name ?? null,
      postCode: chosen.post_code,
      force: chosen.force ?? null,
      areaRaw: chosen.area,
      areaBucket: areaBucket(chosen.area),
      gender: chosen.gender,
      slotsRemainingBeforePick: chosen._pickedRemaining ?? null,
      vacanciesColumn: chosen.vacancies ?? null,
      allocatedColumn: chosen.allocated ?? null,
      leftVacancyColumn: chosen.left_vacancy ?? null,
    },
    poolSelection: {
      pickedFrom: pickSource,
      allIndiaPost: ALL_INDIA_POSTS.has(String(rowPost).toUpperCase()),
      allIndiaPoolKey: ALL_INDIA_POSTS.has(String(rowPost).toUpperCase()) ? chosen._poolKey ?? null : null,
    },
  };
}

async function loadClearedCandidatesOrdered(k) {
  const rows = await k("candidates")
    .where({ status: "cleared" })
    .select([
      "id",
      "roll_no as rollNo",
      "merit_rank as meritRank",
      "final_marks as finalMarks",
      "normalized_marks as normalizedMarks",
      "category",
      "gender",
      "is_esm as isEsm",
      "domicile_state as domicileState",
      "district",
    ])
    .orderByRaw("merit_rank ASC NULLS LAST")
    .orderByRaw("final_marks DESC NULLS LAST")
    .orderBy("id", "asc");

  let fb = MERIT_FALLBACK_BASE;
  return rows.map((c) => ({
    ...c,
    meritRankForAlloc: c.meritRank != null && Number.isFinite(Number(c.meritRank)) ? Number(c.meritRank) : fb++,
  }));
}

async function allocateFromVacancyRows(k) {
  await k("allocation").del();
  const activeRules = await rulesEngine.getActiveRules();
  const allocationPriorityOrder = activeRules["allocation.priorityOrder"];

  const vr = await k("vacancy_rows as v")
    .leftJoin("states as s", "s.state_code", "v.state_code")
    .select([
      "v.row_key",
      "v.state_code",
      "s.state_name as state_name",
      "v.gender",
      "v.post_code",
      "v.force",
      "v.area",
      "v.category",
      "v.vacancies",
      "v.initial",
      "v.current_count",
      "v.allocated",
      "v.left_vacancy",
    ]);

  let statesList = await k("states").select("state_code", "state_name");
  if (!statesList.length) {
    const r = await k.raw(
      "select distinct on (state_code) state_code, state_name from state_district_master order by state_code, district_name"
    );
    statesList = Array.isArray(r) ? r : (r?.rows ?? []);
  }

  const masterRows = await k("state_district_master").select([
    "state_code",
    "district_name",
    "is_naxal_district",
    "is_border_district",
  ]);

  const slots = vr.map((r) => ({
    ...r,
    remaining: remainingSlots(r),
  }));

  for (const s of slots) {
    const pc = String(s.post_code ?? "").toUpperCase();
    if (!ALL_INDIA_POSTS.has(pc)) continue;
    s._poolKey = [s.gender, String(s.category ?? "").toUpperCase(), areaBucket(s.area), pc].join("|");
  }

  const merit = await loadClearedCandidatesOrdered(k);

  let skippedGender = 0;
  let skippedNoSlot = 0;

  const inserts = [];
  const meritEsm = new Map(merit.map((m) => [m.id, Boolean(m.isEsm)]));

  for (const c of merit) {
    const genderN = genderNum(c.gender);
    if (genderN == null) {
      skippedGender += 1;
      continue;
    }

    const stateRes = resolveStateCodeDetail(c.domicileState, statesList);
    const stateCode = stateRes.stateCode;
    const flags = domicileFlagsFromMaster(masterRows, stateCode, c.district);

    let chosen = null;
    let pickSource = null;

    const tryPickFromList = (list) => {
      for (const r of list) {
        if (r.remaining <= 0) continue;
        const poolKey = ALL_INDIA_POSTS.has(String(r.post_code ?? "").toUpperCase()) ? r._poolKey : null;
        if (!filterVacancyRow(r, c, stateCode, genderN, poolKey)) continue;
        chosen = r;
        chosen._pickedRemaining = r.remaining;
        r.remaining -= 1;
        return true;
      }
      return false;
    };

    const baseFilter = (r) => {
      if (genderN != null && Number(r.gender) !== genderN) return false;
      if (!vacancyCategoryMatches(r.category, c.category, c.isEsm)) return false;
      return true;
    };

    const stateRows = slots.filter((r) => baseFilter(r) && !ALL_INDIA_POSTS.has(String(r.post_code ?? "").toUpperCase()));
    const orderedState = slotsForCandidatePdfOrder(stateRows.filter((r) => r.state_code === stateCode), flags, allocationPriorityOrder);
    if (tryPickFromList(orderedState)) pickSource = "state_pool";

    if (!chosen) {
      const indiaCandidates = slots.filter((r) => {
        if (!baseFilter(r)) return false;
        return ALL_INDIA_POSTS.has(String(r.post_code ?? "").toUpperCase());
      });
      const orderedIndia = slotsForCandidatePdfOrder(indiaCandidates, flags, allocationPriorityOrder);
      if (tryPickFromList(orderedIndia)) pickSource = "all_india_pool";
    }

    if (!chosen) {
      skippedNoSlot += 1;
      continue;
    }

    const rowPost = String(chosen.post_code ?? "A").toUpperCase().slice(0, 1);
    const stateName = chosen.state_name ?? chosen.state_code ?? "";
    const catIns = categoryAllocatedForInsert(chosen.category);
    if (!["UR", "OBC", "SC", "ST", "EWS", "ESM"].includes(catIns)) continue;

    const domicileLabel = String(c.domicileState ?? "").trim();
    const stateAllocated =
      ALL_INDIA_POSTS.has(rowPost) && domicileLabel ? domicileLabel : stateName;

    const allocationMeta = buildVacancyAllocationMeta({
      c,
      stateRes,
      flags,
      genderN,
      chosen,
      pickSource,
      statesList,
      catIns,
      rowPost,
    });

    inserts.push({
      id: newId(),
      candidate_id: c.id,
      merit_rank: c.meritRankForAlloc,
      force_code: rowPost,
      category_allocated: catIns,
      state_allocated: stateAllocated || stateName || "—",
      district_allocated: String(c.district ?? "").trim() || "—",
      vacancy_row_key: chosen.row_key,
      state_code: ALL_INDIA_POSTS.has(rowPost) ? stateCode ?? chosen.state_code : chosen.state_code,
      area: chosen.area ?? null,
      post_code: chosen.post_code ?? null,
      allocation_meta: allocationMeta,
    });
  }

  const chunkSize = 500;
  for (let i = 0; i < inserts.length; i += chunkSize) {
    const chunk = inserts.slice(i, i + chunkSize);
    // eslint-disable-next-line no-await-in-loop
    await k("allocation").insert(chunk);
  }

  const esmAllocated = inserts.filter((row) => meritEsm.get(row.candidate_id)).length;

  const diag = {
    clearedCandidates: merit.length,
    skippedGender,
    skippedNoSlot,
    unresolvedStateCode: merit.filter((c) => !resolveStateCodeDetail(c.domicileState, statesList).stateCode).length,
  };

  await logService.write("info", "Allocation summary (vacancy_rows)", {
    allocated: inserts.length,
    esmAllocated,
    vacancyRows: vr.length,
    meritCandidates: merit.length,
    mode: "vacancy_rows",
    ...diag,
  });

  return {
    allocated: inserts.length,
    esmAllocated,
    vacancyRows: vr.length,
    meritCandidates: merit.length,
    mode: "vacancy_rows",
    diagnostics: diag,
  };
}

async function allocateLegacyVacancyTable(k) {
  await k("allocation").del();

  const vacancies = await k("vacancy").select([
    "id",
    "force_code as forceCode",
    "force_name as forceName",
    "state",
    "district",
    "category",
    "gender",
    "total_posts as totalPosts",
    "esm_reserved as esmReserved",
  ]);
  const vacancyBuckets = new Map();

  for (const v of vacancies) {
    const key = [v.state, v.gender, v.category, v.forceCode, bucketForStateLegacy(v.state), v.district].join("|");
    vacancyBuckets.set(key, {
      ...v,
      remaining: v.totalPosts,
      remainingEsm: v.esmReserved,
    });
  }

  const merit = await loadClearedCandidatesOrdered(k);

  let allocated = 0;
  let esmAllocated = 0;
  const priority = ["Naxal", "Border", "General"];

  for (const c of merit) {
    const state = c.domicileState ?? "";
    const district = c.district ?? "";
    const category = c.category;
    const gender = c.gender;

    let chosen = null;
    for (const p of priority) {
      for (const forceCode of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
        const key = [state, gender, category, forceCode, p, district].join("|");
        const v = vacancyBuckets.get(key);
        if (!v) continue;
        if (v.remaining <= 0) continue;

        if (c.isEsm) {
          if (v.remainingEsm > 0) {
            chosen = { v, categoryAllocated: category };
            v.remainingEsm -= 1;
            v.remaining -= 1;
            break;
          }
          const urKey = [state, gender, "UR", forceCode, p, district].join("|");
          const ur = vacancyBuckets.get(urKey);
          if (ur && ur.remaining > 0) {
            chosen = { v: ur, categoryAllocated: "UR" };
            ur.remaining -= 1;
            break;
          }
        } else {
          chosen = { v, categoryAllocated: category };
          v.remaining -= 1;
          break;
        }
      }
      if (chosen) break;
    }

    if (!chosen) continue;

    // eslint-disable-next-line no-await-in-loop
    const legacyMeta = {
      version: 1,
      engine: "legacy_vacancy_table",
      noticeSummary:
        "Legacy engine: bucket key = domicile_state text + gender + category + force_code + placeholder area bucket (state name heuristic) + district text. Merit-ordered cleared candidates.",
      candidate: {
        id: c.id,
        rollNo: c.rollNo ?? null,
        category: c.category,
        gender: c.gender,
        isEsm: Boolean(c.isEsm),
        domicileState: c.domicileState ?? null,
        district: c.district ?? null,
        meritRankFromDb: c.meritRank ?? null,
        meritRankStoredOnAllocationRow: c.meritRankForAlloc,
        finalMarks: c.finalMarks != null ? Number(c.finalMarks) : null,
        normalizedMarks: c.normalizedMarks != null ? Number(c.normalizedMarks) : null,
      },
      bucket: {
        state: chosen.v.state,
        district: chosen.v.district,
        forceCode: chosen.v.forceCode,
        categoryAllocated: chosen.categoryAllocated,
        areaPlaceholder: "Naxal|Border|General from domicile state name heuristic in code",
      },
    };

    await k("allocation").insert({
      id: newId(),
      candidate_id: c.id,
      merit_rank: c.meritRankForAlloc,
      force_code: chosen.v.forceCode,
      category_allocated: chosen.categoryAllocated,
      state_allocated: chosen.v.state,
      district_allocated: chosen.v.district,
      vacancy_row_key: null,
      state_code: null,
      area: null,
      post_code: null,
      allocation_meta: legacyMeta,
    });
    allocated += 1;
    if (c.isEsm) esmAllocated += 1;
  }

  await logService.write("info", "Allocation summary (legacy vacancy table)", { allocated, esmAllocated });
  return {
    allocated,
    esmAllocated,
    vacancyRows: vacancies.length,
    meritCandidates: merit.length,
    mode: "legacy_vacancy",
  };
}

export const allocationService = {
  async allocateFromMerit() {
    const k = db();
    const row = await k("vacancy_rows").select(k.raw("count(*)::int as n")).first();
    const n = Number(row?.n ?? 0);
    if (n > 0) return allocateFromVacancyRows(k);
    return allocateLegacyVacancyTable(k);
  },
};
