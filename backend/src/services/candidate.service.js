import { db } from "../db/knex.js";
import { rulesEngine } from "./rules.engine.js";
import { applyFilterGroup, filterGroupUsesCre } from "./candidate-list-filter.js";

function asDateOnly(d) {
  // keep as Date at midnight UTC to avoid TZ drift in comparisons
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return dt;
}

function dobFromIso(iso) {
  const d = dobFromAny(iso);
  if (!d) throw new Error(`Invalid date: ${iso}`);
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

function computeMeritFromRules({ normalizedMarks, nccBonusPercent, cbeMaxMarks }) {
  const base = Number(normalizedMarks);
  if (!Number.isFinite(base)) return { finalMarks: null, bonusMarks: null, bonusBase: null };
  const max = Number(cbeMaxMarks);
  const bonusBase = Number.isFinite(max) && max > 0 ? max : base;
  const bonusMarks = (bonusBase * Number(nccBonusPercent)) / 100;
  return { finalMarks: base + bonusMarks, bonusMarks, bonusBase };
}

function buildWhere({ q, category, gender, status }) {
  return { q, category, gender, status };
}

export const candidateService = {
  async listCandidates({ page, pageSize, q, category, gender, status, includeEval, filterGroup }) {
    const k = db();
    const w = buildWhere({ q, category, gender, status });
    const needsCreJoin = Boolean(includeEval) || filterGroupUsesCre(filterGroup);

    let base = k("candidates");
    if (needsCreJoin) {
      base = base.leftJoin("candidate_rule_eval as cre", "cre.candidate_id", "candidates.id");
    }

    base = base.modify((qb) => {
      if (w.category) qb.where("candidates.category", w.category);
      if (w.gender) {
        const g = String(w.gender).toUpperCase();
        if (g === "M") qb.whereIn("candidates.gender", ["M", "m", "2", "MALE", "Male", "male"]);
        else if (g === "F") qb.whereIn("candidates.gender", ["F", "f", "1", "FEMALE", "Female", "female"]);
        else qb.where("candidates.gender", w.gender);
      }
      if (w.status) qb.where("candidates.status", w.status);
      if (w.q) {
        const like = `%${w.q}%`;
        qb.andWhere((b) => {
          b.whereILike("candidates.roll_no", like)
            .orWhereILike("candidates.name", like)
            .orWhereILike("candidates.father_name", like);
        });
      }
      if (filterGroup) applyFilterGroup(qb, filterGroup);
    });

    const rowsQuery = base.clone();

    const [totalRow, rows] = await Promise.all([
      needsCreJoin
        ? base.clone().clearOrder().countDistinct({ c: "candidates.id" }).first()
        : base.clone().count("* as c").first(),
      rowsQuery
        .select([
          "candidates.id as id",
          "candidates.roll_no as rollNo",
          "candidates.name as name",
          "candidates.father_name as fatherName",
          "candidates.dob as dob",
          "candidates.gender as gender",
          "candidates.category as category",
          "candidates.is_esm as isEsm",
          "candidates.domicile_state as domicileState",
          "candidates.district as district",
          "candidates.ncc_cert as nccCert",
          "candidates.marks_cbe as marksCbe",
          "candidates.normalized_marks as normalizedMarks",
          "candidates.part_c_marks as partCMarks",
          "candidates.part_d_english_marks as partDEnglishMarks",
          "candidates.part_d_hindi_marks as partDHindiMarks",
          "candidates.ncc_bonus_marks as nccBonusMarks",
          "candidates.post_preference as postPreference",
          "candidates.state_code as stateCode",
          "candidates.district_code as districtCode",
          "candidates.final_marks as finalMarks",
          "candidates.merit_rank as meritRank",
          "candidates.status as status",
          "candidates.raw_data as rawData",
          ...(includeEval ? ["cre.qualified as qualified", "cre.reasons as ruleReasons", "cre.summary as ruleSummary"] : []),
        ])
        .orderBy("candidates.updated_at", "desc")
        .offset((page - 1) * pageSize)
        .limit(pageSize),
    ]);

    const rules = includeEval ? await rulesEngine.getActiveRules() : null;
    const cbeMaxMarksRaw = includeEval ? Number(rules?.["cbe.maxMarks"] ?? 0) : 0;
    const cbeMaxMarks = Number.isFinite(cbeMaxMarksRaw) && cbeMaxMarksRaw > 0 ? cbeMaxMarksRaw : null;

    const normalizedRows = rows.map((r) => {
      const rawData = typeof r.rawData === "string" ? JSON.parse(r.rawData) : r.rawData;
      const ruleReasons = typeof r.ruleReasons === "string" ? JSON.parse(r.ruleReasons) : r.ruleReasons;
      const ruleSummary = typeof r.ruleSummary === "string" ? JSON.parse(r.ruleSummary) : r.ruleSummary;

      // Backfill maxMarks in older summaries so frontend can compute NCC bonus marks correctly.
      if (includeEval && ruleSummary && typeof ruleSummary === "object") {
        ruleSummary.computed = ruleSummary.computed && typeof ruleSummary.computed === "object" ? ruleSummary.computed : {};
        ruleSummary.computed.cbeCutoff =
          ruleSummary.computed.cbeCutoff && typeof ruleSummary.computed.cbeCutoff === "object" ? ruleSummary.computed.cbeCutoff : {};
        if (ruleSummary.computed.cbeCutoff.maxMarks == null) {
          ruleSummary.computed.cbeCutoff.maxMarks = cbeMaxMarks;
        }
        ruleSummary.computed.merit =
          ruleSummary.computed.merit && typeof ruleSummary.computed.merit === "object" ? ruleSummary.computed.merit : {};
        if (ruleSummary.computed.merit.bonusBase == null) {
          ruleSummary.computed.merit.bonusBase = cbeMaxMarks;
        }
      }

      return { ...r, rawData, ruleReasons, ruleSummary };
    });

    return { page, pageSize, total: Number(totalRow?.c ?? 0), rows: normalizedRows };
  },

  async getCandidate(id) {
    const k = db();
    const candidate = await k("candidates")
      .where({ id })
      .first([
        "id",
        "roll_no as rollNo",
        "name",
        "father_name as fatherName",
        "dob",
        "gender",
        "category",
        "is_esm as isEsm",
        "domicile_state as domicileState",
        "district",
        "height",
        "chest",
        "weight",
        "is_pwd as isPwd",
        "ncc_cert as nccCert",
        "marks_cbe as marksCbe",
        "normalized_marks as normalizedMarks",
        "part_a_marks as partAMarks",
        "part_b_marks as partBMarks",
        "part_c_marks as partCMarks",
        "part_d_english_marks as partDEnglishMarks",
        "part_d_hindi_marks as partDHindiMarks",
        "ncc_bonus_marks as nccBonusMarks",
        "post_preference as postPreference",
        "state_code as stateCode",
        "district_code as districtCode",
        "final_marks as finalMarks",
        "merit_rank as meritRank",
        "status",
        "raw_data as rawData",
      ]);
    if (!candidate) return null;

    let ruleEval = null;
    try {
      // Table may not exist in older DBs.
      // eslint-disable-next-line no-await-in-loop
      ruleEval = await k("candidate_rule_eval")
        .where({ candidate_id: id })
        .first(["qualified", "reasons", "summary", "computed_at as computedAt"]);
    } catch {
      ruleEval = null;
    }

    const [examStages, allocation] = await Promise.all([
      k("exam_stages")
        .where({ candidate_id: id })
        .select(["id", "candidate_id as candidateId", "stage", "status", "remarks", "created_at as createdAt"])
        .orderBy("created_at", "asc"),
      k("allocation")
        .where({ candidate_id: id })
        .first([
          "id",
          "candidate_id as candidateId",
          "force_code as forceCode",
          "category_allocated as categoryAllocated",
          "state_allocated as stateAllocated",
          "district_allocated as districtAllocated",
          "merit_rank as meritRank",
          "created_at as createdAt",
        ]),
    ]);

    const rawData = typeof candidate.rawData === "string" ? JSON.parse(candidate.rawData) : candidate.rawData;
    // eslint-disable-next-line no-unused-vars
    const { rawData: _rawData, ...rest } = candidate;

    const rules = await rulesEngine.getActiveRules();

    function enrichSummary(summaryIn) {
      const summary = summaryIn && typeof summaryIn === "object" ? summaryIn : { rulesVersion: "v1", inputs: {}, computed: {} };
      summary.inputs = summary.inputs && typeof summary.inputs === "object" ? summary.inputs : {};
      summary.computed = summary.computed && typeof summary.computed === "object" ? summary.computed : {};

      // Ensure optional Part-C/Part-D are available for UI
      if (summary.inputs.partCMarks == null) summary.inputs.partCMarks = rawData?.partc_maths ?? null;
      if (summary.inputs.partDMarks == null) summary.inputs.partDMarks = rawData?.partd_eng_hin ?? null;

      const relaxMap = rules["age.relaxationYears"] ?? {};
      const nccBonusMap = rules["ncc.bonusPercent"] ?? {};
      const blockEsmNcc = Boolean(rules["ncc.blockEsmBonus"] ?? true);
      const meritMethod = String(rules["merit.computationMethod"] ?? "normalized_plus_ncc");
      const cbeMaxMarksRaw = Number(rules["cbe.maxMarks"] ?? 0);
      const cbeMaxMarks = Number.isFinite(cbeMaxMarksRaw) && cbeMaxMarksRaw > 0 ? cbeMaxMarksRaw : null;

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

      const derivedDobRange = (() => {
        const cutoffDate = rules["age.cutoffDate"];
        const minYears = rules["age.minYears"];
        const maxYearsUr = rules["age.maxYearsUr"];
        if (!cutoffDate || minYears == null) return null;
        const cutoff = dobFromIso(String(cutoffDate));
        const maxDob = addYears(asDateOnly(cutoff), -Number(minYears));
        const hasMax = maxYearsUr != null && Number.isFinite(Number(maxYearsUr));
        const minDob = hasMax
          ? new Date(addYears(asDateOnly(cutoff), -Number(maxYearsUr)).getTime() + 24 * 60 * 60 * 1000)
          : new Date("1900-01-01T00:00:00.000Z");
        return { min: minDob, max: maxDob };
      })();

      const configuredDobRange = (() => {
        const a = dobFromAny(rules["age.dobNotBefore"]);
        const b = dobFromAny(rules["age.dobNotLaterThan"]);
        if (a && b) return { min: a, max: b };
        return null;
      })();

      const dobRange = rules["age.dobRange"];
      const baseMinDob = configuredDobRange
        ? asDateOnly(configuredDobRange.min)
        : derivedDobRange
          ? asDateOnly(derivedDobRange.min)
          : dobRange?.min
            ? asDateOnly(dobFromIso(dobRange.min))
            : asDateOnly(new Date("1900-01-01T00:00:00.000Z"));
      const baseMaxDob = configuredDobRange
        ? asDateOnly(configuredDobRange.max)
        : derivedDobRange
          ? asDateOnly(derivedDobRange.max)
          : dobRange?.max
            ? asDateOnly(dobFromIso(dobRange.max))
            : asDateOnly(new Date("2100-01-01T00:00:00.000Z"));

      // Backfill age details (even if partial object exists)
      {
        const age = summary.computed.age && typeof summary.computed.age === "object" ? summary.computed.age : {};
        const needs = age.minDob == null || age.maxDob == null || age.dob == null || age.relaxYears == null;
        if (needs) {
          const relaxYears = getRelaxYears({ category: rest.category, isEsm: rest.isEsm }, relaxMap);
          const minDob = addYears(baseMinDob, -relaxYears);
          const maxDob = addYears(baseMaxDob, relaxYears);
          const dob = asDateOnly(rest.dob instanceof Date ? rest.dob : dobFromIso(String(rest.dob).slice(0, 10)));
          summary.computed.age = {
            ...age,
            relaxYears,
            minDob: minDob.toISOString().slice(0, 10),
            maxDob: maxDob.toISOString().slice(0, 10),
            dob: dob.toISOString().slice(0, 10),
          };
        } else {
          summary.computed.age = age;
        }
      }

      // Backfill CBE cutoff details (even if partial object exists)
      {
        const cc = summary.computed.cbeCutoff && typeof summary.computed.cbeCutoff === "object" ? summary.computed.cbeCutoff : {};
        if (cc.cutoffPercent == null) {
          cc.cutoffPercent = getCbeCutoffPercent({ category: rest.category, isEsm: rest.isEsm }, cbeCutoff);
        }
        if (cc.marksCbe == null) {
          const marksCbeNum = Number(rest.marksCbe);
          cc.marksCbe = Number.isFinite(marksCbeNum) ? marksCbeNum : null;
        }
        if (cc.maxMarks == null) {
          cc.maxMarks = cbeMaxMarks;
        }
        summary.computed.cbeCutoff = cc;
      }

      // Backfill merit details (even if partial object exists)
      {
        const m = summary.computed.merit && typeof summary.computed.merit === "object" ? summary.computed.merit : {};
        if (m.includeNcc == null) m.includeNcc = meritMethod !== "normalized_only";
        if (m.bonusPercent == null) {
          m.bonusPercent = !m.includeNcc ? 0 : rest.isEsm && blockEsmNcc ? 0 : getNccBonusPercent(rest.nccCert, nccBonusMap);
        }
        const needCompute = m.bonusMarks == null || m.bonusBase == null || m.finalMarks == null;
        if (needCompute) {
          const { finalMarks, bonusMarks, bonusBase } = computeMeritFromRules({
            normalizedMarks: rest.normalizedMarks,
            nccBonusPercent: m.bonusPercent,
            cbeMaxMarks,
          });
          if (m.bonusMarks == null) m.bonusMarks = bonusMarks;
          if (m.bonusBase == null) m.bonusBase = bonusBase;
          if (m.finalMarks == null) m.finalMarks = finalMarks;
        }
        summary.computed.merit = m;
      }

      return summary;
    }

    // If rule-eval row is missing, compute it on-demand so UI always has an explanation.
    let computedEval = null;
    if (!ruleEval) {
      const relaxMap = rules["age.relaxationYears"] ?? {};
      const pwdNotEligible = Boolean(rules["eligibility.pwdNotEligible"] ?? false);

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

      const derivedDobRange = (() => {
        const cutoffDate = rules["age.cutoffDate"];
        const minYears = rules["age.minYears"];
        const maxYearsUr = rules["age.maxYearsUr"];
        if (!cutoffDate || minYears == null) return null;
        const cutoff = dobFromIso(String(cutoffDate));
        const maxDob = addYears(asDateOnly(cutoff), -Number(minYears));
        const hasMax = maxYearsUr != null && Number.isFinite(Number(maxYearsUr));
        const minDob = hasMax
          ? new Date(addYears(asDateOnly(cutoff), -Number(maxYearsUr)).getTime() + 24 * 60 * 60 * 1000)
          : new Date("1900-01-01T00:00:00.000Z");
        return { min: minDob, max: maxDob };
      })();

      const configuredDobRange = (() => {
        const a = dobFromAny(rules["age.dobNotBefore"]);
        const b = dobFromAny(rules["age.dobNotLaterThan"]);
        if (a && b) return { min: a, max: b };
        return null;
      })();

      const dobRange = rules["age.dobRange"];
      const baseMinDob = configuredDobRange
        ? asDateOnly(configuredDobRange.min)
        : derivedDobRange
          ? asDateOnly(derivedDobRange.min)
          : dobRange?.min
            ? asDateOnly(dobFromIso(dobRange.min))
            : asDateOnly(new Date("1900-01-01T00:00:00.000Z"));
      const baseMaxDob = configuredDobRange
        ? asDateOnly(configuredDobRange.max)
        : derivedDobRange
          ? asDateOnly(derivedDobRange.max)
          : dobRange?.max
            ? asDateOnly(dobFromIso(dobRange.max))
            : asDateOnly(new Date("2100-01-01T00:00:00.000Z"));

      const reasons = [];
      const summary = enrichSummary({
        rulesVersion: "v1",
        inputs: {
          category: rest.category,
          isEsm: Boolean(rest.isEsm),
          isPwd: Boolean(rest.isPwd),
          marksCbe: rest.marksCbe,
          normalizedMarks: rest.normalizedMarks,
          partAMarks: rest.partAMarks,
          partBMarks: rest.partBMarks,
          partCMarks: rawData?.partc_maths ?? null,
          partDMarks: rawData?.partd_eng_hin ?? null,
        },
        computed: {},
      });

      if (pwdNotEligible && rest.isPwd) reasons.push({ code: "PWD_NOT_ELIGIBLE", message: "PWD candidates are not eligible (rule enabled)." });
      if (String(rest.status) === "debarred") reasons.push({ code: "DEBARRED", message: "Candidate is debarred." });
      if (rest.normalizedMarks == null || rest.partAMarks == null || rest.partBMarks == null || rest.marksCbe == null) {
        reasons.push({ code: "MISSING_MARKS", message: "Required marks fields missing (normalized/partA/partB/score)." });
      }

      const dob = asDateOnly(rest.dob instanceof Date ? rest.dob : dobFromIso(String(rest.dob).slice(0, 10)));
      const minDob = dobFromIso(String(summary.computed.age.minDob));
      const maxDob = dobFromIso(String(summary.computed.age.maxDob));
      if (dob < minDob || dob > maxDob) {
        reasons.push({ code: "AGE_OUT_OF_RANGE", message: "DOB not within allowed range after relaxation.", details: summary.computed.age });
      }

      const cutoffPercent = summary.computed.cbeCutoff?.cutoffPercent;
      const computedPercent = (() => {
        const marks = Number(rest.marksCbe);
        if (!Number.isFinite(marks)) return null;
        const max = Number(summary.computed.cbeCutoff?.maxMarks);
        return Number.isFinite(max) && max > 0 ? (marks / max) * 100 : marks;
      })();
      if (Number(computedPercent) < Number(cutoffPercent)) {
        reasons.push({ code: "CBE_BELOW_CUTOFF", message: "CBE score below cutoff.", details: summary.computed.cbeCutoff });
      }

      computedEval = {
        qualified: reasons.length === 0 && String(rest.status).toLowerCase() === "cleared",
        reasons,
        summary,
        computedAt: new Date().toISOString(),
      };
    }

    return {
      ...rest,
      rawData,
      examStages,
      allocation: allocation ?? null,
      ruleEval: ruleEval
        ? (() => {
            const reasons = typeof ruleEval.reasons === "string" ? JSON.parse(ruleEval.reasons) : ruleEval.reasons;
            const summary = typeof ruleEval.summary === "string" ? JSON.parse(ruleEval.summary) : ruleEval.summary;
            return {
              qualified: Boolean(ruleEval.qualified),
              reasons,
              summary: enrichSummary(summary),
              computedAt: ruleEval.computedAt,
            };
          })()
        : computedEval,
    };
  },
};

