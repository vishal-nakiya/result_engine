import { db } from "../db/knex.js";
import { rulesEngine } from "./rules.engine.js";
import { allocationService } from "./allocation.service.js";
import { logService } from "./log.service.js";

// ── Date helpers ─────────────────────────────────────────────────────────────

function asDateOnly(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dobFromAny(dateText) {
  const s = String(dateText ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const iso = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isNaN(iso.getTime())) return iso;
  return null;
}

// ── Category helpers ──────────────────────────────────────────────────────────

/**
 * Map SSC cat1 code → category string.
 * 0=UR, 1=SC, 2=ST, 6=OBC, 9=EWS
 */
function cat1ToCategory(cat1) {
  const v = Number(cat1);
  const MAP = { 0: "UR", 1: "SC", 2: "ST", 6: "OBC", 9: "UR" };
  return MAP[v] ?? null;
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

function parseBoolLoose(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "t" || s === "positive" || s === "p";
}


function parseGender(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "2" || s === "M" || s === "MALE") return "M";
  if (s === "1" || s === "F" || s === "FEMALE") return "F";
  if (s === "3" || s === "O" || s === "OTHER") return "O";
  return null;
}

function parseEsm(rawCat2, fallback) {
  const s = String(rawCat2 ?? "").trim().toUpperCase();
  if (s === "3") return true;
  if (["Y", "YES", "TRUE", "T", "1"].includes(s)) return true;
  if (["N", "NO", "FALSE", "F", "0"].includes(s)) return false;
  return Boolean(fallback);
}

function getCbeCutoffMap(rules) {
  const ur = Number(rules["cbe.cutoff.urEwsEsmPercent"]);
  const obc = Number(rules["cbe.cutoff.obcPercent"]);
  const scst = Number(rules["cbe.cutoff.scstPercent"]);
  if (Number.isFinite(ur) || Number.isFinite(obc) || Number.isFinite(scst)) {
    return {
      UR: Number.isFinite(ur) ? ur : 0,
      EWS: Number.isFinite(ur) ? ur : 0,
      ESM: Number.isFinite(ur) ? ur : 0,
      OBC: Number.isFinite(obc) ? obc : 0,
      SC: Number.isFinite(scst) ? scst : 0,
      ST: Number.isFinite(scst) ? scst : 0,
    };
  }
  return rules["cbe.cutoffPercent"] ?? { UR: 30, OBC: 25, EWS: 25, SC: 20, ST: 20, ESM: 20 };
}

// ── Tie-breaking ─────────────────────────────────────────────────────────────

function normalizeTieBreakSequence(v) {
  const allowed = new Set(["partA", "partB", "dobOlderFirst", "nameAZ"]);
  const base = Array.isArray(v) ? v.map(String) : [];
  const out = [];
  const seen = new Set();
  for (const x of base) {
    if (!allowed.has(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  for (const x of ["partA", "partB", "dobOlderFirst", "nameAZ"]) {
    if (!seen.has(x)) out.push(x);
  }
  return out.slice(0, 4);
}

/** PDF §14 tie-break comparator. */
function compareForMeritFactory(sequence) {
  const seq = normalizeTieBreakSequence(sequence);
  return (a, b) => {
    if (b.finalMarks !== a.finalMarks) return b.finalMarks - a.finalMarks;
    for (const rule of seq) {
      if (rule === "partA" && b.partAMarks !== a.partAMarks) return b.partAMarks - a.partAMarks;
      if (rule === "partB" && b.partBMarks !== a.partBMarks) return b.partBMarks - a.partBMarks;
      if (rule === "dobOlderFirst" && a.dob && b.dob && a.dob.getTime() !== b.dob.getTime()) {
        return a.dob.getTime() - b.dob.getTime(); // older (smaller timestamp) ranks higher
      }
      if (rule === "nameAZ") {
        const cmp = String(a.name ?? "").localeCompare(String(b.name ?? ""));
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export const processingService = {
  async runPipeline() {
    const k = db();
    const hasEvalTable = await k.schema.hasTable("candidate_rule_eval");
    const rules = await rulesEngine.getActiveRules();
    const tieBreakSeq = rules["tiebreak.sequence"];
    const cbeCutoffMap = getCbeCutoffMap(rules);
    const cbeMaxMarksRaw = Number(rules["cbe.maxMarks"] ?? 100);
    const cbeMaxMarks = Number.isFinite(cbeMaxMarksRaw) && cbeMaxMarksRaw > 0 ? cbeMaxMarksRaw : 100;

    await logService.write("info", "Processing pipeline started (CSV-backed mode)");

    const pageSize = 10_000;
    let page = 0;
    let processed = 0;
    let rejectedCount = 0;
    const meritPool = [];

    while (true) {
      const batch = await k("candidates")
        .select([
          "id",
          "roll_no as rollNo",
          "name",
          "dob",
          "gender",
          "category",
          "is_esm as isEsm",
          "state_code as stateCodeDb",
          "ncc_cert as nccCert",
          "marks_cbe as marksCbe",
          "normalized_marks as normalizedMarks",
          "part_a_marks as partAMarks",
          "part_b_marks as partBMarks",
          "status",
          "raw_data as rawData",
        ])
        .orderBy("id", "asc")
        .offset(page * pageSize)
        .limit(pageSize);

      if (!batch.length) break;

      const updates = [];
      const evalRows = [];

      for (const c of batch) {
        processed += 1;
        const raw = typeof c.rawData === "string" ? JSON.parse(c.rawData) : (c.rawData ?? {});

        // NOTE:
        // to_be_considered / candidature_status gate intentionally removed.
        // Merit processing now does not reject candidates using those fields.

        // ── Extract pre-computed marks ─────────────────────────────────────────
        const totalFromRaw = Number(rawGet(raw, "total", "total_marks_new", "final_marks"));
        const score = Number(rawGet(raw, "score", "marks_cbe", "total_marks"));
        const normalized = Number(rawGet(raw, "nscore", "normalized_score", "normalized_marks"));
        const nccBonus = Number(rawGet(raw, "ncc_bonus", "ncc_marks_new"));
        const computedFromScore = Number.isFinite(score) && Number.isFinite(nccBonus) ? score + nccBonus : null;
        const computedFromNormalized = Number.isFinite(normalized) && Number.isFinite(nccBonus) ? normalized + nccBonus : null;
        const finalMarks = Number.isFinite(totalFromRaw) && totalFromRaw > 0
          ? totalFromRaw
          : Number.isFinite(computedFromScore) && computedFromScore > 0
            ? computedFromScore
            : Number.isFinite(computedFromNormalized) && computedFromNormalized > 0
              ? computedFromNormalized
              : null;

        if (finalMarks == null) {
          rejectedCount += 1;
          updates.push({
            id: c.id,
            status: "rejected",
            finalMarks: null,
            meritRank: null,
            nccCert: c.nccCert,
            category: c.category,
            domicileState: null,
          });
          if (hasEvalTable) {
            evalRows.push({
              candidate_id: c.id,
              qualified: false,
              reasons: JSON.stringify([{ code: "MISSING_TOTAL_MARKS_NEW", message: "total_marks_new is missing or zero in raw_data." }]),
              summary: JSON.stringify({ total_marks_new: raw.total_marks_new }),
            });
          }
          continue;
        }

        // ── Derive effective category from cat1 ───────────────────────────────
        const cat1Category = cat1ToCategory(rawGet(raw, "cat1"));
        const effectiveCategory = cat1Category ?? c.category ?? "UR";
        const effectiveIsEsm = parseEsm(rawGet(raw, "cat2"), c.isEsm);

        // Enforce CBE cutoff rule (category-wise) so low scores fail merit.
        const normalizedScore = Number.isFinite(Number(c.normalizedMarks))
          ? Number(c.normalizedMarks)
          : Number(rawGet(raw, "nscore", "normalized_score", "normalized_marks"));
        const marksCbe = Number.isFinite(Number(c.marksCbe))
          ? Number(c.marksCbe)
          : Number(rawGet(raw, "score", "marks_cbe", "total_marks"));
        const scorePercent = Number.isFinite(normalizedScore)
          ? normalizedScore
          : (Number.isFinite(marksCbe) ? (marksCbe / cbeMaxMarks) * 100 : null);
        const cutoffCategory = effectiveIsEsm ? "ESM" : effectiveCategory;
        const cutoffPercent = Number(cbeCutoffMap[cutoffCategory] ?? cbeCutoffMap.UR ?? 0);
        if (!Number.isFinite(scorePercent) || scorePercent < cutoffPercent) {
          rejectedCount += 1;
          updates.push({
            id: c.id,
            status: "rejected",
            finalMarks: null,
            meritRank: null,
            nccCert: c.nccCert,
            category: effectiveCategory,
            isEsm: effectiveIsEsm,
            gender: parseGender(c.gender) ?? "O",
            domicileState: null,
          });
          if (hasEvalTable) {
            evalRows.push({
              candidate_id: c.id,
              qualified: false,
              reasons: JSON.stringify([{ code: "CBE_BELOW_CUTOFF", message: `scorePercent=${scorePercent ?? "NA"} cutoff=${cutoffPercent}` }]),
              summary: JSON.stringify({ scorePercent, cutoffPercent, cutoffCategory }),
            });
          }
          continue;
        }

        // ── NCC certificate from raw_data (if not already in DB) ─────────────
        const nccCertFromRaw = rawGet(raw, "ncc_cert", "ncc_type_app")
          ? String(rawGet(raw, "ncc_cert", "ncc_type_app")).trim().toUpperCase().replace(/\s+/g, "")
          : null;
        const nccCert = c.nccCert ?? (nccCertFromRaw || null);

        // ── State code for allocation from raw_data ───────────────────────────
        const stateCodeRaw = rawGet(raw, "state_code", "s_code", "statecode_considered_app");
        const stateCode = stateCodeRaw != null && String(stateCodeRaw).trim() !== ""
          ? String(stateCodeRaw).trim()
          : (c.stateCodeDb != null && String(c.stateCodeDb).trim() !== "" ? String(c.stateCodeDb).trim() : null);

        // ── Part marks: prefer DB values, fall back to raw_data ───────────────
        const partAMarks = c.partAMarks != null
          ? Number(c.partAMarks)
          : Number(rawGet(raw, "part_a_marks", "part_a", "parta_gi") ?? 0);
        const partBMarks = c.partBMarks != null
          ? Number(c.partBMarks)
          : Number(rawGet(raw, "part_b_marks", "part_b", "partb_ga") ?? 0);

        // ── DOB ───────────────────────────────────────────────────────────────
        const dob = c.dob ? asDateOnly(new Date(c.dob)) : dobFromAny(rawGet(raw, "dob"));

        // ── Gender (prefer DB, fall back to raw_data) ─────────────────────────
        const rawGender = parseGender(rawGet(raw, "gender", "gender_app"));
        const currentGender = parseGender(c.gender);
        const gender = rawGender ?? currentGender ?? "O";

        updates.push({
          id: c.id,
          status: "cleared",
          finalMarks,
          meritRank: null,
          nccCert,
          category: effectiveCategory,
          isEsm: effectiveIsEsm,
          gender,
          domicileState: stateCode,
        });

        if (hasEvalTable) {
          evalRows.push({
            candidate_id: c.id,
            qualified: true,
            reasons: JSON.stringify([]),
            summary: JSON.stringify({
              totalMarksNew: finalMarks,
              effectiveCategory,
              effectiveIsEsm,
              stateCode,
              nccCert,
            }),
          });
        }

        meritPool.push({
          id: c.id,
          name: c.name ?? "",
          dob: dob ?? new Date(0),
          partAMarks: Number.isFinite(partAMarks) ? partAMarks : 0,
          partBMarks: Number.isFinite(partBMarks) ? partBMarks : 0,
          finalMarks,
          effectiveCategory,
          gender: String(gender ?? "").trim().toUpperCase().slice(0, 1),
          stateCode,
        });
      }

      // Apply batch updates in transaction
      await k.transaction(async (trx) => {
        for (const u of updates) {
          const updatePayload = {
            status: u.status,
            final_marks: u.finalMarks ?? null,
            merit_rank: null,
            ncc_cert: u.nccCert ?? null,
            domicile_state: u.domicileState ?? null,
            state_code: u.domicileState ?? null,
            updated_at: trx.fn.now(),
          };
          // Never write NULL into NOT NULL columns during reject path updates.
          if (u.category != null) updatePayload.category = u.category;
          if (u.isEsm != null) updatePayload.is_esm = u.isEsm;
          if (u.gender != null) updatePayload.gender = u.gender;
          // eslint-disable-next-line no-await-in-loop
          await trx("candidates")
            .where({ id: u.id })
            .update(updatePayload);
        }

        if (hasEvalTable && evalRows.length) {
          // eslint-disable-next-line no-await-in-loop
          await trx("candidate_rule_eval")
            .insert(evalRows.map((r) => ({ ...r, computed_at: trx.fn.now() })))
            .onConflict(["candidate_id"])
            .merge(["qualified", "reasons", "summary", "computed_at"]);
        }
      });

      page += 1;
    }

    await logService.write("info", "Eligibility pass done", {
      processed,
      cleared: meritPool.length,
      rejected: rejectedCount,
    });

    // ── Global merit ranking (PDF §14 tie-breaking order) ────────────────────
    // Sort the full pool globally so that within each state+gender+category sub-pool,
    // the relative order is also correct (state slots only accept their own candidates).
    const cmp = compareForMeritFactory(tieBreakSeq);
    meritPool.sort(cmp);

    // Assign global merit rank (1 = best)
    const rankUpdates = meritPool.map((c, i) => ({ id: c.id, meritRank: i + 1 }));

    const rankChunkSize = 5_000;
    for (let i = 0; i < rankUpdates.length; i += rankChunkSize) {
      const chunk = rankUpdates.slice(i, i + rankChunkSize);
      // eslint-disable-next-line no-await-in-loop
      await k.transaction(async (trx) => {
        for (const u of chunk) {
          // eslint-disable-next-line no-await-in-loop
          await trx("candidates")
            .where({ id: u.id })
            .update({ merit_rank: u.meritRank, updated_at: trx.fn.now() });
        }
      });
    }

    await logService.write("info", "Merit ranks assigned", {
      cleared: meritPool.length,
      processed,
    });

    // ── Force allocation ─────────────────────────────────────────────────────
    const allocationResult = await allocationService.allocateFromMerit();
    await logService.write("info", "Allocation completed", allocationResult);

    return {
      processed,
      cleared: meritPool.length,
      rejected: rejectedCount,
      allocation: allocationResult,
    };
  },
};
