import { db } from "../db/knex.js";
import { rulesEngine } from "./rules.engine.js";
import { allocationService } from "./allocation.service.js";
import { logService } from "./log.service.js";

function asDateOnly(d) {
  // keep as Date at midnight UTC to avoid TZ drift in comparisons
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return dt;
}

function dobFromIso(iso) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`);
  return d;
}

function dobFromAny(dateText) {
  const s = String(dateText ?? "").trim();
  if (!s) return null;
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (m) {
    const [_, dd, mm, yyyy] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // YYYY-MM-DD
  const iso = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isNaN(iso.getTime())) return iso;
  return null;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

function getRelaxYears({ category, isEsm }, relaxMap) {
  let r = 0;
  if (category === "SC") r = Math.max(r, relaxMap.SC ?? 0);
  if (category === "ST") r = Math.max(r, relaxMap.ST ?? 0);
  if (category === "OBC") r = Math.max(r, relaxMap.OBC ?? 0);
  if (isEsm) r = Math.max(r, relaxMap.ESM ?? 0);
  return r;
}

function getCbeCutoffPercent({ category, isEsm }, cutoffMap) {
  if (isEsm) return cutoffMap.ESM ?? 20;
  return cutoffMap[category] ?? 0;
}

function getNccBonusPercent(nccCert, bonusMap) {
  if (!nccCert) return 0;
  const key = String(nccCert).trim().toUpperCase();
  return bonusMap[key] ?? 0;
}

function computeFinalMarks(normalizedMarks, nccBonusPercent, cbeMaxMarks) {
  const base = Number(normalizedMarks);
  const max = Number(cbeMaxMarks);
  const bonusBase = Number.isFinite(max) && max > 0 ? max : base;
  const bonus = (bonusBase * Number(nccBonusPercent)) / 100;
  return { finalMarks: base + bonus, bonusMarks: bonus, bonusBase };
}

function parseBoolLoose(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "t" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "f" || s === "0" || s === "no" || s === "n" || s === "") return false;
  return null;
}

function educationRank(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("phd") || s.includes("doctor")) return 6;
  if (s.includes("master")) return 5;
  if (s.includes("degree") || s.includes("graduation") || s.includes("graduate")) return 4;
  if (s.includes("12") || s.includes("10+2") || s.includes("higher secondary") || s.includes("intermediate")) return 3;
  if (s.includes("10") || s.includes("matric")) return 2;
  return 1;
}

function minEducationRank(ruleValue) {
  const s = String(ruleValue ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "10th" || s.includes("matric")) return 2;
  if (s === "12th" || s.includes("10+2") || s.includes("higher secondary")) return 3;
  if (s.includes("degree") || s.includes("graduation")) return 4;
  if (s.includes("master")) return 5;
  if (s.includes("phd")) return 6;
  return null;
}

function normalizeTieBreakSequence(v) {
  const allowed = new Set(["partA", "partB", "dobOlderFirst", "nameAZ"]);
  const base = Array.isArray(v) ? v.map(String) : [];
  const out = [];
  const seen = new Set();
  for (const x of base) {
    if (!allowed.has(x)) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  for (const x of ["partA", "partB", "dobOlderFirst", "nameAZ"]) {
    if (!seen.has(x)) out.push(x);
  }
  return out.slice(0, 4);
}

function compareForMeritFactory(sequence) {
  const seq = normalizeTieBreakSequence(sequence);
  return (a, b) => {
    if (b.finalMarks !== a.finalMarks) return b.finalMarks - a.finalMarks;
    for (const rule of seq) {
      if (rule === "partA" && b.partAMarks !== a.partAMarks) return b.partAMarks - a.partAMarks;
      if (rule === "partB" && b.partBMarks !== a.partBMarks) return b.partBMarks - a.partBMarks;
      if (rule === "dobOlderFirst" && a.dob.getTime() !== b.dob.getTime()) return a.dob.getTime() - b.dob.getTime();
      if (rule === "nameAZ") {
        const cmp = a.name.localeCompare(b.name);
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  };
}

export const processingService = {
  async runPipeline() {
    const k = db();
    const hasEvalTable = await k.schema.hasTable("candidate_rule_eval");
    const rules = await rulesEngine.getActiveRules();
    const dobRange = rules["age.dobRange"];
    const dobNotBefore = rules["age.dobNotBefore"];
    const dobNotLaterThan = rules["age.dobNotLaterThan"];
    const relaxMap = rules["age.relaxationYears"] ?? {};
    const nccBonus = rules["ncc.bonusPercent"] ?? {};
    const blockEsmNcc = Boolean(rules["ncc.blockEsmBonus"] ?? true);
    const meritMethod = String(rules["merit.computationMethod"] ?? "normalized_plus_ncc");
    const tieBreakSeq = rules["tiebreak.sequence"];
    // Eligibility toggles are represented by rule activation (missing => not applied)
    const pwdNotEligible = Boolean(rules["eligibility.pwdNotEligible"] ?? false);
    const minEdu = rules["eligibility.minEducationLevel"];
    const matricBy = rules["eligibility.matriculationByDate"];
    const citizenshipRequired = Boolean(rules["eligibility.indianCitizenship"] ?? false);

    // Prefer granular cutoffs if present
    const cbeCutoff = (() => {
      const ur = rules["cbe.cutoff.urEwsEsmPercent"];
      const obc = rules["cbe.cutoff.obcPercent"];
      const scst = rules["cbe.cutoff.scstPercent"];
      if (ur != null || obc != null || scst != null) {
        return {
          UR: Number(ur ?? 0),
          EWS: Number(ur ?? 0),
          ESM: Number(ur ?? 0),
          OBC: Number(obc ?? 0),
          SC: Number(scst ?? 0),
          ST: Number(scst ?? 0),
        };
      }
      return rules["cbe.cutoffPercent"] ?? {};
    })();

    const cbeMaxMarksRaw = Number(rules["cbe.maxMarks"] ?? 0);
    const cbeMaxMarks = Number.isFinite(cbeMaxMarksRaw) && cbeMaxMarksRaw > 0 ? cbeMaxMarksRaw : null;

    // Prefer granular age config if present
    const derivedDobRange = (() => {
      const cutoffDate = rules["age.cutoffDate"];
      const minYears = rules["age.minYears"];
      const maxYearsUr = rules["age.maxYearsUr"];
      if (!cutoffDate || minYears == null) return null;

      const cutoff = dobFromIso(String(cutoffDate));
      // maxDob = cutoff - minYears
      const maxDob = addYears(asDateOnly(cutoff), -Number(minYears));
      // minDob = cutoff - maxYears + 1 day (inclusive); if maxYears is not set => no upper age limit
      const hasMax = maxYearsUr != null && Number.isFinite(Number(maxYearsUr));
      const minDob = hasMax ? new Date(addYears(asDateOnly(cutoff), -Number(maxYearsUr)).getTime() + 24 * 60 * 60 * 1000) : new Date("1900-01-01T00:00:00.000Z");
      return { min: minDob, max: maxDob };
    })();

    const configuredDobRange = (() => {
      const a = dobFromAny(dobNotBefore);
      const b = dobFromAny(dobNotLaterThan);
      if (a && b) return { min: a, max: b };
      return null;
    })();

    const baseMinDob = configuredDobRange
      ? asDateOnly(configuredDobRange.min)
      : derivedDobRange
        ? asDateOnly(derivedDobRange.min)
        : asDateOnly(dobFromIso(dobRange.min));
    const baseMaxDob = configuredDobRange
      ? asDateOnly(configuredDobRange.max)
      : derivedDobRange
        ? asDateOnly(derivedDobRange.max)
        : asDateOnly(dobFromIso(dobRange.max));

    await logService.write("info", "Processing pipeline started");

    // Load candidates in chunks to scale to lakhs.
    const pageSize = 10_000;
    let page = 0;
    let processed = 0;
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
          "is_pwd as isPwd",
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
        const reasons = [];
        const raw = typeof c.rawData === "string" ? JSON.parse(c.rawData) : c.rawData;
        const summary = {
          rulesVersion: "v1",
          inputs: {
            category: c.category,
            isEsm: Boolean(c.isEsm),
            isPwd: Boolean(c.isPwd),
            marksCbe: c.marksCbe,
            normalizedMarks: c.normalizedMarks,
            partAMarks: c.partAMarks,
            partBMarks: c.partBMarks,
            partCMarks: raw?.partc_maths ?? null,
            partDMarks: raw?.partd_eng_hin ?? null,
            passedMatriculation01012025: raw?.passed_matriculation_01_01_2025 ?? null,
            possessesEssentialQualification: raw?.possesses_essential_qualification ?? null,
            highestEducation: raw?.highest_educational_qualification ?? raw?.qualifying_educational_qualification ?? null,
          },
          computed: {},
        };

        // Pre-compute age range context early so UI can show it
        // even if the candidate fails an earlier rule.
        {
          const relaxYears = getRelaxYears({ category: c.category, isEsm: c.isEsm }, relaxMap);
          const minDob = addYears(baseMinDob, -relaxYears); // older allowed => earlier min
          const maxDob = addYears(baseMaxDob, relaxYears);  // younger allowed => later max
          const dob = asDateOnly(c.dob);
          summary.computed.age = {
            relaxYears,
            minDob: minDob.toISOString().slice(0, 10),
            maxDob: maxDob.toISOString().slice(0, 10),
            dob: dob.toISOString().slice(0, 10),
          };
        }

        // Pre-compute CBE cutoff context early so the UI can show it
        // even if the candidate fails an earlier rule.
        {
          const cutoffPercent = getCbeCutoffPercent({ category: c.category, isEsm: c.isEsm }, cbeCutoff);
          const marksCbeNum = Number(c.marksCbe);
          const marksCbe = Number.isFinite(marksCbeNum) ? marksCbeNum : null;
          const computedPercent = marksCbe == null ? null : cbeMaxMarks ? (marksCbe / cbeMaxMarks) * 100 : marksCbe;
          summary.computed.cbeCutoff = { cutoffPercent, marksCbe, maxMarks: cbeMaxMarks, computedPercent };
        }

        // Pre-compute merit context early (if normalized is available)
        {
          const includeNcc = meritMethod !== "normalized_only";
          const bonusPercent = !includeNcc ? 0 : c.isEsm && blockEsmNcc ? 0 : getNccBonusPercent(c.nccCert, nccBonus);
          const canCompute = c.normalizedMarks != null && Number.isFinite(Number(c.normalizedMarks));
          if (canCompute) {
            const { finalMarks, bonusMarks, bonusBase } = computeFinalMarks(c.normalizedMarks, bonusPercent, cbeMaxMarks);
            summary.computed.merit = { includeNcc, bonusPercent, bonusMarks, bonusBase, finalMarks };
          } else {
            summary.computed.merit = { includeNcc, bonusPercent, bonusMarks: null, bonusBase: cbeMaxMarks ?? null, finalMarks: null };
          }
        }

        // Eligibility: Citizenship (only if present in data; otherwise can't validate)
        if (citizenshipRequired) {
          const citizenship = raw?.citizenship ?? raw?.nationality ?? null;
          if (citizenship != null) {
            const ok = String(citizenship).toLowerCase().includes("india");
            summary.computed.citizenship = { required: true, citizenship };
            if (!ok) {
              reasons.push({ code: "CITIZENSHIP_NOT_INDIAN", message: "Indian citizenship required.", details: summary.computed.citizenship });
              updates.push({ id: c.id, status: "rejected", finalMarks: null, meritRank: null });
              if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: false, reasons: JSON.stringify(reasons), summary: JSON.stringify(summary) });
              continue;
            }
          }
        }

        // Eligibility: Matriculation by date (SSC export provides a boolean-like column)
        if (matricBy) {
          const passed = parseBoolLoose(raw?.passed_matriculation_01_01_2025);
          summary.computed.matriculation = { byDate: matricBy, passed };
          if (passed === false || passed === null) {
            reasons.push({
              code: "MATRICULATION_NOT_PASSED",
              message: "Matriculation not passed by the required cut-off date.",
              details: summary.computed.matriculation,
            });
            updates.push({ id: c.id, status: "rejected", finalMarks: null, meritRank: null });
            if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: false, reasons: JSON.stringify(reasons), summary: JSON.stringify(summary) });
            continue;
          }
        }

        // Eligibility: Essential qualification present (if SSC export has it)
        const essential = String(raw?.possesses_essential_qualification ?? "").trim().toLowerCase();
        if (essential) {
          const ok = essential === "yes" || essential === "true" || essential === "t";
          summary.computed.essentialQualification = { essential };
          if (!ok) {
            reasons.push({ code: "ESSENTIAL_QUALIFICATION_MISSING", message: "Essential qualification not possessed.", details: summary.computed.essentialQualification });
            updates.push({ id: c.id, status: "rejected", finalMarks: null, meritRank: null });
            if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: false, reasons: JSON.stringify(reasons), summary: JSON.stringify(summary) });
            continue;
          }
        }

        // Eligibility: Minimum education level (best-effort based on SSC text fields)
        if (minEdu) {
          const need = minEducationRank(minEdu);
          const have = educationRank(raw?.highest_educational_qualification ?? raw?.qualifying_educational_qualification);
          summary.computed.education = { minEducationLevel: minEdu, need, have };
          if (need != null && have != null && have < need) {
            reasons.push({ code: "EDUCATION_BELOW_MIN", message: "Education level below minimum requirement.", details: summary.computed.education });
            updates.push({ id: c.id, status: "rejected", finalMarks: null, meritRank: null });
            if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: false, reasons: JSON.stringify(reasons), summary: JSON.stringify(summary) });
            continue;
          }
        }

        // Rejection rules
        if (pwdNotEligible && c.isPwd) {
          reasons.push({ code: "PWD_NOT_ELIGIBLE", message: "PWD candidates are not eligible (rule enabled)." });
          updates.push({ id: c.id, status: "rejected", finalMarks: null, meritRank: null });
          if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: false, reasons: JSON.stringify(reasons), summary: JSON.stringify(summary) });
          continue;
        }
        if (c.status === "debarred") {
          reasons.push({ code: "DEBARRED", message: "Candidate is debarred." });
          updates.push({ id: c.id, status: "rejected", finalMarks: null, meritRank: null });
          if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: false, reasons: JSON.stringify(reasons), summary: JSON.stringify(summary) });
          continue;
        }
        if (c.normalizedMarks == null || c.partAMarks == null || c.partBMarks == null || c.marksCbe == null) {
          reasons.push({ code: "MISSING_MARKS", message: "Required marks fields missing (normalized/partA/partB/score)." });
          updates.push({ id: c.id, status: "rejected", finalMarks: null, meritRank: null });
          if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: false, reasons: JSON.stringify(reasons), summary: JSON.stringify(summary) });
          continue;
        }

        // Age validation (DOB within range, with relaxation widening range)
        const dob = asDateOnly(c.dob);
        const minDob = dobFromIso(String(summary.computed.age.minDob));
        const maxDob = dobFromIso(String(summary.computed.age.maxDob));
        if (dob < minDob || dob > maxDob) {
          reasons.push({
            code: "AGE_OUT_OF_RANGE",
            message: "DOB not within allowed range after relaxation.",
            details: summary.computed.age,
          });
          updates.push({ id: c.id, status: "rejected", finalMarks: null, meritRank: null });
          if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: false, reasons: JSON.stringify(reasons), summary: JSON.stringify(summary) });
          continue;
        }

        // CBE qualification (based on marksCbe percentage)
        const cutoffPercent = summary.computed.cbeCutoff?.cutoffPercent;
        const computedPercent = summary.computed.cbeCutoff?.computedPercent;
        if (Number(computedPercent) < Number(cutoffPercent)) {
          reasons.push({
            code: "CBE_BELOW_CUTOFF",
            message: "CBE score below cutoff.",
            details: summary.computed.cbeCutoff,
          });
          updates.push({ id: c.id, status: "rejected", finalMarks: null, meritRank: null });
          if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: false, reasons: JSON.stringify(reasons), summary: JSON.stringify(summary) });
          continue;
        }

        // Merit final marks (already computed)
        const finalMarks = summary.computed.merit?.finalMarks;

        // Cleared into pool
        updates.push({ id: c.id, status: "cleared", finalMarks, meritRank: null });
        if (hasEvalTable) evalRows.push({ candidate_id: c.id, qualified: true, reasons: JSON.stringify([]), summary: JSON.stringify(summary) });
        meritPool.push({
          id: c.id,
          name: c.name,
          dob,
          partAMarks: Number(c.partAMarks),
          partBMarks: Number(c.partBMarks),
          finalMarks,
        });
      }

      // Apply updates in transaction (chunked)
      await k.transaction(async (trx) => {
        for (const u of updates) {
          // eslint-disable-next-line no-await-in-loop
          await trx("candidates")
            .where({ id: u.id })
            .update({
              status: u.status,
              final_marks: u.finalMarks == null ? null : u.finalMarks,
              merit_rank: null,
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

    meritPool.sort(compareForMeritFactory(tieBreakSeq));

    // Store merit ranks (chunked transaction)
    const rankUpdates = [];
    for (let i = 0; i < meritPool.length; i += 1) {
      rankUpdates.push({ id: meritPool[i].id, meritRank: i + 1 });
    }
    const rankChunkSize = 5000;
    for (let i = 0; i < rankUpdates.length; i += rankChunkSize) {
      const chunk = rankUpdates.slice(i, i + rankChunkSize);
      // eslint-disable-next-line no-await-in-loop
      await k.transaction(async (trx) => {
        for (const u of chunk) {
          // eslint-disable-next-line no-await-in-loop
          await trx("candidates").where({ id: u.id }).update({ merit_rank: u.meritRank, updated_at: trx.fn.now() });
        }
      });
    }

    await logService.write("info", "Merit ranking stored", { cleared: meritPool.length, processed });

    // Allocate
    const allocationResult = await allocationService.allocateFromMerit();
    await logService.write("info", "Allocation completed", allocationResult);

    return {
      processed,
      cleared: meritPool.length,
      allocation: allocationResult,
    };
  },
};

