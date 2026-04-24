"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:4000/api";

const RULE_DEFS = {
  eligibility: {
    title: "Eligibility",
    count: "4 rules",
    items: [
      {
        id: "elig-citizen",
        ruleKey: "eligibility.indianCitizenship",
        group: "eligibility",
        name: "The candidate must be a citizen of India",
        desc: "Yes = Indian citizenship is required for eligibility.",
        kind: "yesno",
        fmt: (v) => (v === true ? "Yes" : "No"),
      },
      {
        id: "elig-edu",
        ruleKey: "eligibility.minEducationLevel",
        group: "eligibility",
        name: "Minimum education",
        desc: "Select minimum education required for eligibility.",
        kind: "education_level",
        fmt: (v) => String(v ?? "10th"),
      },
      {
        id: "elig-matric",
        ruleKey: "eligibility.matriculationByDate",
        group: "eligibility",
        name: "Passed Matriculation / 10th from a recognised Board or University on or before",
        desc: "Enter date as DD/MM/YYYY (slashes are fixed; day 01–31, month 01–12).",
        kind: "date_ddmmyyyy",
        fmt: (v) => String(v ?? "—"),
      },
      {
        id: "elig-pwd",
        ruleKey: "eligibility.pwdNotEligible",
        group: "eligibility",
        name: "Persons with Disabilities (PwD) are not eligible",
        desc: "Yes = PwD exclusion policy applies during validation.",
        kind: "yesno",
        fmt: (v) => (v === true ? "Yes" : "No"),
      },
    ],
  },
  merit: {
    title: "Merit Computation",
    count: "1 rule",
    items: [
      {
        id: "merit-method",
        ruleKey: "merit.computationMethod",
        group: "merit",
        name: "Final merit is based on",
        desc: "Choose the marks formula used for final merit ranking.",
        kind: "merit_method",
        fmt: (v) => String(v ?? "normalized_plus_ncc"),
      },
    ],
  },
  cbe: {
    title: "CBE Cutoff Marks",
    count: "4 rules",
    items: [
      {
        id: "cbe-max",
        ruleKey: "cbe.maxMarks",
        group: "cbe",
        name: "CBE maximum marks",
        desc: "Used to compute CBE percentage for cutoff: (marks_cbe / maxMarks) × 100. Set blank/0 to treat marks_cbe as already a percent.",
        fmt: (v) => `${Number(v ?? 0)} marks`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
      {
        id: "cbe-ur",
        ruleKey: "cbe.cutoff.urEwsEsmPercent",
        group: "cbe",
        name: "UR / EWS / ESM minimum qualifying %",
        desc: "Applied to normalised CBE marks only (no NCC bonus at cutoff stage)",
        fmt: (v) => `${Number(v ?? 0)}%`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
      {
        id: "cbe-obc",
        ruleKey: "cbe.cutoff.obcPercent",
        group: "cbe",
        name: "OBC minimum qualifying %",
        desc: "Separate cutoff for OBC candidates",
        fmt: (v) => `${Number(v ?? 0)}%`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
      {
        id: "cbe-sc",
        ruleKey: "cbe.cutoff.scstPercent",
        group: "cbe",
        name: "SC / ST minimum qualifying %",
        desc: "SC and ST reserved categories cutoff",
        fmt: (v) => `${Number(v ?? 0)}%`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
    ],
  },
  ncc: {
    title: "NCC Bonus Marks",
    count: "4 rules",
    items: [
      {
        id: "ncc-c",
        ruleKey: "ncc.bonus.cPercent",
        group: "ncc",
        name: "NCC 'C' Certificate bonus",
        desc: "5% of max marks (100); added after cutoff clearance; not for ESM",
        fmt: (v) => `+${Number(v ?? 0)} marks`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
      {
        id: "ncc-b",
        ruleKey: "ncc.bonus.bPercent",
        group: "ncc",
        name: "NCC 'B' Certificate bonus",
        desc: "3% of max marks; added provisionally until DV",
        fmt: (v) => `+${Number(v ?? 0)} marks`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
      {
        id: "ncc-a",
        ruleKey: "ncc.bonus.aPercent",
        group: "ncc",
        name: "NCC 'A' Certificate bonus",
        desc: "2% of max marks; revoked at DV if certificate not produced",
        fmt: (v) => `+${Number(v ?? 0)} marks`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
      {
        id: "ncc-esm-block",
        ruleKey: "ncc.blockEsmBonus",
        group: "ncc",
        name: "Block NCC bonus for ESM candidates",
        desc: "ESM candidates are NOT eligible for NCC bonus marks",
        kind: "bool_dropdown",
        fmt: (v) => (v ? "TRUE" : "FALSE"),
        parse: (t) => String(t).trim().toUpperCase() === "TRUE",
      },
    ],
  },
  pst: {
    title: "Physical Standards (PST/PET)",
    count: "10 rules",
    items: [
      {
        id: "pst-m-ht",
        ruleKey: "pst.height.maleUrCm",
        group: "pst",
        name: "Male UR height ≥ 170 cm",
        desc: "General standard for male candidates; Garhwali/Kumaoni/Dogra/Maratha: 165 cm",
        fmt: (v) => `${Number(v ?? 0)} cm`,
        parse: (t) => Number(String(t).replace(/[^0-9.]+/g, "")) || 0,
      },
      {
        id: "pst-f-ht",
        ruleKey: "pst.height.femaleUrCm",
        group: "pst",
        name: "Female UR height ≥ 157 cm",
        desc: "General standard for female candidates",
        fmt: (v) => `${Number(v ?? 0)} cm`,
        parse: (t) => Number(String(t).replace(/[^0-9.]+/g, "")) || 0,
      },
      {
        id: "pst-st-m",
        ruleKey: "pst.height.stMaleCm",
        group: "pst",
        name: "ST male height — 162.5 cm",
        desc: "All ST male candidates (excluding NE ST sub-category)",
        fmt: (v) => `${Number(v ?? 0)} cm`,
        parse: (t) => Number(String(t).replace(/[^0-9.]+/g, "")) || 0,
      },
      {
        id: "pst-ne-m",
        ruleKey: "pst.height.neStatesMalePolicy",
        group: "pst",
        name: "NE States male height — 162.5 cm (standard)",
        desc: "NE candidates (AP, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, Tripura): 162.5 cm is their norm, NOT a relaxation",
        fmt: (v) => String(v ?? "NORM"),
      },
      {
        id: "pst-gta-m",
        ruleKey: "pst.height.gtaMaleCm",
        group: "pst",
        name: "GTA (Darjeeling) male height — 157 cm",
        desc: "Gorkha Territorial Administration sub-divisions of Darjeeling district",
        fmt: (v) => `${Number(v ?? 0)} cm`,
        parse: (t) => Number(String(t).replace(/[^0-9.]+/g, "")) || 0,
      },
      {
        id: "pst-chest-u",
        ruleKey: "pst.chest.maleUnexpandedMinCm",
        group: "pst",
        name: "Male chest unexpanded ≥ 80 cm",
        desc: "ST: 76 cm; Garhwali/HP/J&K etc: 78 cm; GTA: 77 cm",
        fmt: (v) => `${Number(v ?? 0)} cm`,
        parse: (t) => Number(String(t).replace(/[^0-9.]+/g, "")) || 0,
      },
      {
        id: "pst-chest-exp",
        ruleKey: "pst.chest.expansionMinCm",
        group: "pst",
        name: "Chest minimum expansion ≥ 5 cm",
        desc: "Applicable to all male candidates regardless of category",
        fmt: (v) => `+${Number(v ?? 0)} cm`,
        parse: (t) => Number(String(t).replace(/[^0-9.]+/g, "")) || 0,
      },
      {
        id: "pst-pet-male",
        ruleKey: "pet.race.maleStandard",
        group: "pst",
        name: "PET race — Male: 5 km in 24 min",
        desc: "For all male candidates outside Ladakh region. Ladakh: 1.6 km in 6:30",
        fmt: (v) => String(v ?? "5km/24m"),
      },
      {
        id: "pst-pet-female",
        ruleKey: "pet.race.femaleStandard",
        group: "pst",
        name: "PET race — Female: 1.6 km in 8.5 min",
        desc: "For female candidates outside Ladakh. Ladakh: 800 m in 4 min",
        fmt: (v) => String(v ?? "1.6km/8.5m"),
      },
      {
        id: "pst-female-chest",
        ruleKey: "pst.chest.femalePolicy",
        group: "pst",
        name: "Female chest — no measurement; well-developed check only",
        desc: "Board ascertains chest is well-developed; no numeric cutoff for females",
        fmt: (v) => String(v ?? "VISUAL"),
      },
    ],
  },
  special: {
    title: "Special Provisions",
    count: "7 rules",
    items: [
      { id: "sp-pwd", ruleKey: "special.pwdPolicy", group: "special", name: "PwD — reject at pre-processing stage", desc: "Persons with Disabilities are NOT eligible for these posts (combat forces)", fmt: (v) => String(v ?? "REJECT") },
      { id: "sp-esm-pst", ruleKey: "special.esmPstPetPolicy", group: "special", name: "ESM — PET exempt; PST measurements recorded only", desc: "ESM not required to run PET race; measurements taken for records but no qualifying cutoff", fmt: (v) => String(v ?? "EXEMPT") },
      { id: "sp-esm-quota", ruleKey: "special.esmQuotaPercent", group: "special", name: "ESM quota — 10% per category", desc: "If suitable ESM not available, vacancies filled by non-ESM of respective category", fmt: (v) => String(v ?? "10%") },
      { id: "sp-pregnant", ruleKey: "special.pregnancyTuPolicy", group: "special", name: "Pregnant (≥12 weeks) → Temporarily Unfit (TU)", desc: "Not eliminated; vacancy reserved; re-examined 6 weeks after confinement", fmt: (v) => String(v ?? "TU") },
      { id: "sp-debarred", ruleKey: "special.debarredDbCheck", group: "special", name: "Debarred DB check — name+DOB+father match", desc: "Match on name/father/mother + DOB where is_active=true; flagged as D", fmt: (v) => String(v ?? "ACTIVE") },
      { id: "sp-ssf-allindia", ruleKey: "special.ssfAllIndia", group: "special", name: "SSF vacancies — All India basis", desc: "SSF (Secretariat Security Force) filled on All India basis; not state-wise", fmt: (v) => String(v ?? "ALL-IN") },
      { id: "sp-domicile", ruleKey: "special.domicileMismatchAction", group: "special", name: "Domicile mismatch → instant cancellation", desc: "If Domicile Cert state/district ≠ application form state/district, candidature cancelled", fmt: (v) => String(v ?? "CANCEL") },
    ],
  },
  tiebreak: {
    title: "Tie-Break Sequence",
    count: "1 rule",
    items: [
      {
        id: "tb-order",
        ruleKey: "tiebreak.sequence",
        group: "tiebreak",
        name: "Tie-break priority order",
        desc: "Set the order used when final marks are tied (Priority 1 → 4).",
        kind: "tiebreak_order",
        fmt: (v) => (Array.isArray(v) ? v.join(", ") : "—"),
      },
    ],
  },
  allocation: {
    title: "Allocation Rules",
    count: "1 rule",
    items: [
      {
        id: "allocation-priority-order",
        ruleKey: "allocation.priorityOrder",
        group: "allocation",
        name: "Allocation priority order",
        desc: "Set area priority for allocation (Priority 1 -> 3).",
        kind: "allocation_priority_order",
        fmt: (v) => (Array.isArray(v) ? v.join(", ") : "—"),
      },
    ],
  },
  age: {
    title: "Age Eligibility",
    count: "9 rules",
    items: [
      {
        id: "age-dob-range",
        ruleKey: "age.dobNotBefore", // primary key (we also update age.dobNotLaterThan)
        ruleKeys: ["age.dobNotBefore", "age.dobNotLaterThan"],
        group: "age",
        name: "Date range (DOB) — Born between",
        desc: "Set From/To DOB (DD/MM/YYYY). Used for age eligibility before applying relaxations.",
        kind: "date_range_ddmmyyyy",
        fmt: () => "—",
      },
      {
        id: "age-years-range",
        ruleKey: "age.minYears", // primary key (we also update age.maxYearsUr)
        ruleKeys: ["age.minYears", "age.maxYearsUr"],
        group: "age",
        name: "Age range (years) — From / To",
        desc: "Set min age and max age (UR) on cutoff date. Use “No limit” to allow any upper age.",
        kind: "years_range",
        fmt: () => "—",
      },
      {
        id: "age-cutoff-date",
        ruleKey: "age.cutoffDate",
        group: "age",
        name: "Current year/date for age calculation (cutoff date)",
        desc: "Age in years is calculated as on this date. Example: 01/08/2021.",
        kind: "date_ddmmyyyy",
        fmt: (v) => String(v ?? "—"),
      },
      { id: "age-obc", ruleKey: "age.relaxOBCYears", group: "age", name: "Age relaxation — OBC", desc: "Upper age extended by 3 years for OBC candidates", fmt: (v) => `+${Number(v ?? 0)} yrs`, parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0 },
      { id: "age-sc", ruleKey: "age.relaxScStYears", group: "age", name: "Age relaxation — SC/ST", desc: "Upper age extended by 5 years for SC and ST candidates", fmt: (v) => `+${Number(v ?? 0)} yrs`, parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0 },
      { id: "age-esm", ruleKey: "age.esmRelaxYears", group: "age", name: "Age relaxation — ESM", desc: "Ex-servicemen: actual age minus military service rendered, then +3 years", fmt: (v) => `+${Number(v ?? 0)} yrs`, parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0 },
      {
        id: "age-riot-ur-ews",
        ruleKey: "age.relaxRiotVictimUrEwsYears",
        group: "age",
        name: "Age relaxation Riot Victims — UR / EWS (1984 / 2002)",
        desc: "Age relaxation for dependents of riot victims (UR/EWS)",
        fmt: (v) => `+${Number(v ?? 0)} yrs`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
      {
        id: "age-riot-obc",
        ruleKey: "age.relaxRiotVictimObcYears",
        group: "age",
        name: "Age relaxation Riot Victims — OBC",
        desc: "Age relaxation for dependents of riot victims (OBC)",
        fmt: (v) => `+${Number(v ?? 0)} yrs`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
      {
        id: "age-riot-scst",
        ruleKey: "age.relaxRiotVictimScStYears",
        group: "age",
        name: "Age relaxation Riot Victims — SC / ST",
        desc: "Age relaxation for dependents of riot victims (SC/ST)",
        fmt: (v) => `+${Number(v ?? 0)} yrs`,
        parse: (t) => Number(String(t).replace(/[^0-9.+-]/g, "")) || 0,
      },
    ],
  },
};

function groupFromRuleKey(ruleKey) {
  const k = String(ruleKey ?? "");
  if (k.startsWith("cbe.")) return "cbe";
  if (k.startsWith("ncc.")) return "ncc";
  if (k.startsWith("age.")) return "age";
  if (k.startsWith("pst.") || k.startsWith("pet.")) return "pst";
  if (k.startsWith("tiebreak.")) return "tiebreak";
  if (k.startsWith("shortlist.")) return "shortlist";
  if (k.startsWith("special.")) return "special";
  if (k.startsWith("eligibility.")) return "eligibility";
  if (k.startsWith("merit.")) return "merit";
  if (k.startsWith("allocation.")) return "allocation";
  return "custom";
}

function displayValue(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function parseValue(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (t === "TRUE") return true;
  if (t === "FALSE") return false;
  // try JSON
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  // try number
  const n = Number(t);
  if (Number.isFinite(n) && String(n) === t) return n;
  return t;
}

const RulesClient = forwardRef(function RulesClient(_props, ref) {
  const [tab, setTab] = useState("visual"); // visual | json | missing
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const jsonRef = useRef(null);
  const deletedRef = useRef(new Set());
  const [editing, setEditing] = useState(null); // { ruleKey, field }
  const didInitialLoadRef = useRef(false);
  const autoSaveTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/rules`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setRules(
          (data ?? []).map((r) => ({
            id: r.id,
            ruleKey: r.ruleKey,
            description: r.description ?? "",
            value: r.value,
            isActive: Boolean(r.isActive),
            group: groupFromRuleKey(r.ruleKey),
          }))
        );
        didInitialLoadRef.current = true;
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const out = { eligibility: [], merit: [], cbe: [], ncc: [], pst: [], special: [], tiebreak: [], allocation: [], age: [], shortlist: [], custom: [] };
    for (const r of rules) {
      const g = r.group || "custom";
      if (!out[g]) out[g] = [];
      out[g].push(r);
    }
    return out;
  }, [rules]);

  useEffect(() => {
    if (!jsonRef.current) return;
    jsonRef.current.value = JSON.stringify(
      rules.map((r) => ({ ruleKey: r.ruleKey, description: r.description, value: r.value, isActive: r.isActive })),
      null,
      2
    );
  }, [rules, tab]);

  function updateRule(ruleKey, patch) {
    setRules((prev) => prev.map((r) => (r.ruleKey === ruleKey ? { ...r, ...patch } : r)));
  }

  function deleteRule(ruleKey) {
    setRules((prev) => prev.filter((r) => r.ruleKey !== ruleKey));
  }

  function addMissingRule(title, desc, val, group) {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 72);
    const ruleKey = `custom.missing_${slug || "rule"}`;
    setRules((prev) => [
      ...prev,
      {
        id: `tmp_${Date.now()}`,
        ruleKey,
        description: String(desc ?? "").trim(),
        value: parseValue(String(val ?? "").trim()),
        isActive: true,
        group: group === "custom" ? "custom" : group,
      },
    ]);
    setTab("visual");
  }

  async function saveAll() {
    setSaving(true);
    setSaveMsg("");
    try {
      const payload = {
        rules: rules.map((r) => ({
          ruleKey: r.ruleKey,
          value: r.value,
          description: r.description,
          isActive: r.isActive,
        })),
        deletedRuleKeys: Array.from(deletedRef.current),
      };
      const res = await fetch(`${API_BASE}/rules/bulk`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      await res.json();
      deletedRef.current = new Set();
      setSaveMsg("Rules saved and active.");
      setTimeout(() => setSaveMsg(""), 1500);
    } catch (e) {
      setSaveMsg(String(e?.message ?? "Save failed"));
      throw e;
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (loading) return;
    if (!didInitialLoadRef.current) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveAll();
      } catch {
        // keep local edits; user can retry via Save & Apply
      }
    }, 450);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules]);

  function applyJsonToRules() {
    const text = jsonRef.current?.value ?? "";
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return;
      setRules(
        arr.map((r) => ({
          id: r.id ?? `tmp_${Math.random().toString(16).slice(2)}`,
          ruleKey: r.ruleKey,
          description: r.description ?? "",
          value: r.value,
          isActive: Boolean(r.isActive ?? true),
          group: groupFromRuleKey(r.ruleKey),
        }))
      );
    } catch {
      // ignore invalid JSON; UI remains unchanged
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      switchTab: (t) => setTab(t),
      saveAll,
      exportWord: () => {
        const t = jsonRef.current?.value ?? "";
        const blob = new Blob([t], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "rule_config.json";
        a.click();
        URL.revokeObjectURL(url);
      },
      exportPdf: () => window.print(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules, tab]
  );

  const ruleByKey = useMemo(() => new Map(rules.map((r) => [r.ruleKey, r])), [rules]);
  function upsertLocal(def, patch) {
    setRules((prev) => {
      const idx = prev.findIndex((r) => r.ruleKey === def.ruleKey);
      if (idx === -1) {
        return [
          ...prev,
          {
            id: `tmp_${Math.random().toString(16).slice(2)}`,
            ruleKey: def.ruleKey,
            description: def.desc,
            value: patch?.value ?? 0,
            isActive: patch?.isActive ?? true,
            group: def.group ?? groupFromRuleKey(def.ruleKey),
          },
        ];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function deleteRuleKey(ruleKey) {
    deletedRef.current.add(ruleKey);
    setRules((prev) => prev.filter((r) => r.ruleKey !== ruleKey));
  }

  if (loading) {
    return <div style={{ padding: 28, color: "var(--ink3)" }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 28 }}>
      {/* Visual Editor (HTML-like cards/rows) */}
      <div id="rules-visual" style={{ display: tab === "visual" ? "" : "none" }}>
        <div className="grid-2">
          <div>
            {["eligibility", "age", "cbe", "ncc", "merit", "tiebreak"].map((g) => (
              <div className="rule-group" id={`rg-${g}`} key={g}>
                <div className="rule-group-header">
                  <div className="rule-group-title">{RULE_DEFS[g].title}</div>
                  <span />
                </div>
                <div id={`rules-${g}`}>
                  {RULE_DEFS[g].items.map((def) => {
                    const r = ruleByKey.get(def.ruleKey);
                    const isEditingValue = editing?.ruleKey === def.ruleKey && editing?.field === "value";
                    const kind = def.kind;
                    const keyToRule = (rk) => ruleByKey.get(rk);
                    return (
                      <div className="rule-item" data-id={def.id} data-group={def.group} key={def.id}>
                        <div className="rule-info">
                          <div className="rule-name editable-name">{def.name}</div>
                          <div className="rule-desc editable-desc">{r?.description ?? def.desc}</div>
                        </div>
                        <div
                          className="rule-value editable-val"
                          style={
                            kind === "yesno"
                              ? { display: "none" }
                              : kind === "date_ddmmyyyy"
                                ? { minWidth: 200, justifyContent: "flex-end" }
                                : undefined
                          }
                          onDoubleClick={() => (!def.fixed && !kind ? setEditing({ ruleKey: def.ruleKey, field: "value" }) : null)}
                        >
                          {kind === "yesno" ? (
                            <span />
                          ) : kind === "date_ddmmyyyy" ? (
                            <MatriculationMaskedDdMmYyyy value={r?.value} onCommit={(v) => upsertLocal(def, { value: v })} />
                          ) : kind === "date_range_ddmmyyyy" ? (
                            <DobRangeEditor
                              fromValue={keyToRule(def.ruleKeys?.[0])?.value}
                              toValue={keyToRule(def.ruleKeys?.[1])?.value}
                              onCommitFrom={(v) => upsertLocal({ ...def, ruleKey: def.ruleKeys?.[0] }, { value: v })}
                              onCommitTo={(v) => upsertLocal({ ...def, ruleKey: def.ruleKeys?.[1] }, { value: v })}
                            />
                          ) : kind === "years_range" ? (
                            <AgeYearsRangeEditor
                              minYears={keyToRule(def.ruleKeys?.[0])?.value}
                              maxYears={keyToRule(def.ruleKeys?.[1])?.value}
                              onCommitMin={(v) => upsertLocal({ ...def, ruleKey: def.ruleKeys?.[0] }, { value: v })}
                              onCommitMax={(v) => upsertLocal({ ...def, ruleKey: def.ruleKeys?.[1] }, { value: v })}
                            />
                          ) : kind === "bool_dropdown" ? (
                            <select
                              className="filter-select"
                              style={{ minWidth: 110, fontSize: 12, padding: "6px 8px" }}
                              value={r?.value === true ? "TRUE" : "FALSE"}
                              onChange={(e) => upsertLocal(def, { value: e.target.value === "TRUE" })}
                            >
                              <option value="TRUE">TRUE</option>
                              <option value="FALSE">FALSE</option>
                            </select>
                          ) : kind === "merit_method" ? (
                            <select
                              className="filter-select"
                              style={{ minWidth: 260, fontSize: 12, padding: "6px 8px" }}
                              value={String(r?.value ?? "normalized_plus_ncc")}
                              onChange={(e) => upsertLocal(def, { value: e.target.value })}
                            >
                              <option value="normalized_only">Normalized CBE marks only</option>
                              <option value="normalized_plus_ncc">Normalized CBE marks + NCC bonus marks</option>
                            </select>
                          ) : kind === "tiebreak_order" ? (
                            <TieBreakOrderEditor value={r?.value} onCommit={(v) => upsertLocal(def, { value: v })} />
                          ) : kind === "allocation_priority_order" ? (
                            <AllocationPriorityOrderEditor value={r?.value} onCommit={(v) => upsertLocal(def, { value: v })} />
                          ) : kind === "education_level" ? (
                            <select
                              className="filter-select"
                              style={{ minWidth: 130, fontSize: 12, padding: "6px 8px" }}
                              value={String(r?.value ?? "10th")}
                              onChange={(e) => upsertLocal(def, { value: e.target.value })}
                            >
                              <option value="10th">10th</option>
                              <option value="12th">12th</option>
                              <option value="Degree">Degree</option>
                              <option value="Master">Master</option>
                              <option value="PhD">PhD</option>
                            </select>
                          ) : isEditingValue && !def.fixed ? (
                            <input
                              autoFocus
                              defaultValue={String(r?.value ?? "")}
                              onBlur={(e) => {
                                upsertLocal(def, { value: def.parse ? def.parse(e.target.value) : e.target.value });
                                setEditing(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") setEditing(null);
                              }}
                              style={{
                                width: 90,
                                border: "1px solid var(--border2)",
                                borderRadius: "var(--radius)",
                                padding: "2px 6px",
                                fontFamily: "'DM Mono',monospace",
                                fontSize: 12,
                                outline: "none",
                              }}
                            />
                          ) : def.fixed ? (
                            def.fmt()
                          ) : (
                            def.fmt(r?.value)
                          )}
                        </div>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(r?.isActive ?? true)}
                            onChange={(e) => upsertLocal(def, { isActive: e.target.checked })}
                          />
                          <div className="toggle-track"></div>
                        </label>
                        <button className="rule-del-btn" type="button" onClick={() => deleteRuleKey(def.ruleKey)} title="Delete rule">
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div className="rule-group" id="rg-pst" style={{ display: grouped.pst.length ? "" : "none", order: 3 }}>
              <div className="rule-group-header">
                <div className="rule-group-title">{RULE_DEFS.pst.title}</div>
                <span />
              </div>
              <div id="rules-pst">
                {RULE_DEFS.pst.items.map((def) => {
                  const r = ruleByKey.get(def.ruleKey);
                  const isEditingValue = editing?.ruleKey === def.ruleKey && editing?.field === "value";
                  return (
                    <div className="rule-item" data-id={def.id} data-group={def.group} key={def.id}>
                      <div className="rule-info">
                        <div className="rule-name editable-name">{def.name}</div>
                        <div className="rule-desc editable-desc">{r?.description ?? def.desc}</div>
                      </div>
                      <div className="rule-value editable-val" onDoubleClick={() => setEditing({ ruleKey: def.ruleKey, field: "value" })}>
                        {isEditingValue ? (
                          <input
                            autoFocus
                            defaultValue={String(r?.value ?? "")}
                            onBlur={(e) => {
                              upsertLocal(def, { value: def.parse ? def.parse(e.target.value) : e.target.value });
                              setEditing(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setEditing(null);
                            }}
                            style={{
                              width: 120,
                              border: "1px solid var(--border2)",
                              borderRadius: "var(--radius)",
                              padding: "2px 6px",
                              fontFamily: "'DM Mono',monospace",
                              fontSize: 12,
                              outline: "none",
                            }}
                          />
                        ) : (
                          def.fmt(r?.value)
                        )}
                      </div>
                      <label className="toggle">
                        <input type="checkbox" checked={Boolean(r?.isActive ?? true)} onChange={(e) => upsertLocal(def, { isActive: e.target.checked })} />
                        <div className="toggle-track"></div>
                      </label>
                      <button className="rule-del-btn" type="button" onClick={() => deleteRuleKey(def.ruleKey)} title="Delete rule">
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rule-group" id="rg-special" style={{ display: grouped.special.length ? "" : "none", order: 4 }}>
              <div className="rule-group-header">
                <div className="rule-group-title">{RULE_DEFS.special.title}</div>
                <span />
              </div>
              <div id="rules-special">
                {RULE_DEFS.special.items.map((def) => {
                  const r = ruleByKey.get(def.ruleKey);
                  const isEditingValue = editing?.ruleKey === def.ruleKey && editing?.field === "value";
                  return (
                    <div className="rule-item" data-id={def.id} data-group={def.group} key={def.id}>
                      <div className="rule-info">
                        <div className="rule-name editable-name">{def.name}</div>
                        <div className="rule-desc editable-desc">{r?.description ?? def.desc}</div>
                      </div>
                      <div className="rule-value editable-val" onDoubleClick={() => setEditing({ ruleKey: def.ruleKey, field: "value" })}>
                        {isEditingValue ? (
                          <input
                            autoFocus
                            defaultValue={String(r?.value ?? "")}
                            onBlur={(e) => {
                              upsertLocal(def, { value: parseValue(e.target.value) });
                              setEditing(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setEditing(null);
                            }}
                            style={{
                              width: 120,
                              border: "1px solid var(--border2)",
                              borderRadius: "var(--radius)",
                              padding: "2px 6px",
                              fontFamily: "'DM Mono',monospace",
                              fontSize: 12,
                              outline: "none",
                            }}
                          />
                        ) : (
                          def.fmt(r?.value)
                        )}
                      </div>
                      <label className="toggle">
                        <input type="checkbox" checked={Boolean(r?.isActive ?? true)} onChange={(e) => upsertLocal(def, { isActive: e.target.checked })} />
                        <div className="toggle-track"></div>
                      </label>
                      <button className="rule-del-btn" type="button" onClick={() => deleteRuleKey(def.ruleKey)} title="Delete rule">
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rule-group" id="rg-allocation" style={{ display: grouped.allocation.length ? "" : "none", order: 1 }}>
              <div className="rule-group-header">
                <div className="rule-group-title">{RULE_DEFS.allocation.title}</div>
                <span />
              </div>
              <div id="rules-allocation">
                {RULE_DEFS.allocation.items.map((def) => {
                  const r = ruleByKey.get(def.ruleKey);
                  const kind = def.kind;
                  const isEditingValue = editing?.ruleKey === def.ruleKey && editing?.field === "value";
                  return (
                    <div className="rule-item" data-id={def.id} data-group={def.group} key={def.id}>
                      <div className="rule-info">
                        <div className="rule-name editable-name">{def.name}</div>
                        <div className="rule-desc editable-desc">{r?.description ?? def.desc}</div>
                      </div>
                      <div className="rule-value editable-val">
                        {kind === "allocation_priority_order" ? (
                          <AllocationPriorityOrderEditor value={r?.value} onCommit={(v) => upsertLocal(def, { value: v })} />
                        ) : kind === "date_ddmmyyyy" ? (
                          <MatriculationMaskedDdMmYyyy value={r?.value} onCommit={(v) => upsertLocal(def, { value: v })} />
                        ) : isEditingValue ? (
                          <input
                            autoFocus
                            defaultValue={String(r?.value ?? "")}
                            onBlur={(e) => {
                              upsertLocal(def, { value: def.parse ? def.parse(e.target.value) : e.target.value });
                              setEditing(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setEditing(null);
                            }}
                            style={{
                              width: 120,
                              border: "1px solid var(--border2)",
                              borderRadius: "var(--radius)",
                              padding: "2px 6px",
                              fontFamily: "'DM Mono',monospace",
                              fontSize: 12,
                              outline: "none",
                            }}
                          />
                        ) : (
                          <span onDoubleClick={() => setEditing({ ruleKey: def.ruleKey, field: "value" })}>{def.fmt(r?.value)}</span>
                        )}
                      </div>
                      <label className="toggle">
                        <input type="checkbox" checked={Boolean(r?.isActive ?? true)} onChange={(e) => upsertLocal(def, { isActive: e.target.checked })} />
                        <div className="toggle-track"></div>
                      </label>
                      <button className="rule-del-btn" type="button" onClick={() => deleteRuleKey(def.ruleKey)} title="Delete rule">
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rule-group" id="rg-custom" style={{ display: grouped.custom.length ? "" : "none", order: 2 }}>
              <div className="rule-group-header">
                <div className="rule-group-title">Custom Rules</div>
                <span />
              </div>
              <div id="rules-custom">
                <RuleList rules={grouped.custom} onUpdate={updateRule} onDelete={(rk) => deleteRuleKey(rk)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="rules-json" style={{ display: tab === "json" ? "" : "none" }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">rule_config.json — Live Configuration</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const t = jsonRef.current?.value ?? "";
                  navigator.clipboard?.writeText(t);
                }}
              >
                Copy JSON
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const t = jsonRef.current?.value ?? "";
                  const blob = new Blob([t], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "rule_config.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download .json
              </button>
            </div>
          </div>
          <div className="card-body">
            <textarea
              ref={jsonRef}
              id="json-editor"
              style={{
                width: "100%",
                minHeight: 520,
                fontFamily: "'DM Mono',monospace",
                fontSize: 12,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: 16,
                lineHeight: 1.7,
                color: "var(--ink)",
                background: "var(--surface2)",
                resize: "vertical",
                outline: "none",
              }}
              spellCheck={false}
            ></textarea>
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={applyJsonToRules}>
                Apply JSON Rules
              </button>
              <span style={{ fontSize: 11, color: "var(--ink4)", alignSelf: "center" }}>
                Edit directly and click Apply to update Visual Editor
              </span>
            </div>
          </div>
        </div>
      </div>

      <div id="rules-missing" style={{ display: tab === "missing" ? "" : "none" }}>
        {/* Keep the exact missing rules markup from HTML file (static SOP suggestions). */}
        <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid var(--amber)" }}>
          <div className="card-header" style={{ background: "var(--amber-bg)" }}>
            <div>
              <div className="card-title" style={{ color: "var(--amber)" }}>
                ⚠ Rules Identified from SOP / Notice — Not Yet in System
              </div>
              <div className="card-subtitle">
                Cross-referenced against official SSC recruitment notice and SOP. Click &quot;Add&quot; to include them.
              </div>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface2)" }}>
                  <th style={thStyle}>Rule</th>
                  <th style={thStyle}>Source Reference</th>
                  <th style={thStyle}>Suggested Value</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody id="missing-rules-body">
                <MissingRow
                  title="Negative marking — 0.25 per wrong answer"
                  desc="CBE scoring penalty; not currently enforced in marks calculation"
                  src="Notice Para 11.1.2"
                  val="−0.25/wrong"
                  group="cbe"
                  onAdd={(t, d, v, g) => addMissingRule(t, d, v, g)}
                />
                <MissingRow
                  title="NCC bonus revocation at DV if cert not produced"
                  desc="Provisionally awarded NCC marks must be withdrawn at DV if original cert missing"
                  src="Notice Para 13.8"
                  val="REVOKE"
                  group="ncc"
                  onAdd={(t, d, v, g) => addMissingRule(t, d, v, g)}
                />
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Topbar action buttons live in page.js; we expose controls here via window-less props */}
      <div style={{ display: "none" }} aria-hidden="true" />

      {saving ? <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink3)" }}>Writing to DB…</div> : null}
      {!saving && saveMsg ? <div style={{ marginTop: 12, fontSize: 12, color: "var(--green)" }}>{saveMsg}</div> : null}
    </div>
  );
});

export default RulesClient;

function clampDateDdMmYyyy(dd, mm, yyyy) {
  const d = String(Math.min(31, Math.max(1, Number.parseInt(dd, 10) || 1))).padStart(2, "0");
  const m = String(Math.min(12, Math.max(1, Number.parseInt(mm, 10) || 1))).padStart(2, "0");
  const yDigits = String(yyyy ?? "").replace(/\D/g, "").slice(0, 4);
  const y = yDigits.length === 4 ? yDigits : "2025";
  return `${d}/${m}/${y}`;
}

const DATE_TEMPLATE = "DD/MM/YYYY";

function placeholderCharAt(i) {
  if (i <= 1) return "D";
  if (i >= 3 && i <= 4) return "M";
  return "Y";
}

function normalizeMaskedDateText(t) {
  const s = String(t ?? "");
  // Keep digits where present; keep slashes fixed; fill missing with placeholders.
  const out = DATE_TEMPLATE.split("");
  for (let i = 0; i < out.length; i += 1) {
    if (i === 2 || i === 5) continue;
    const ch = s[i];
    if (/\d/.test(ch)) out[i] = ch;
  }
  return out.join("");
}

function isValidDdMmYyyy(v) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(v ?? ""));
}

function toDisplayDdMmYyyy(v) {
  const s = String(v ?? "").trim();
  if (!s) return DATE_TEMPLATE;
  if (isValidDdMmYyyy(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return DATE_TEMPLATE;
}

function MatriculationMaskedDdMmYyyy({ value, onCommit }) {
  const inputRef = useRef(null);
  const [text, setText] = useState(() => normalizeMaskedDateText(toDisplayDdMmYyyy(value)));

  useEffect(() => {
    setText(normalizeMaskedDateText(toDisplayDdMmYyyy(value)));
  }, [value]);

  function segmentFromPos(pos) {
    // 0-1 dd, 3-4 mm, 6-9 yyyy (slashes at 2 and 5)
    if (pos <= 1) return "dd";
    if (pos >= 3 && pos <= 4) return "mm";
    return "yyyy";
  }

  function segmentRange(seg) {
    if (seg === "dd") return [0, 2];
    if (seg === "mm") return [3, 5];
    return [6, 10];
  }

  function setSelection(start, end) {
    const el = inputRef.current;
    if (!el) return;
    // defer for React updates
    queueMicrotask(() => {
      try {
        el.setSelectionRange(start, end);
      } catch {
        // ignore
      }
    });
  }

  function setCaretToSegment(seg) {
    const [s, e] = segmentRange(seg);
    setSelection(s, e);
  }

  function setCaret(pos) {
    setSelection(pos, pos);
  }

  function replaceAt(s, idx, ch) {
    return `${s.slice(0, idx)}${ch}${s.slice(idx + 1)}`;
  }

  function commitIfComplete(nextText) {
    if (!isValidDdMmYyyy(nextText)) return;
    const [dd, mm, yyyy] = String(nextText).split("/");
    const clamped = clampDateDdMmYyyy(dd, mm, yyyy);
    setText(clamped);
    onCommit(clamped);
  }

  return (
    <input
      ref={inputRef}
      aria-label="Matriculation by date (DD/MM/YYYY)"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        const next = normalizeMaskedDateText(e.target.value);
        setText(next);
        commitIfComplete(next);
      }}
      onFocus={() => {
        const el = inputRef.current;
        const pos = el?.selectionStart ?? 0;
        setCaretToSegment(segmentFromPos(pos));
      }}
      onMouseUp={() => {
        const el = inputRef.current;
        const pos = el?.selectionStart ?? 0;
        setCaretToSegment(segmentFromPos(pos));
      }}
      onKeyDown={(e) => {
        const el = inputRef.current;
        if (!el) return;

        const key = e.key;
        const selStart = el.selectionStart ?? 0;
        const selEnd = el.selectionEnd ?? selStart;
        const seg = segmentFromPos(selStart);
        const [segStart, segEnd] = segmentRange(seg);

        // allow navigation keys
        if (key === "Tab" || key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return;
        if (key === "ArrowLeft") {
          e.preventDefault();
          setCaretToSegment(seg === "mm" ? "dd" : seg === "yyyy" ? "mm" : "dd");
          return;
        }
        if (key === "ArrowRight") {
          e.preventDefault();
          setCaretToSegment(seg === "dd" ? "mm" : seg === "mm" ? "yyyy" : "yyyy");
          return;
        }

        // backspace/delete revert to placeholders in the segment
        if (key === "Backspace" || key === "Delete") {
          e.preventDefault();
          const base = normalizeMaskedDateText(text);
          let out = base;
          // if a segment is selected, clear whole segment; else clear one char (like normal typing)
          if (selStart <= segStart && selEnd >= segEnd) {
            for (let i = segStart; i < segEnd; i += 1) {
              if (i === 2 || i === 5) continue;
              out = replaceAt(out, i, placeholderCharAt(i));
            }
            setText(out);
            setCaretToSegment(seg);
            return;
          }
          let pos = selStart;
          if (pos === 2) pos = 1;
          if (pos === 5) pos = 4;
          if (key === "Backspace") pos = Math.max(segStart, pos - 1);
          if (pos >= segEnd) pos = segEnd - 1;
          if (pos === 2 || pos === 5) pos -= 1;
          out = replaceAt(out, pos, placeholderCharAt(pos));
          setText(out);
          setCaret(Math.max(segStart, pos));
          return;
        }

        // numeric input fills selected segment left-to-right
        if (/^\d$/.test(key)) {
          e.preventDefault();
          const base = normalizeMaskedDateText(text);
          let out = base;
          let pos = selStart;
          // if segment is selected, start at first char of that segment
          if (selStart <= segStart && selEnd >= segEnd) pos = segStart;
          if (pos === 2) pos = 3;
          if (pos === 5) pos = 6;
          if (pos < segStart) pos = segStart;
          if (pos >= segEnd) pos = segEnd - 1;
          // write digit
          out = replaceAt(out, pos, key);
          setText(out);

          // move caret to next position inside segment, then next segment
          let nextPos = pos + 1;
          if (nextPos === 2) nextPos = 3;
          if (nextPos === 5) nextPos = 6;
          if (nextPos >= segEnd) {
            if (seg === "dd") {
              setCaretToSegment("mm");
            } else if (seg === "mm") {
              setCaretToSegment("yyyy");
            } else {
              setCaret(10);
            }
          } else {
            setCaret(nextPos);
          }

          commitIfComplete(out);
          return;
        }

        // block everything else to keep mask stable
        if (key.length === 1) e.preventDefault();
      }}
      onBlur={() => {
        // keep placeholder mask stable; commit only if complete
        const normalized = normalizeMaskedDateText(text);
        setText(normalized);
        if (isValidDdMmYyyy(normalized)) commitIfComplete(normalized);
      }}
      style={{
        width: 120,
        padding: "2px 6px",
        border: "1px solid var(--border2)",
        borderRadius: "var(--radius)",
        background: "var(--accent-bg)",
        fontFamily: "'DM Mono',monospace",
        fontSize: 12,
        color: "var(--accent)",
        outline: "none",
        textAlign: "center",
      }}
    />
  );
}

function DobRangeEditor({ fromValue, toValue, onCommitFrom, onCommitTo }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>From</span>
        <MatriculationMaskedDdMmYyyy value={fromValue} onCommit={onCommitFrom} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>To</span>
        <MatriculationMaskedDdMmYyyy value={toValue} onCommit={onCommitTo} />
      </div>
    </div>
  );
}

function AgeYearsRangeEditor({ minYears, maxYears, onCommitMin, onCommitMax }) {
  const min = Number(minYears);
  const max = maxYears == null || maxYears === "" ? null : Number(maxYears);
  const noLimit = max == null || !Number.isFinite(max);
  const minOk = Number.isFinite(min) ? min : 18;
  const maxOk = noLimit ? "" : String(Math.max(0, max));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>From</span>
        <input
          inputMode="numeric"
          defaultValue={String(minOk)}
          onBlur={(e) => {
            const v = Number(String(e.target.value).replace(/[^0-9]/g, ""));
            onCommitMin(Number.isFinite(v) ? v : 0);
          }}
          style={{
            width: 56,
            padding: "2px 6px",
            border: "1px solid var(--border2)",
            borderRadius: "var(--radius)",
            background: "var(--accent-bg)",
            fontFamily: "'DM Mono',monospace",
            fontSize: 12,
            color: "var(--accent)",
            outline: "none",
            textAlign: "center",
          }}
        />
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>yrs</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>To</span>
        <input
          inputMode="numeric"
          value={maxOk}
          onChange={() => {}}
          readOnly={noLimit}
          placeholder={noLimit ? "No limit" : ""}
          onBlur={(e) => {
            if (noLimit) return;
            const v = Number(String(e.target.value).replace(/[^0-9]/g, ""));
            onCommitMax(Number.isFinite(v) ? v : null);
          }}
          style={{
            width: 74,
            padding: "2px 6px",
            border: "1px solid var(--border2)",
            borderRadius: "var(--radius)",
            background: "var(--accent-bg)",
            fontFamily: "'DM Mono',monospace",
            fontSize: 12,
            color: "var(--accent)",
            outline: "none",
            textAlign: "center",
            opacity: noLimit ? 0.65 : 1,
          }}
        />
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>yrs</span>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink3)" }}>
        <input
          type="checkbox"
          checked={noLimit}
          onChange={(e) => {
            if (e.target.checked) onCommitMax(null);
            else onCommitMax(23);
          }}
        />
        No limit
      </label>
    </div>
  );
}

const TIEBREAK_OPTIONS = [
  { id: "partA", label: "Part A (GI & Reasoning)" },
  { id: "partB", label: "Part B (GK/GA)" },
  { id: "dobOlderFirst", label: "DOB (older preferred)" },
  { id: "nameAZ", label: "Name A→Z" },
];

const ALLOCATION_PRIORITY_OPTIONS = [
  { id: "Naxal", label: "Naxal" },
  { id: "Border", label: "Border" },
  { id: "General", label: "General" },
];

function normalizeTieBreakSequence(v) {
  const base = Array.isArray(v) ? v.map(String) : [];
  const seen = new Set();
  const out = [];
  for (const x of base) {
    if (!TIEBREAK_OPTIONS.some((o) => o.id === x)) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  for (const o of TIEBREAK_OPTIONS) {
    if (!seen.has(o.id)) out.push(o.id);
  }
  return out.slice(0, 4);
}

function TieBreakOrderEditor({ value, onCommit }) {
  const seq = normalizeTieBreakSequence(value);

  function setAt(idx, nextId) {
    const next = [...seq];
    next[idx] = nextId;
    // ensure unique by swapping duplicates
    const used = new Map();
    for (let i = 0; i < next.length; i += 1) {
      const id = next[i];
      if (!used.has(id)) used.set(id, i);
      else {
        const j = used.get(id);
        const tmp = next[j];
        next[j] = next[i];
        next[i] = tmp;
        used.set(id, i);
      }
    }
    onCommit(next);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "center", minWidth: 340 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: "contents" }}>
          <div style={{ fontSize: 11, color: "var(--ink3)" }}>{`Priority ${i + 1}`}</div>
          <select className="filter-select" style={{ fontSize: 12, padding: "6px 8px" }} value={seq[i]} onChange={(e) => setAt(i, e.target.value)}>
            {TIEBREAK_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function normalizeAllocationPriorityOrder(v) {
  const base = Array.isArray(v) ? v.map(String) : [];
  const seen = new Set();
  const out = [];
  for (const x of base) {
    if (!ALLOCATION_PRIORITY_OPTIONS.some((o) => o.id === x)) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  for (const o of ALLOCATION_PRIORITY_OPTIONS) {
    if (!seen.has(o.id)) out.push(o.id);
  }
  return out.slice(0, 3);
}

function AllocationPriorityOrderEditor({ value, onCommit }) {
  const seq = normalizeAllocationPriorityOrder(value);

  function setAt(idx, nextId) {
    const next = [...seq];
    next[idx] = nextId;
    // ensure each priority is unique by swapping duplicate selections
    const used = new Map();
    for (let i = 0; i < next.length; i += 1) {
      const id = next[i];
      if (!used.has(id)) used.set(id, i);
      else {
        const j = used.get(id);
        const tmp = next[j];
        next[j] = next[i];
        next[i] = tmp;
        used.set(id, i);
      }
    }
    onCommit(next);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "center", minWidth: 300 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: "contents" }}>
          <div style={{ fontSize: 11, color: "var(--ink3)" }}>{`Priority ${i + 1}`}</div>
          <select className="filter-select" style={{ fontSize: 12, padding: "6px 8px" }} value={seq[i]} onChange={(e) => setAt(i, e.target.value)}>
            {ALLOCATION_PRIORITY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

const thStyle = {
  padding: "10px 16px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--ink3)",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  borderBottom: "1px solid var(--border)",
};

function MissingRow({ title, desc, src, val, group, onAdd }) {
  return (
    <tr>
      <td style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>{desc}</div>
      </td>
      <td style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--accent)" }}>{src}</td>
      <td style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, color: "var(--ink)", fontFamily: "'DM Mono',monospace" }}>{val}</td>
      <td style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => onAdd(title, desc, val, group)}>
          + Add
        </button>
      </td>
    </tr>
  );
}

function RuleGroup({ id, title, countId, rules, onUpdate, onDelete }) {
  return (
    <div className="rule-group" id={id}>
      <div className="rule-group-header">
        <div className="rule-group-title">{title}</div>
        <span className="rule-count" id={countId}>
          {rules.length} rule{rules.length === 1 ? "" : "s"}
        </span>
      </div>
      <div id={`rules-${id.replace("rg-", "")}`}>
        <RuleList rules={rules} onUpdate={onUpdate} onDelete={onDelete} />
      </div>
    </div>
  );
}

function RuleList({ rules, onUpdate, onDelete }) {
  return rules.map((r) => (
    <div className="rule-item" key={r.ruleKey} data-id={r.ruleKey} data-group={r.group}>
      <div className="rule-info">
        <div
          className="rule-name editable-name"
          contentEditable
          suppressContentEditableWarning
          onBlur={(e) => onUpdate(r.ruleKey, { ruleKey: r.ruleKey, name: e.currentTarget.textContent ?? "" })}
        >
          {r.ruleKey}
        </div>
        <div
          className="rule-desc editable-desc"
          contentEditable
          suppressContentEditableWarning
          onBlur={(e) => onUpdate(r.ruleKey, { description: e.currentTarget.textContent ?? "" })}
        >
          {r.description}
        </div>
      </div>
      <div
        className="rule-value editable-val"
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => onUpdate(r.ruleKey, { value: parseValue(e.currentTarget.textContent ?? "") })}
      >
        {displayValue(r.value)}
      </div>
      <label className="toggle">
        <input type="checkbox" checked={r.isActive} onChange={(e) => onUpdate(r.ruleKey, { isActive: e.target.checked })} />
        <div className="toggle-track"></div>
      </label>
      <button className="rule-del-btn" onClick={() => onDelete(r.ruleKey)} title="Delete rule">
        ✕
      </button>
    </div>
  ));
}




