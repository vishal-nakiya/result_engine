import { db } from "../db/knex.js";
import { newId } from "../db/ids.js";
import { logService } from "./log.service.js";
import { rulesEngine } from "./rules.engine.js";

// Only H=SSF fills on All-India basis (PDF notice). G=NIA has 0 vacancies.
const ALL_INDIA_POSTS = new Set(["H"]);

// UR normalized-marks cutoff (35 out of 100) for §13.14 check
const UR_NORMALIZED_CUTOFF = 35;

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
  if (s === "M" || s === "2" || s.startsWith("M")) return 1;
  if (s === "F" || s === "1" || s.startsWith("F")) return 2;
  return null;
}

function areaBucket(areaRaw) {
  const a = String(areaRaw ?? "").trim().toUpperCase();
  if (a === "B") return "Border";
  if (a === "N") return "Naxal";
  return "General";
}

function parseBoolLoose(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "t" || s === "true" || s === "1" || s === "yes" || s === "y";
}

function rawGet(raw, ...keys) {
  if (!raw || typeof raw !== "object") return null;
  for (const key of keys) {
    if (raw[key] != null && String(raw[key]).trim() !== "") return raw[key];
    const upper = String(key).toUpperCase();
    const lower = String(key).toLowerCase();
    if (raw[upper] != null && String(raw[upper]).trim() !== "") return raw[upper];
    if (raw[lower] != null && String(raw[lower]).trim() !== "") return raw[lower];
  }
  return null;
}

/**
 * Detect if a candidate used any age or physical relaxation.
 * ESM candidates are exempt — they may still fill UR slots per PDF.
 * Non-ESM candidates who used ARC or physical relaxation CANNOT fill UR vacancies.
 */
function computeUsedRelaxation(raw, isEsm) {
  if (isEsm) return false;
  const agerelaxNew = String(raw?.agerelax_code_new ?? "").trim();
  const arcCode = String(raw?.arc_code ?? "").trim();
  const usedARC = (agerelaxNew !== "" && agerelaxNew !== "0") ||
    (arcCode !== "" && arcCode !== "0");
  const heightRelax = String(raw?.height_relax ?? "").trim().toLowerCase();
  const chestRelax = String(raw?.chest_relax ?? "").trim().toLowerCase();
  const heightChestRelax = String(raw?.height_chest_relax ?? "").trim().toLowerCase();
  return usedARC || heightRelax === "yes" || chestRelax === "yes" || heightChestRelax === "yes";
}

function normalizeAllocationPriorityOrder(v) {
  const allowed = new Set(["Naxal", "Border", "General"]);
  const base = Array.isArray(v) ? v.map((x) => String(x ?? "").trim()) : [];
  const out = [];
  const seen = new Set();
  for (const x of base) {
    if (!allowed.has(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  // §13.16: Border before Naxal (dual-classified districts use Border slots first)
  for (const x of ["Border", "Naxal", "General"]) {
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

/**
 * §13.14: SC/ST/OBC/EWS candidates who qualify at UR standards are placed
 * against UR vacancies first. "Qualifying at UR standard" means their
 * normalizedMarks ≥ UR cutoff (35 out of 100).
 *
 * ESM candidates may always fill UR slots (ARC-exempt).
 * Non-ESM candidates who used ARC or physical relaxation CANNOT fill UR slots.
 */
function vacancyCategoryMatches(rowCategory, candidateCategory, isEsm, normalizedMarks, usedRelaxation) {
  const rc = String(rowCategory ?? "").trim().toUpperCase();
  const cc = String(candidateCategory ?? "").trim().toUpperCase();

  if (rc === "UR") {
    if (isEsm) return true; // ESM candidates can fill UR slots (ARC-exempt)
    if (usedRelaxation) return false; // ARC or physical relaxation used → cannot fill UR
    if (cc === "UR" || cc === "EWS") return true; // EWS has no caste relaxation → can fill UR
    // §13.14: OBC/SC/ST qualify at UR level if their normalized score ≥ UR cutoff
    const qualifiesAtUr =
      Number.isFinite(Number(normalizedMarks)) &&
      Number(normalizedMarks) >= UR_NORMALIZED_CUTOFF;
    return qualifiesAtUr;
  }

  if (rc === "ESM") return Boolean(isEsm);

  // Reserved category slots: candidate must be same category, non-ESM
  if (["OBC", "SC", "ST", "EWS"].includes(rc)) return !isEsm && cc === rc;

  return false;
}

function categoryAllocatedForInsert(rowCategory) {
  return String(rowCategory ?? "").trim().toUpperCase();
}

/** Resolve domicile text → state_code via preloaded states list. */
function resolveStateCodeDetail(domicileState, statesList) {
  const raw = String(domicileState ?? "").trim();
  if (!raw || !statesList?.length) {
    return { stateCode: null, method: "no_reference", detail: "empty domicile or states list" };
  }

  // Numeric code → direct match
  if (/^\d+$/.test(raw)) {
    const hit = statesList.find((s) => String(s.state_code) === raw);
    if (hit) return { stateCode: hit.state_code, method: "numeric_code", detail: `state_code=${raw}` };
  }

  const norm = normalizeStateText(raw);
  for (const s of statesList) {
    if (normalizeStateText(s.state_name) === norm) {
      return { stateCode: s.state_code, method: "exact_name", detail: `matched "${s.state_name}"` };
    }
  }

  const hits = statesList.filter((s) => {
    const sn = normalizeStateText(s.state_name);
    return sn.includes(norm) || norm.includes(sn);
  });
  if (hits.length === 1) {
    return { stateCode: hits[0].state_code, method: "fuzzy_single", detail: hits[0].state_name };
  }
  if (hits.length > 1) {
    hits.sort((a, b) => String(a.state_name).length - String(b.state_name).length);
    return { stateCode: hits[0].state_code, method: "fuzzy_shortest", detail: hits[0].state_name };
  }

  return { stateCode: null, method: "unresolved", detail: `no match for "${raw}"` };
}

/**
 * Order vacancy rows respecting PDF §13.16:
 *   - District classified BOTH Border AND Naxal → Border slots filled first, then Naxal.
 *   - Naxal-only district → Naxal first.
 *   - Border-only district → Border first.
 *   - General → General.
 */
function slotsForCandidatePdfOrder(rows, flags, priorityOrder) {
  // §13.16 override: dual-classified → Border before Naxal
  let order;
  if (flags.isNaxal && flags.isBorder) {
    order = ["Border", "Naxal", "General"];
  } else {
    order = normalizeAllocationPriorityOrder(priorityOrder);
  }

  const out = [];
  const seen = new Set();
  const push = (arr) => {
    for (const r of arr) {
      if (seen.has(r.row_key)) continue;
      seen.add(r.row_key);
      out.push(r);
    }
  };

  for (const bucket of order) {
    if (bucket === "Naxal" && !flags.isNaxal) continue;
    if (bucket === "Border" && !flags.isBorder) continue;
    push(rows.filter((r) => areaBucket(r.area) === bucket));
  }
  // Always include General as final fallback
  push(rows.filter((r) => areaBucket(r.area) === "General"));

  return out;
}

/**
 * Parse candidate's post_preference CSV field (e.g. "H,G,B,D,C,F,E,A")
 * into an ordered array of force codes. Unknown codes are dropped.
 */
function parsePostPreference(prefRaw) {
  const ALL_CODES = new Set(["A", "B", "C", "D", "E", "F", "G", "H"]);
  const src = String(prefRaw ?? "").trim().toUpperCase();
  const tokenized = src
    .split(/[,/|;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const fallbackChars = tokenized.length ? tokenized : src.replace(/[^A-H]/g, "").split("");
  const prefs = fallbackChars.filter((s) => ALL_CODES.has(s));
  // Append any missing codes at the end in default order A→B→C→D→E→F→G→H
  for (const c of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
    if (!prefs.includes(c)) prefs.push(c);
  }
  return prefs;
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
      "state_code as stateCode",
      "district_code as districtCode",
      "state_name as stateName",
      "raw_data as rawData",
    ])
    // Global merit order: best marks first; merit_rank is the tiebreak
    .orderByRaw("final_marks DESC NULLS LAST")
    .orderByRaw("merit_rank ASC NULLS LAST")
    .orderBy("id", "asc");

  let fb = MERIT_FALLBACK_BASE;
  return rows.map((c) => {
    const raw = typeof c.rawData === "string" ? JSON.parse(c.rawData) : (c.rawData ?? {});
    // Prefer statecode_considered_app from raw_data for accurate state resolution
    const stateCodeOverride = rawGet(raw, "state_code", "s_code", "statecode_considered_app")
      ? String(rawGet(raw, "state_code", "s_code", "statecode_considered_app")).trim()
      : (c.stateCode ? String(c.stateCode).trim() : null);
    return {
      ...c,
      raw,
      stateCodeOverride,
      meritRankForAlloc: c.meritRank != null && Number.isFinite(Number(c.meritRank))
        ? Number(c.meritRank)
        : fb++,
    };
  });
}

async function allocateFromVacancyRows(k) {
  await k("allocation").del();

  // Reset vacancy counts so allocation starts from full capacity
  await k("vacancy_rows").update({
    allocated: 0,
    left_vacancy: k.ref("vacancies"),
  });

  const activeRules = await rulesEngine.getActiveRules();
  const allocationPriorityOrder = activeRules["allocation.priorityOrder"];

  // Load vacancy rows with state names
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

  // Load states reference list
  let statesList = await k("states").select("state_code", "state_name");
  if (!statesList.length) statesList = [];

  const slots = vr.map((r) => ({
    ...r,
    remaining: remainingSlots(r),
  }));

  const merit = await loadClearedCandidatesOrdered(k);

  // ESM 10% cap: count ESM-category seats available; cap direct ESM allocation to that quota
  const totalVacancies = slots.reduce((sum, r) => sum + (Number(r.vacancies) || 0), 0);
  const esmCap = Math.floor(totalVacancies * 0.10);
  let esmAllocatedToEsmSlots = 0;

  // Tie-break detection: marks values shared by >1 candidate
  const marksCounts = new Map();
  for (const c of merit) {
    const m = c.finalMarks;
    marksCounts.set(m, (marksCounts.get(m) ?? 0) + 1);
  }
  const tiedMarksSet = new Set(
    [...marksCounts.entries()].filter(([, cnt]) => cnt > 1).map(([m]) => m)
  );

  let skippedGender = 0;
  let skippedNoSlot = 0;

  const inserts = [];

  for (const c of merit) {
    const genderN = genderNum(c.gender);
    if (genderN == null) {
      skippedGender += 1;
      continue;
    }

    // Resolve state code: prefer raw_data statecode_considered_app, else resolve domicile text
    let stateCode;
    if (c.stateCodeOverride) {
      stateCode = c.stateCodeOverride;
    } else {
      const stateText = c.stateName ?? rawGet(c.raw, "state_name", "state") ?? c.domicileState;
      const stateRes = resolveStateCodeDetail(stateText, statesList);
      stateCode = stateRes.stateCode ? String(stateRes.stateCode) : null;
    }

    // Area flags: prefer raw_data (pre-computed by SSC), else fall back to district master
    const isNaxal = parseBoolLoose(rawGet(c.raw, "naxal", "naxal_district"));
    const isBorder = parseBoolLoose(rawGet(c.raw, "border", "border_district"));
    const flags = { isNaxal, isBorder };

    // Normalized marks for §13.14 UR eligibility check
    const normalizedMarks = c.normalizedMarks != null
      ? Number(c.normalizedMarks)
      : Number(rawGet(c.raw, "normalized_score", "nscore") ?? 0);

    // Relaxation check: ARC or physical relaxation → cannot fill UR (unless ESM)
    const usedRelaxation = computeUsedRelaxation(c.raw, c.isEsm);

    // Candidate's preferred force order from post_preference field
    const prefOrder = parsePostPreference(rawGet(c.raw, "post_preference", "pref"));

    // Base filter: gender + category match (used before force-preference ordering)
    const baseFilter = (r) => {
      if (genderN != null && Number(r.gender) !== genderN) return false;
      if (!vacancyCategoryMatches(r.category, c.category, c.isEsm, normalizedMarks, usedRelaxation)) return false;
      return true;
    };

    let chosen = null;
    let pickSource = null;

    const tryPickFromList = (list) => {
      for (const r of list) {
        if (r.remaining <= 0) continue;
        if (!baseFilter(r)) continue;
        chosen = r;
        chosen._pickedRemaining = r.remaining;
        r.remaining -= 1;
        return true;
      }
      return false;
    };

    // Iterate through preferred forces in candidate's preference order (merit-cum-preference)
    for (const forceCode of prefOrder) {
      let candidateSlots;

      if (ALL_INDIA_POSTS.has(forceCode)) {
        // All-India (SSF=H): no state filter — category+gender handled by baseFilter
        candidateSlots = slots.filter(
          (r) => String(r.post_code ?? "").toUpperCase() === forceCode
        );
      } else {
        // State-based: candidate must match vacancy state
        if (!stateCode) continue; // can't allocate without a known state
        candidateSlots = slots.filter(
          (r) =>
            String(r.post_code ?? "").toUpperCase() === forceCode &&
            String(r.state_code) === stateCode
        );
      }

      // For ESM candidates: try ESM-category rows first (within cap), then UR/other
      let ordered;
      if (c.isEsm && esmAllocatedToEsmSlots < esmCap) {
        // Within cap: prioritise ESM-category slots to fill the 10% ESM quota
        const esmRows = candidateSlots.filter(
          (r) => String(r.category ?? "").trim().toUpperCase() === "ESM"
        );
        const otherRows = candidateSlots.filter(
          (r) => String(r.category ?? "").trim().toUpperCase() !== "ESM"
        );
        ordered = [
          ...slotsForCandidatePdfOrder(esmRows, flags, allocationPriorityOrder),
          ...slotsForCandidatePdfOrder(otherRows, flags, allocationPriorityOrder),
        ];
      } else {
        // Cap met or non-ESM: treat as normal candidate (no ESM-priority ordering)
        ordered = slotsForCandidatePdfOrder(candidateSlots, flags, allocationPriorityOrder);
      }

      if (tryPickFromList(ordered)) {
        pickSource = `pref_${forceCode}_${ALL_INDIA_POSTS.has(forceCode) ? "allindia" : "state"}`;
        break;
      }
    }

    if (!chosen) {
      skippedNoSlot += 1;
      continue;
    }

    const rowPost = String(chosen.post_code ?? "A").toUpperCase().slice(0, 1);
    const stateName = chosen.state_name ?? chosen.state_code ?? "";
    const catIns = categoryAllocatedForInsert(chosen.category);
    if (!["UR", "OBC", "SC", "ST", "EWS", "ESM"].includes(catIns)) continue;

    // Track ESM quota usage
    if (c.isEsm && catIns === "ESM") esmAllocatedToEsmSlots += 1;

    const domicileLabel = String(c.domicileState ?? "").trim();
    const stateAllocated = ALL_INDIA_POSTS.has(rowPost) && domicileLabel ? domicileLabel : stateName;
    const tieBreakApplied = tiedMarksSet.has(c.finalMarks);

    // Build human-readable allocation reason
    const relaxNote = usedRelaxation ? " (ARC/physical relaxation used)" : "";
    const esmNote = c.isEsm ? "ESM" : c.category;
    let allocationReason;
    if (catIns === "UR") {
      if (c.isEsm) allocationReason = `ESM candidate allocated to UR vacancy`;
      else allocationReason = `${c.category} candidate qualified for UR vacancy (§13.14 normalizedMarks≥${UR_NORMALIZED_CUTOFF})`;
    } else if (catIns === "ESM") {
      allocationReason = `${esmNote} candidate allocated to ESM quota slot`;
    } else {
      allocationReason = `${esmNote} candidate allocated to ${catIns} category vacancy${relaxNote}`;
    }
    if (ALL_INDIA_POSTS.has(rowPost)) allocationReason += `; All-India post (${rowPost})`;

    const allocationMeta = {
      version: 2,
      engine: "vacancy_rows_merit_cum_preference",
      allocation_reason: allocationReason,
      tie_break_applied: tieBreakApplied,
      candidate: {
        id: c.id,
        rollNo: c.rollNo ?? null,
        category: c.category,
        genderVacancyNumeric: genderN,
        isEsm: Boolean(c.isEsm),
        usedRelaxation,
        finalMarks: c.finalMarks != null ? Number(c.finalMarks) : null,
        normalizedMarks,
        meritRank: c.meritRankForAlloc,
        stateCode,
        isNaxalDistrict: isNaxal,
        isBorderDistrict: isBorder,
        postPreference: c.raw.post_preference ?? null,
      },
      vacancyRow: {
        rowKey: chosen.row_key,
        postCode: chosen.post_code,
        force: chosen.force ?? null,
        area: chosen.area,
        areaBucket: areaBucket(chosen.area),
        stateCode: chosen.state_code,
        stateName: chosen.state_name ?? null,
        category: chosen.category,
        slotsBeforePick: chosen._pickedRemaining,
      },
      pickSource,
    };

    inserts.push({
      id: newId(),
      candidate_id: c.id,
      merit_rank: c.meritRankForAlloc,
      force_code: rowPost,
      category_allocated: catIns,
      state_allocated: stateAllocated || stateName || "—",
        district_allocated: String(c.districtCode ?? c.district ?? rawGet(c.raw, "district_code", "d_code", "domicile_dist_app") ?? "").trim() || "—",
      vacancy_row_key: chosen.row_key,
      state_code: ALL_INDIA_POSTS.has(rowPost) ? stateCode ?? chosen.state_code : chosen.state_code,
      area: chosen.area ?? null,
      post_code: chosen.post_code ?? null,
      allocation_meta: allocationMeta,
    });
  }

  // ── ESM §3.2 fallback: fill remaining ESM slots with non-ESM same-category ──
  // Collect unallocated cleared candidates (not yet assigned to a force)
  const allocatedIds = new Set(inserts.map((r) => r.candidate_id));
  const unallocated = merit.filter((c) => !allocatedIds.has(c.id) && !c.isEsm);

  // Find vacancy rows that are ESM-type with remaining slots
  const esmSlotsRemaining = slots.filter(
    (r) => String(r.category ?? "").trim().toUpperCase() === "ESM" && r.remaining > 0
  );

  for (const esmSlot of esmSlotsRemaining) {
    if (esmSlot.remaining <= 0) continue;
    const gN = Number(esmSlot.gender);
    const sc = String(esmSlot.state_code ?? "");

    // Find the best unallocated non-ESM candidate matching this slot's state+gender+category
    // ESM quota maps to UR/OBC/SC/ST equivalent — use general category matching via ESM slot
    // The underlying category of ESM slot matches candidate's own category
    // Per PDF: remaining ESM vacancies → filled by non-ESM of same category (state)
    for (const cand of unallocated) {
      if (allocatedIds.has(cand.id)) continue;
      if (genderNum(cand.gender) !== gN) continue;
      if (String(cand.stateCodeOverride ?? resolveStateCodeDetail(cand.domicileState, statesList).stateCode) !== sc) continue;
      if (!ALL_INDIA_POSTS.has(String(esmSlot.post_code ?? "").toUpperCase())) {
        // state match already checked above
      }

      const catIns = categoryAllocatedForInsert(esmSlot.category);
      if (!["UR", "OBC", "SC", "ST", "EWS", "ESM"].includes(catIns)) continue;

      esmSlot.remaining -= 1;
      allocatedIds.add(cand.id);

      const rowPost = String(esmSlot.post_code ?? "A").toUpperCase().slice(0, 1);
      const stateName = esmSlot.state_name ?? esmSlot.state_code ?? "";

      inserts.push({
        id: newId(),
        candidate_id: cand.id,
        merit_rank: cand.meritRankForAlloc,
        force_code: rowPost,
        category_allocated: "ESM", // §3.2 fallback: non-ESM fills unfilled ESM slot
        state_allocated: stateName || "—",
        district_allocated: String(cand.districtCode ?? cand.district ?? rawGet(cand.raw, "district_code", "d_code", "domicile_dist_app") ?? "").trim() || "—",
        vacancy_row_key: esmSlot.row_key,
        state_code: esmSlot.state_code,
        area: esmSlot.area ?? null,
        post_code: esmSlot.post_code ?? null,
        allocation_meta: {
          version: 2,
          engine: "esm_fallback_s3_2",
          allocation_reason: `Non-ESM ${cand.category} candidate filling unfilled ESM vacancy per PDF §3.2`,
          tie_break_applied: tiedMarksSet.has(cand.finalMarks),
          candidate: { id: cand.id, category: cand.category, isEsm: false },
          esmSlotRowKey: esmSlot.row_key,
        },
      });

      if (esmSlot.remaining <= 0) break;
    }
  }

  // Insert all allocation records in chunks
  const chunkSize = 500;
  for (let i = 0; i < inserts.length; i += chunkSize) {
    // eslint-disable-next-line no-await-in-loop
    await k("allocation").insert(inserts.slice(i, i + chunkSize));
  }

  // Write back final allocated counts to vacancy_rows
  const allocsByRow = new Map();
  for (const ins of inserts) {
    if (!ins.vacancy_row_key) continue;
    allocsByRow.set(ins.vacancy_row_key, (allocsByRow.get(ins.vacancy_row_key) ?? 0) + 1);
  }
  for (const [rowKey, count] of allocsByRow) {
    // eslint-disable-next-line no-await-in-loop
    await k("vacancy_rows")
      .where({ row_key: rowKey })
      .update({
        allocated: count,
        left_vacancy: k.raw(`vacancies - ?`, [count]),
      });
  }

  const esmAllocated = inserts.filter((r) => merit.some((m) => m.id === r.candidate_id && m.isEsm)).length;
  const esmFallbackCount = inserts.filter(
    (r) => r.category_allocated === "ESM" && !merit.some((m) => m.id === r.candidate_id && m.isEsm)
  ).length;

  const diag = {
    clearedCandidates: merit.length,
    skippedGender,
    skippedNoSlot,
    esmAllocated,
    esmAllocatedToEsmSlots,
    esmCap,
    esmFallbackFilled: esmFallbackCount,
    totalVacancies,
  };

  await logService.write("info", "Allocation complete (vacancy_rows + merit-cum-preference)", {
    allocated: inserts.length,
    ...diag,
  });

  return {
    allocated: inserts.length,
    esmAllocated,
    esmAllocatedToEsmSlots,
    esmCap,
    esmFallbackFilled: esmFallbackCount,
    totalVacancies,
    vacancyRows: vr.length,
    meritCandidates: merit.length,
    mode: "vacancy_rows_merit_cum_preference",
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
    const area = String(v.state ?? "").toLowerCase().includes("chhattisgarh") ||
      String(v.state ?? "").toLowerCase().includes("jharkhand") ? "Naxal"
      : String(v.state ?? "").toLowerCase().includes("jammu") ? "Border"
        : "General";
    const key = [v.state, v.gender, v.category, v.forceCode, area, v.district].join("|");
    vacancyBuckets.set(key, { ...v, remaining: v.totalPosts, remainingEsm: v.esmReserved });
  }

  const merit = await loadClearedCandidatesOrdered(k);
  let allocated = 0;
  let esmAllocated = 0;

  for (const c of merit) {
    const state = c.domicileState ?? "";
    const district = c.district ?? "";
    const category = c.category;
    const gender = c.gender;
    let chosen = null;

    for (const p of ["Naxal", "Border", "General"]) {
      for (const forceCode of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
        const key = [state, gender, category, forceCode, p, district].join("|");
        const v = vacancyBuckets.get(key);
        if (!v || v.remaining <= 0) continue;
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
      allocation_meta: { version: 1, engine: "legacy_vacancy_table" },
    });
    allocated += 1;
    if (c.isEsm) esmAllocated += 1;
  }

  await logService.write("info", "Allocation complete (legacy)", { allocated, esmAllocated });
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
