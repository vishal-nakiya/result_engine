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
  const MAP = { 0: "UR", 1: "SC", 2: "ST", 6: "OBC", 9: "EWS" };
  return MAP[v] ?? null;
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
          "ncc_cert as nccCert",
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

        // ── Primary gate: SSC pre-computed eligibility flag ───────────────────
        const toBeConsidered = String(raw.to_be_considered ?? "").trim();
        if (toBeConsidered !== "Yes") {
          rejectedCount += 1;
          const reason = raw.candidature_status
            ? `candidature_status=${raw.candidature_status}`
            : "to_be_considered≠Yes";
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
              reasons: JSON.stringify([{ code: "NOT_TO_BE_CONSIDERED", message: reason }]),
              summary: JSON.stringify({ toBeConsidered }),
            });
          }
          continue;
        }

        // ── Extract pre-computed marks ─────────────────────────────────────────
        const totalMarksNew = Number(raw.total_marks_new);
        const finalMarks = Number.isFinite(totalMarksNew) && totalMarksNew > 0 ? totalMarksNew : null;

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
        const cat1Category = cat1ToCategory(raw.cat1);
        const effectiveCategory = cat1Category ?? c.category ?? "UR";

        // ── NCC certificate from raw_data (if not already in DB) ─────────────
        const nccCertFromRaw = raw.ncc_type_app
          ? String(raw.ncc_type_app).trim().toUpperCase().replace(/\s+/g, "")
          : null;
        const nccCert = c.nccCert ?? (nccCertFromRaw || null);

        // ── State code for allocation from raw_data ───────────────────────────
        const stateCodeRaw = raw.statecode_considered_app;
        const stateCode = stateCodeRaw != null && String(stateCodeRaw).trim() !== ""
          ? String(stateCodeRaw).trim()
          : null;

        // ── Part marks: prefer DB values, fall back to raw_data ───────────────
        const partAMarks = c.partAMarks != null
          ? Number(c.partAMarks)
          : Number(raw.parta_gi ?? raw.part_a_marks ?? 0);
        const partBMarks = c.partBMarks != null
          ? Number(c.partBMarks)
          : Number(raw.partb_ga ?? raw.part_b_marks ?? 0);

        // ── DOB ───────────────────────────────────────────────────────────────
        const dob = c.dob ? asDateOnly(new Date(c.dob)) : dobFromAny(raw.dob);

        // ── Gender (prefer DB, fall back to raw_data) ─────────────────────────
        const gender = c.gender ?? raw.gender_app ?? null;

        updates.push({
          id: c.id,
          status: "cleared",
          finalMarks,
          meritRank: null,
          nccCert,
          category: effectiveCategory,
          domicileState: stateCode,
        });

        if (hasEvalTable) {
          evalRows.push({
            candidate_id: c.id,
            qualified: true,
            reasons: JSON.stringify([]),
            summary: JSON.stringify({
              toBeConsidered,
              totalMarksNew: finalMarks,
              effectiveCategory,
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
          // eslint-disable-next-line no-await-in-loop
          await trx("candidates")
            .where({ id: u.id })
            .update({
              status: u.status,
              final_marks: u.finalMarks ?? null,
              merit_rank: null,
              category: u.category,
              ncc_cert: u.nccCert ?? null,
              domicile_state: u.domicileState ?? null,
              updated_at: trx.fn.now(),
            });
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
