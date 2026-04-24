"use client";

import { useEffect, useMemo, useState } from "react";
import { apiBase } from "../lib/api";
import MeritFilterPanel, {
  emptyMeritFilterGroup,
  meritFilterHasContent,
  pruneMeritFilterGroup,
} from "./MeritFilterPanel";

function formatDob(dobIso) {
  if (!dobIso) return "—";
  const s = String(dobIso).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`; // DD-MM-YYYY
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function pickStateCode(row) {
  const direct = row?.stateCode;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const raw = row?.rawData ?? {};
  const fromRaw =
    raw?.state_code ??
    raw?.s_code ??
    raw?.statecode_considered_app ??
    raw?.stateCode ??
    raw?.statecode ??
    raw?.candidate_state_code ??
    raw?.statecodecandidate;
  return fromRaw == null ? "" : String(fromRaw).trim();
}

function pickStateName(row) {
  const directFromDb = String(row?.stateName ?? "").trim();
  if (directFromDb) return directFromDb;

  const isLikelyStateCode = (value) => {
    const v = String(value ?? "").trim();
    if (!v) return false;
    // Typical code-like values: UP, MH, 09, KA01, etc.
    if (/^[A-Z0-9-]{1,6}$/.test(v)) return true;
    // Pure digits are also treated as code IDs.
    if (/^\d+$/.test(v)) return true;
    return false;
  };

  const firstNonCodeText = (...vals) => {
    for (const val of vals) {
      const text = String(val ?? "").trim();
      if (!text) continue;
      if (isLikelyStateCode(text)) continue;
      return text;
    }
    return "";
  };

  const raw = row?.rawData ?? {};
  return firstNonCodeText(
    row?.state_name,
    raw?.state_name,
    raw?.candidate_state_name,
    raw?.candidate_state,
    raw?.domicile_state_name,
    raw?.domicileStateName,
    raw?.stateName,
    raw?.state,
    row?.domicileState,
    raw?.domicile_state,
    raw?.domicileState
  );
}

function pickCandidateName(row) {
  const direct = row?.name;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const raw = row?.rawData ?? {};
  const fromRaw =
    raw?.name ??
    raw?.candidate_name ??
    raw?.candidateName ??
    raw?.full_name ??
    raw?.fullname;
  return fromRaw == null ? "" : String(fromRaw).trim();
}

export default function MeritClient() {
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({ page: 1, pageSize: 50, total: 0, rows: [] });
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(200);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [gender, setGender] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [detail, setDetail] = useState(null);
  const [meritFilterDraft, setMeritFilterDraft] = useState(() => emptyMeritFilterGroup());
  const [meritFilterApplied, setMeritFilterApplied] = useState(null);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("includeEval", "true");
      if (!showAll) params.set("status", "cleared");
      if (q.trim()) params.set("q", q.trim());
      if (category) params.set("category", category);
      if (gender) params.set("gender", gender);
      if (meritFilterApplied && meritFilterHasContent(meritFilterApplied)) {
        params.set("filterGroup", JSON.stringify(meritFilterApplied));
      }
      const url = `${apiBase()}/candidates?${params.toString()}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load");
      setData(json);
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function deriveNccBonus(r) {
    const sum = r?.ruleSummary ?? {};
    const computed = sum?.computed ?? {};
    const merit = computed?.merit ?? {};
    const cert = String(r?.nccCert ?? "").trim().toUpperCase();
    const derivedPercentFromCert = cert === "C" ? 5 : cert === "B" ? 3 : cert === "A" ? 2 : 0;
    const bonusPercent =
      merit?.bonusPercent != null
        ? Number(merit?.bonusPercent) || 0
        : derivedPercentFromCert;
    const bonusBase = Number(merit?.bonusBase ?? computed?.cbeCutoff?.maxMarks ?? 100) || 100;
    const stored = merit?.bonusMarks;
    const storedNum = Number(stored);
    const bonusMarks = Number.isFinite(storedNum) ? storedNum : (bonusBase * bonusPercent) / 100;
    return Number.isFinite(Number(bonusMarks)) ? Number(bonusMarks) : null;
  }

  function deriveFinalMarks(r) {
    if (r?.finalMarks != null && String(r.finalMarks).trim() !== "") {
      const storedFinalNum = Number(r.finalMarks);
      if (Number.isFinite(storedFinalNum)) return storedFinalNum;
    }
    const normalizedNum = Number(r?.normalizedMarks);
    if (!Number.isFinite(normalizedNum)) return null;
    const bonus = deriveNccBonus(r);
    return normalizedNum + Number(bonus || 0);
  }

  function buildListParams(p, ps) {
    const params = new URLSearchParams();
    params.set("page", String(p));
    params.set("pageSize", String(ps));
    params.set("includeEval", "true");
    if (!showAll) params.set("status", "cleared");
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    if (gender) params.set("gender", gender);
    if (meritFilterApplied && meritFilterHasContent(meritFilterApplied)) {
      params.set("filterGroup", JSON.stringify(meritFilterApplied));
    }
    return params;
  }

  async function exportAllExcel() {
    setExportBusy(true);
    setError("");
    try {
      const allRows = [];
      const exportPageSize = 500;
      let exportPage = 1;
      let total = 0;
      do {
        const params = buildListParams(exportPage, exportPageSize);
        const res = await fetch(`${apiBase()}/candidates?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Failed to export merit list");
        total = Number(json?.total ?? 0);
        allRows.push(...(json?.rows ?? []));
        exportPage += 1;
      } while (allRows.length < total);

      // Safety dedupe by candidate id to avoid repeated rows from transient pagination/order shifts.
      const dedupMap = new Map();
      for (const r of allRows) {
        if (r?.id) dedupMap.set(String(r.id), r);
      }
      const dedupedRows = Array.from(dedupMap.values());

      const ordered = [...dedupedRows].sort((a, b) => {
        const ar = a.meritRank ?? 999999999;
        const br = b.meritRank ?? 999999999;
        if (ar !== br) return ar - br;
        const af = Number(a.finalMarks ?? a.normalizedMarks ?? 0);
        const bf = Number(b.finalMarks ?? b.normalizedMarks ?? 0);
        return bf - af;
      });

      const sheetRows = ordered.map((r) => ({
        "Merit Rank": r.meritRank ?? "",
        "Roll No": r.rollNo ?? "",
        Name: pickCandidateName(r),
        "State Code": pickStateCode(r),
        "State Name": pickStateName(r),
        Category: r.category ?? "",
        Gender: String(r.gender ?? "").slice(0, 1).toUpperCase(),
        DOB: formatDob(r.dob),
        Normalized: r.normalizedMarks ?? "",
        "NCC Cert": r.nccCert ?? "",
        "NCC Bonus": (() => {
          const n = deriveNccBonus(r);
          return n == null ? "" : String(n);
        })(),
        Final: (() => {
          const n = deriveFinalMarks(r);
          return n == null ? "" : String(n);
        })(),
        Merit: String(r.status ?? "").toLowerCase() === "cleared" ? "Pass" : "Fail",
      }));

      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Merit List");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      XLSX.writeFile(wb, `merit-list-${stamp}.xlsx`);
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setExportBusy(false);
    }
  }

  async function runPipeline() {
    setRunning(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}/process/run`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Pipeline failed");
      await load();
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  }

  async function openDetail(candidateId) {
    setDetailOpen(true);
    setDetailBusy(true);
    setDetailErr("");
    setDetail(null);
    try {
      const res = await fetch(`${apiBase()}/candidates/${encodeURIComponent(candidateId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load candidate details");
      setDetail(json);
    } catch (e) {
      setDetailErr(String(e?.message ?? e));
    } finally {
      setDetailBusy(false);
    }
  }

  function closeDetail() {
    setDetailOpen(false);
  }

  function fmtDateOnly(v) {
    if (!v) return "—";
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return String(v);
  }

  function criteriaTable(ruleEval, candidate) {
    const summary = ruleEval?.summary ?? {};
    const inputs = summary?.inputs ?? {};
    const computed = summary?.computed ?? {};

    const hasReason = (code) => Array.isArray(ruleEval?.reasons) && ruleEval.reasons.some((r) => r?.code === code);

    const rows = [];

    // Citizenship (if enabled & value available)
    rows.push({
      rule: "Citizenship",
      criteria: "If Indian citizenship rule is enabled → candidate must be Indian (when value is available)",
      candidate: String(computed?.citizenship?.citizenship ?? inputs?.citizenship ?? candidate?.rawData?.citizenship ?? candidate?.rawData?.nationality ?? "—"),
      result: hasReason("CITIZENSHIP_NOT_INDIAN") ? "Fail" : "Pass",
    });

    // PWD eligibility toggle
    rows.push({
      rule: "PWD eligibility",
      criteria: "If PWD-not-eligible rule is enabled → candidate must NOT be PWD",
      candidate: String(inputs?.isPwd ?? candidate?.isPwd ?? "—"),
      result: hasReason("PWD_NOT_ELIGIBLE") ? "Fail" : "Pass",
    });

    // Debarred
    rows.push({
      rule: "Debarred check",
      criteria: "Candidate status must NOT be debarred",
      candidate: String(candidate?.status ?? "").toLowerCase() === "debarred" ? "debarred" : "cleared",
      result: hasReason("DEBARRED") ? "Fail" : "Pass",
    });

    // Matriculation by date
    rows.push({
      rule: "Matriculation by date",
      criteria: "Candidate must have passed Matriculation / 10th on or before the configured date",
      candidate: `byDate=${computed?.matriculation?.byDate ?? "—"} · passed=${computed?.matriculation?.passed ?? "—"}`,
      result: hasReason("MATRICULATION_NOT_PASSED") ? "Fail" : "Pass",
    });

    // Essential qualification
    rows.push({
      rule: "Essential qualification",
      criteria: "Candidate must possess essential qualification (when rule enabled)",
      candidate: `value=${computed?.essentialQualification?.essential ?? inputs?.possessesEssentialQualification ?? "—"} · ok=${computed?.essentialQualification?.ok ?? "—"}`,
      result: hasReason("ESSENTIAL_QUALIFICATION_MISSING") ? "Fail" : "Pass",
    });

    // Minimum education level
    rows.push({
      rule: "Minimum education",
      criteria: "Candidate education level must meet minimum requirement (when rule enabled)",
      candidate: `min=${computed?.education?.minEducationLevel ?? "—"} · need=${computed?.education?.need ?? "—"} · have=${computed?.education?.have ?? "—"}`,
      result: hasReason("EDUCATION_BELOW_MIN") ? "Fail" : "Pass",
    });

    // Required marks present
    rows.push({
      rule: "Marks present",
      criteria: "Compulsory: normalized, partA, partB, and CBE score must be present · Required (not compulsory): Part-C, Part-D (if available in raw data)",
      candidate:
        `partA=${inputs?.partAMarks ?? "—"} · partB=${inputs?.partBMarks ?? "—"} · partC=${inputs?.partCMarks ?? candidate?.rawData?.partc_maths ?? "—"}` +
        ` · partD=${inputs?.partDMarks ?? candidate?.rawData?.partd_eng_hin ?? "—"} · score=${inputs?.marksCbe ?? "—"} · normalized=${inputs?.normalizedMarks ?? "—"}`,
      result: hasReason("MISSING_MARKS") ? "Fail" : "Pass",
    });

    // Age range (always show)
    rows.push({
      rule: "Age / DOB range",
      criteria: `DOB must be between ${fmtDateOnly(computed?.age?.minDob)} and ${fmtDateOnly(computed?.age?.maxDob)} (relaxYears=${computed?.age?.relaxYears ?? 0})`,
      candidate: `dob=${fmtDateOnly(computed?.age?.dob ?? candidate?.dob)}`,
      result: hasReason("AGE_OUT_OF_RANGE") ? "Fail" : "Pass",
    });

    // CBE cutoff (always show)
    {
      const cutoffPercent = computed?.cbeCutoff?.cutoffPercent;
      const marksCbeRaw = computed?.cbeCutoff?.marksCbe ?? inputs?.marksCbe;
      const marksCbeNum = Number(marksCbeRaw);
      rows.push({
        rule: "CBE cutoff",
        criteria: `marksCbe must be ≥ cutoffPercent (${cutoffPercent ?? "—"}%)`,
        candidate: `marksCbe=${Number.isFinite(marksCbeNum) ? marksCbeNum : marksCbeRaw ?? "—"}`,
        result: hasReason("CBE_BELOW_CUTOFF") ? "Fail" : "Pass",
      });
    }

    // Merit calculation (always show)
    {
      const normalized = inputs?.normalizedMarks ?? candidate?.normalizedMarks;
      const normalizedNum = Number(normalized);
      const includeNcc = Boolean(computed?.merit?.includeNcc ?? true);
      const bonusPercentRaw = computed?.merit?.bonusPercent;
      const bonusPercentNum = Number(bonusPercentRaw);
      const bonusPercent = Number.isFinite(bonusPercentNum) ? bonusPercentNum : 0;

      const bonusBaseRaw = computed?.merit?.bonusBase ?? computed?.cbeCutoff?.maxMarks;
      const bonusBaseNum = Number(bonusBaseRaw);
      const bonusBase = Number.isFinite(bonusBaseNum) && bonusBaseNum > 0 ? bonusBaseNum : 100;

      const storedBonusMarksRaw = computed?.merit?.bonusMarks;
      const storedBonusMarksNum = Number(storedBonusMarksRaw);
      const bonusMarks = Number.isFinite(storedBonusMarksNum) ? storedBonusMarksNum : (bonusBase * bonusPercent) / 100;
      const finalMarks =
        Number.isFinite(normalizedNum)
          ? (includeNcc ? normalizedNum + Number(bonusMarks || 0) : normalizedNum)
          : null;
      rows.push({
        rule: "Merit marks",
        criteria: includeNcc ? "finalMarks = normalized + NCC bonus marks" : "finalMarks = normalized only (no NCC)",
        candidate: includeNcc
          ? `normalized=${normalized ?? "—"} · nccBonusMarks=${fmtNum(bonusMarks)} · finalMarks=${finalMarks == null ? "—" : fmtNum(finalMarks)}`
          : `normalized=${normalized ?? "—"} · finalMarks=${finalMarks == null ? "—" : fmtNum(finalMarks)}`,
        result: finalMarks == null ? "—" : "Pass",
      });
    }

    return rows;
  }

  function fmtNum(v) {
    if (v == null || String(v).trim() === "") return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return String(v);
  }

  useEffect(() => {
    load();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, page, pageSize, q, category, gender, meritFilterApplied]);

  function applyMeritFilter() {
    const pruned = pruneMeritFilterGroup(meritFilterDraft);
    if (meritFilterHasContent(pruned)) {
      setMeritFilterApplied(pruned);
    } else {
      setMeritFilterApplied(null);
    }
    setPage(1);
  }

  function clearMeritFilter() {
    setMeritFilterDraft(emptyMeritFilterGroup());
    setMeritFilterApplied(null);
    setPage(1);
  }

  const rows = useMemo(() => {
    const r = [...(data.rows ?? [])];
    r.sort((a, b) => {
      const ar = a.meritRank ?? 999999999;
      const br = b.meritRank ?? 999999999;
      if (ar !== br) return ar - br;
      const af = Number(a.finalMarks ?? a.normalizedMarks ?? 0);
      const bf = Number(b.finalMarks ?? b.normalizedMarks ?? 0);
      return bf - af;
    });
    return r;
  }, [data.rows]);

  return (
    <div style={{ padding: 28 }}>
      {/* Global filter panel intentionally hidden as requested */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={load} disabled={busy || running}>
          ⟳ Refresh
        </button>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--ink3)" }}>
          <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); setPage(1); }} />
          Show fail rows too
        </label>
        <input
          className="input"
          style={{ height: 30, fontSize: 12, padding: "0 10px", minWidth: 220 }}
          placeholder="Search roll no / name / father name…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <select
          className="input"
          style={{ height: 30, fontSize: 12, padding: "0 8px" }}
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1); }}
        >
          <option value="">All categories</option>
          <option value="UR">UR</option>
          <option value="OBC">OBC</option>
          <option value="SC">SC</option>
          <option value="ST">ST</option>
          <option value="EWS">EWS</option>
          <option value="ESM">ESM</option>
        </select>
        <select
          className="input"
          style={{ height: 30, fontSize: 12, padding: "0 8px" }}
          value={gender}
          onChange={(e) => { setGender(e.target.value); setPage(1); }}
        >
          <option value="">All genders</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
        <select
          className="input"
          style={{ height: 30, fontSize: 12, padding: "0 8px" }}
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value) || 200); setPage(1); }}
        >
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
          <option value={200}>200 / page</option>
          <option value={500}>500 / page</option>
        </select>
        <button className="btn btn-success btn-sm" type="button" onClick={runPipeline} disabled={running}>
          {running ? "Running…" : "▶ Run Processing"}
        </button>
        <button
          className="btn btn-sm"
          style={{ background: "#111827", color: "#fff", border: "1px solid #111827" }}
          type="button"
          onClick={exportAllExcel}
          disabled={busy || running || exportBusy}
        >
          {exportBusy ? "Exporting..." : "Export Excel (all records)"}
        </button>
        {error ? <span style={{ color: "var(--red)", fontSize: 12, alignSelf: "center" }}>{error}</span> : null}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Merit candidates</div>
          <div style={{ fontSize: 12, color: "var(--ink3)" }}>
            Total: <span className="mono">{data.total ?? 0}</span>
          </div>
        </div>

        <div style={{ padding: "0 14px 10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>
            Page <span className="mono">{page}</span> of{" "}
            <span className="mono">{Math.max(1, Math.ceil((data.total ?? 0) / pageSize))}</span>
          </span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPage(1)} disabled={busy || page <= 1}>
            ⏮ First
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={busy || page <= 1}>
            ‹ Prev
          </button>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={busy || page >= Math.max(1, Math.ceil((data.total ?? 0) / pageSize))}
          >
            Next ›
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Merit Rank</th>
                <th>Roll No</th>
                <th>Name</th>
                <th>State Code</th>
                <th>State Name</th>
                <th>Category</th>
                <th>Gender</th>
                <th>DOB</th>
                <th>Normalized</th>
                <th>NCC Cert</th>
                <th>NCC bonus</th>
                <th>Final</th>
                <th>Merit</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.meritRank ?? "—"}</td>
                  <td className="mono">{r.rollNo}</td>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td className="mono">{pickStateCode(r) || "—"}</td>
                  <td>{pickStateName(r) || "—"}</td>
                  <td className="mono">{r.category ?? "—"}</td>
                  <td>{String(r.gender ?? "").slice(0, 1).toUpperCase() || "—"}</td>
                  <td className="mono">{formatDob(r.dob)}</td>
                  <td className="mono">{r.normalizedMarks ?? "—"}</td>
                  <td className="mono">{r.nccCert ?? "—"}</td>
                  <td className="mono">
                    {fmtNum(deriveNccBonus(r))}
                  </td>
                  <td className="mono">
                    <strong>
                      {fmtNum(deriveFinalMarks(r))}
                    </strong>
                  </td>
                  <td>
                    {String(r.status ?? "").toLowerCase() === "cleared" ? (
                      <span className="badge badge-green">Pass</span>
                    ) : (
                      <span className="badge badge-red">Fail</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => openDetail(r.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={14} style={{ padding: 16, color: "var(--ink3)" }}>
                    {busy ? "Loading…" : showAll ? "No candidates yet. Upload CSV and run processing." : "No merit pass yet. Upload CSV and run processing."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: detailOpen ? "rgba(0,0,0,0.35)" : "transparent",
          display: detailOpen ? "flex" : "none",
          alignItems: "center",
          justifyContent: "center",
          padding: 18,
          zIndex: 80,
        }}
        onClick={closeDetail}
        role="presentation"
      >
        <div
          className="card"
          style={{
            width: "min(1100px, 96vw)",
            height: "min(86vh, 920px)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="card-header">
            <div>
              <div className="card-title">Rule engine details</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>
                {detail?.name ? (
                  <>
                    <span style={{ fontWeight: 600 }}>{detail.name}</span> · Roll: <span className="mono">{detail.rollNo}</span>
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn btn-ghost btn-sm" type="button" onClick={closeDetail}>
                Close
              </button>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {detailErr ? (
              <div style={{ padding: "10px 16px", color: "var(--red)", fontSize: 12, borderBottom: "1px solid var(--border)" }}>{detailErr}</div>
            ) : null}

            {detailBusy ? (
              <div style={{ padding: 16, color: "var(--ink3)" }}>Loading…</div>
            ) : detail && !detail?.ruleEval ? (
              <div style={{ padding: 16, color: "var(--ink3)" }}>
                No rule-evaluation data found for this candidate. Run <strong>Processing</strong> again to generate rule details.
              </div>
            ) : null}

            {detail?.ruleEval ? (
              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                  <span className={`badge ${detail.ruleEval.qualified ? "badge-green" : "badge-gray"}`}>
                    {detail.ruleEval.qualified ? "Pass" : "Fail"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink3)" }}>
                    Status: <span className="mono">{String(detail?.status ?? "—")}</span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink3)" }}>
                    Computed at: <span className="mono">{String(detail.ruleEval.computedAt ?? "—")}</span>
                  </span>
                </div>

                {Array.isArray(detail.ruleEval.reasons) && detail.ruleEval.reasons.length ? (
                  <div style={{ marginBottom: 12, fontSize: 12 }}>
                    <div style={{ color: "var(--ink3)", marginBottom: 6 }}>Fail reasons</div>
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                      <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                        {detail.ruleEval.reasons.map((r) => `${r.code ?? "REASON"}: ${r.message ?? ""}`).join("\n")}
                      </pre>
                    </div>
                  </div>
                ) : !detail.ruleEval.qualified ? (
                  <div style={{ marginBottom: 12, fontSize: 12 }}>
                    <div style={{ color: "var(--ink3)", marginBottom: 6 }}>Fail reasons</div>
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, color: "var(--ink3)" }}>
                      No explicit fail reasons were stored for this evaluation.
                      {String(detail?.status ?? "").toLowerCase() && String(detail?.status ?? "").toLowerCase() !== "cleared"
                        ? ` Candidate is currently status=${String(detail?.status)} (treated as merit fail).`
                        : " Re-run Processing to regenerate rule-evaluation reasons if needed."}
                    </div>
                  </div>
                ) : null}

                <div className="table-wrap" style={{ overflow: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Rule name</th>
                        <th>Eligible criteria</th>
                        <th>Candidate value</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {criteriaTable(detail.ruleEval, detail).map((row) => (
                        <tr key={row.rule}>
                          <td style={{ fontWeight: 600 }}>{row.rule}</td>
                          <td style={{ color: "var(--ink3)" }}>{row.criteria}</td>
                          <td className="mono">{row.candidate}</td>
                          <td>
                            <span className={`badge ${row.result === "Fail" ? "badge-red" : row.result === "Pass" ? "badge-green" : "badge-gray"}`}>
                              {row.result}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

