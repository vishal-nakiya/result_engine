import { db } from "../db/knex.js";
import { newId } from "../db/ids.js";

const DEFAULT_RULES = [
  // --- Eligibility (notice / SOP) ---
  {
    ruleKey: "eligibility.indianCitizenship",
    value: true,
    description: "The candidate must be a citizen of India. Yes = Indian citizenship is required.",
    isActive: true,
  },
  {
    ruleKey: "eligibility.minEducationLevel",
    value: "10th",
    description: "Minimum education required for eligibility (10th/12th/Degree/Master/PhD).",
    isActive: true,
  },
  {
    ruleKey: "eligibility.matriculationByDate",
    value: "01/08/2008",
    description:
      "Candidate must have passed Matriculation / 10th from a recognised Board or University on or before this date (DD/MM/YYYY).",
    isActive: true,
  },
  {
    ruleKey: "eligibility.pwdNotEligible",
    value: false,
    description: "Persons with Disabilities (PwD) are not eligible. Yes = exclusion applies.",
    isActive: false,
  },

  // --- Merit computation (notice) ---
  {
    ruleKey: "merit.computationMethod",
    value: "normalized_plus_ncc",
    description: "Final merit formula: normalized_only OR normalized_plus_ncc",
    isActive: true,
  },

  // --- Age eligibility (notice) ---
  {
    ruleKey: "age.dobNotBefore",
    value: "02/08/1998",
    description: "Age group 18 to 23 years — Born not before (DD/MM/YYYY)",
    isActive: true,
  },
  {
    ruleKey: "age.dobNotLaterThan",
    value: "01/08/2003",
    description: "Age group 18 to 23 years — Born not later than (DD/MM/YYYY)",
    isActive: true,
  },
  {
    ruleKey: "age.relaxRiotVictimUrEwsYears",
    value: 5,
    description: "Dependents of victims (UR/EWS) — age relaxation years",
    isActive: false,
  },
  {
    ruleKey: "age.relaxRiotVictimObcYears",
    value: 8,
    description: "Dependents of victims (OBC) — age relaxation years",
    isActive: false,
  },
  {
    ruleKey: "age.relaxRiotVictimScStYears",
    value: 10,
    description: "Dependents of victims (SC/ST) — age relaxation years",
    isActive: false,
  },

  // --- Rules used by processing pipeline (preferred granular keys) ---
  {
    ruleKey: "age.cutoffDate",
    value: "2021-08-01",
    description: "Cut-off date for age eligibility (YYYY-MM-DD)",
    isActive: true,
  },
  {
    ruleKey: "age.minYears",
    value: 18,
    description: "Minimum age in years as on cutoffDate",
    isActive: true,
  },
  {
    ruleKey: "age.maxYearsUr",
    value: 23,
    description: "Maximum age in years for UR as on cutoffDate",
    isActive: true,
  },
  {
    ruleKey: "age.relaxOBCYears",
    value: 3,
    description: "Upper age relaxation years for OBC",
    isActive: false,
  },
  {
    ruleKey: "age.relaxScStYears",
    value: 5,
    description: "Upper age relaxation years for SC/ST",
    isActive: false,
  },
  {
    ruleKey: "age.esmRelaxYears",
    value: 3,
    description: "Additional relaxation years for ESM (service deduction handled separately if implemented)",
    isActive: false,
  },
  {
    ruleKey: "cbe.maxMarks",
    value: 100,
    description: "Maximum marks for CBE (used to convert marks_cbe to percentage for cutoff)",
    isActive: true,
  },
  {
    ruleKey: "cbe.cutoff.urEwsEsmPercent",
    value: 35,
    description: "CBE cutoff percent for UR/EWS/ESM",
    isActive: true,
  },
  {
    ruleKey: "cbe.cutoff.obcPercent",
    value: 33,
    description: "CBE cutoff percent for OBC",
    isActive: true,
  },
  {
    ruleKey: "cbe.cutoff.scstPercent",
    value: 33,
    description: "CBE cutoff percent for SC/ST",
    isActive: true,
  },
  {
    ruleKey: "ncc.bonus.cPercent",
    value: 5,
    description: "NCC C certificate bonus percent for final marks",
    isActive: true,
  },
  {
    ruleKey: "ncc.bonus.bPercent",
    value: 3,
    description: "NCC B certificate bonus percent for final marks",
    isActive: true,
  },
  {
    ruleKey: "ncc.bonus.aPercent",
    value: 2,
    description: "NCC A certificate bonus percent for final marks",
    isActive: true,
  },
  {
    ruleKey: "ncc.blockEsmBonus",
    value: true,
    description: "If true, ESM candidates do not receive NCC bonus",
    isActive: true,
  },
  {
    ruleKey: "tiebreak.sequence",
    value: ["partA", "partB", "dobOlderFirst", "nameAZ"],
    description: "Merit tie-break order",
    isActive: true,
  },

  // --- Physical Standards (PST/PET) (UI reference + config) ---
  { ruleKey: "pst.height.maleUrCm", value: 170, description: "Male UR height (cm)", isActive: false },
  { ruleKey: "pst.height.femaleUrCm", value: 157, description: "Female UR height (cm)", isActive: false },
  { ruleKey: "pst.height.stMaleCm", value: 162.5, description: "ST male height (cm) (excluding NE ST sub-category)", isActive: false },
  { ruleKey: "pst.height.neStatesMalePolicy", value: "NORM", description: "NE states male height standard policy label", isActive: false },
  { ruleKey: "pst.height.gtaMaleCm", value: 157, description: "GTA (Darjeeling) male height (cm)", isActive: false },
  { ruleKey: "pst.chest.maleUnexpandedMinCm", value: 80, description: "Male chest unexpanded minimum (cm)", isActive: false },
  { ruleKey: "pst.chest.expansionMinCm", value: 5, description: "Chest minimum expansion (cm)", isActive: false },
  { ruleKey: "pet.race.maleStandard", value: "5km/24m", description: "PET race male standard (outside Ladakh)", isActive: false },
  { ruleKey: "pet.race.femaleStandard", value: "1.6km/8.5m", description: "PET race female standard (outside Ladakh)", isActive: false },
  { ruleKey: "pst.chest.femalePolicy", value: "VISUAL", description: "Female chest policy label", isActive: false },

  // --- Special Provisions (UI reference + config) ---
  { ruleKey: "special.pwdPolicy", value: "REJECT", description: "PwD policy action", isActive: false },
  { ruleKey: "special.esmPstPetPolicy", value: "EXEMPT", description: "ESM PST/PET exemption policy", isActive: false },
  { ruleKey: "special.esmQuotaPercent", value: "10%", description: "ESM quota percent per category", isActive: false },
  { ruleKey: "special.pregnancyTuPolicy", value: "TU", description: "Pregnancy temporary unfit policy code", isActive: false },
  { ruleKey: "special.areaAllocationSequence", value: "SEQ", description: "Area allocation sequence policy", isActive: false },
  { ruleKey: "special.debarredDbCheck", value: "ACTIVE", description: "Debarred DB check policy", isActive: false },
  { ruleKey: "special.ssfAllIndia", value: "ALL-IN", description: "SSF all-India basis marker", isActive: false },
  { ruleKey: "special.domicileMismatchAction", value: "CANCEL", description: "Domicile mismatch action", isActive: false },

  // --- Backward-compatible composite rules (kept for older UI/logic) ---
  {
    ruleKey: "age.dobRange",
    value: { min: "2002-01-02", max: "2007-01-01" },
    description: "DOB inclusive range for base age eligibility",
    isActive: false,
  },
  {
    ruleKey: "age.relaxationYears",
    value: { SC: 5, ST: 5, OBC: 3, ESM: 3 },
    description: "Age relaxation years by category/ESM",
    isActive: false,
  },
  {
    ruleKey: "cbe.cutoffPercent",
    value: { UR: 35, OBC: 33, EWS: 35, SC: 33, ST: 20, ESM: 35 },
    description: "CBE qualification cutoff percentages",
    isActive: true,
  },
  {
    ruleKey: "ncc.bonusPercent",
    value: { C: 5, B: 3, A: 2 },
    description: "NCC bonus percentages for final marks",
    isActive: true,
  },
  {
    ruleKey: "esm.reservationPercent",
    value: 10,
    description: "ESM reservation percentage within vacancy",
    isActive: true,
  },
  {
    ruleKey: "allocation.priorityOrder",
    value: ["Naxal", "Border", "General"],
    description: "Allocation priority buckets",
    isActive: true,
  },
];

export const rulesEngine = {
  async ensureDefaults() {
    const k = db();
    const existing = await k("rules_config").select(["rule_key as ruleKey"]);
    const keys = new Set(existing.map((r) => r.ruleKey));
    const toCreate = DEFAULT_RULES.filter((r) => !keys.has(r.ruleKey));
    if (!toCreate.length) return;
    const now = new Date();
    await k("rules_config").insert(
      toCreate.map((r) => ({
        id: newId(),
        rule_key: r.ruleKey,
        value: JSON.stringify(r.value),
        description: r.description ?? null,
        is_active: r.isActive,
        created_at: now,
        updated_at: now,
      }))
    );
  },

  async listRules() {
    await this.ensureDefaults();
    const k = db();
    const rows = await k("rules_config").select([
      "id",
      "rule_key as ruleKey",
      "value",
      "description",
      "is_active as isActive",
      "created_at as createdAt",
      "updated_at as updatedAt",
    ]).orderBy("rule_key", "asc");
    return rows.map((r) => {
      if (typeof r.value !== "string") return r;
      try {
        return { ...r, value: JSON.parse(r.value) };
      } catch {
        return { ...r, value: r.value };
      }
    });
  },

  async getActiveRules() {
    await this.ensureDefaults();
    const k = db();
    const rows = await k("rules_config")
      .where({ is_active: true })
      .select(["rule_key as ruleKey", "value"]);
    return Object.fromEntries(
      rows.map((r) => {
        if (typeof r.value !== "string") return [r.ruleKey, r.value];
        try {
          return [r.ruleKey, JSON.parse(r.value)];
        } catch {
          return [r.ruleKey, r.value];
        }
      })
    );
  },

  async upsertRule({ ruleKey, value, description, isActive }) {
    const k = db();
    const now = new Date();
    const payload = {
      id: newId(),
      rule_key: ruleKey,
      value: JSON.stringify(value),
      description: description ?? null,
      is_active: isActive ?? true,
      created_at: now,
      updated_at: now,
    };

    // Postgres upsert
    const [row] = await k("rules_config")
      .insert(payload)
      .onConflict("rule_key")
      .merge({
        value: payload.value,
        description: payload.description,
        ...(typeof isActive === "boolean" ? { is_active: payload.is_active } : {}),
        updated_at: now,
      })
      .returning(["id", "rule_key as ruleKey", "value", "description", "is_active as isActive", "updated_at as updatedAt"]);

    if (typeof row.value !== "string") return { ...row, value: row.value };
    try {
      return { ...row, value: JSON.parse(row.value) };
    } catch {
      return { ...row, value: row.value };
    }
  },

  async deleteRules(ruleKeys) {
    const keys = Array.isArray(ruleKeys) ? ruleKeys.filter(Boolean) : [];
    if (!keys.length) return { deleted: 0 };
    const k = db();
    const deleted = await k("rules_config").whereIn("rule_key", keys).del();
    return { deleted };
  },
};

