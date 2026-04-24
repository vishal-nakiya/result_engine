"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiBase } from "../lib/api";
import AllocationMetaPanel from "./allocationMetaPanel";

function buildPagerPages(curr, last) {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const pages = new Set([1, last, curr, curr - 1, curr + 1, curr - 2, curr + 2]);
  const arr = Array.from(pages).filter((n) => n >= 1 && n <= last);
  arr.sort((a, b) => a - b);
  return arr;
}

export default function AllocationClient() {
  const [busy, setBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [ruleExportBusy, setRuleExportBusy] = useState(false);
  const [reportExportBusy, setReportExportBusy] = useState(false);
  const [error, setError] = useState("");
  const [runMsg, setRunMsg] = useState("");
  const [data, setData] = useState({ page: 1, pageSize: 50, total: 0, rows: [] });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [forceCode, setForceCode] = useState("");
  const [state, setState] = useState("");
  const [basisOpenId, setBasisOpenId] = useState(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(Number(data.total ?? 0) / pageSize)),
    [data.total, pageSize]
  );

  async function load(opts = {}) {
    const p = opts.page ?? page;
    const ps = opts.pageSize ?? pageSize;
    setBusy(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(p));
      qs.set("pageSize", String(ps));
      if (forceCode) qs.set("forceCode", forceCode);
      if (state) qs.set("state", state);
      const res = await fetch(`${apiBase()}/allocation?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load");
      setData(json);
      setPage(Number(json.page) || p);
      setPageSize(Number(json.pageSize) || ps);
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function goToPage(nextPage) {
    const next = Math.min(totalPages, Math.max(1, nextPage));
    load({ page: next, pageSize });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportFilename() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `force-allocation-${stamp}.xlsx`;
  }

  function vacancyReportFilename() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `vacancy-summary-report-${stamp}.csv`;
  }

  function ruleBenefitFilename() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `allocation-rule-benefit-proof-${stamp}.xlsx`;
  }

  function csvCell(v) {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  async function fetchAllRows() {
    const pageSize = 200;
    let page = 1;
    let total = 0;
    const out = [];
    while (true) {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("pageSize", String(pageSize));
      if (forceCode) qs.set("forceCode", forceCode);
      if (state) qs.set("state", state);
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${apiBase()}/allocation?${qs.toString()}`);
      // eslint-disable-next-line no-await-in-loop
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to export allocation");
      const rows = Array.isArray(json?.rows) ? json.rows : [];
      total = Number(json?.total ?? out.length + rows.length);
      out.push(...rows);
      if (!rows.length || out.length >= total) break;
      page += 1;
    }
    return out;
  }

  async function exportAllExcel() {
    setExportBusy(true);
    setError("");
    try {
      const allRows = await fetchAllRows();
      // Fallback source for cutoff columns from vacancy master rows.
      const vacancyByRowKey = new Map();
      {
        let vPage = 1;
        const vPageSize = 200;
        let vTotal = 0;
        while (true) {
          const qs = new URLSearchParams();
          qs.set("page", String(vPage));
          qs.set("pageSize", String(vPageSize));
          // eslint-disable-next-line no-await-in-loop
          const vRes = await fetch(`${apiBase()}/vacancy?${qs.toString()}`);
          // eslint-disable-next-line no-await-in-loop
          const vJson = await vRes.json();
          if (!vRes.ok) break;
          const rows = Array.isArray(vJson?.rows) ? vJson.rows : [];
          for (const vr of rows) {
            const key = String(vr?.key ?? "").trim();
            if (key) vacancyByRowKey.set(key, vr);
          }
          vTotal = Number(vJson?.total ?? vacancyByRowKey.size);
          if (!rows.length || (vPage * vPageSize) >= vTotal) break;
          vPage += 1;
        }
      }

      const cutoffByStateCategoryGender = new Map();
      for (const r of allRows) {
        const key = `${String(r?.stateCode ?? r?.stateAllocated ?? "").trim()}|${String(r?.categoryAllocated ?? "").trim().toUpperCase()}|${String(r?.gender ?? "").trim().toUpperCase()}`;
        if (!key) continue;
        const curr = cutoffByStateCategoryGender.get(key);
        const rank = Number(r?.meritRank ?? Number.MAX_SAFE_INTEGER);
        if (!curr || rank > Number(curr?.meritRank ?? -1)) cutoffByStateCategoryGender.set(key, r);
      }

      const rows = allRows.map((r) => {
        const groupKey = `${String(r?.stateCode ?? r?.stateAllocated ?? "").trim()}|${String(r?.categoryAllocated ?? "").trim().toUpperCase()}|${String(r?.gender ?? "").trim().toUpperCase()}`;
        const cutoff = cutoffByStateCategoryGender.get(groupKey);
        const vac = vacancyByRowKey.get(String(r?.vacancyRowKey ?? "").trim());
        const coMarks = cutoff?.finalMarks ?? cutoff?.allocationMeta?.candidate?.finalMarks ?? vac?.min_marks ?? "";
        const coPartA = cutoff?.partAMarks ?? vac?.min_marks_parta ?? "";
        const coPartB = cutoff?.partBMarks ?? vac?.min_marks_partb ?? "";
        return {
          meritRank: r.meritRank ?? "",
          rollNo: r.rollNo ?? "",
          name: r.name ?? "",
          gender: r.gender ?? "",
          forceCode: r.forceCode ?? "",
          vacancyRowKey: r.vacancyRowKey ?? "",
          stateCode: r.stateCode ?? "",
          area: r.area ?? "",
          categoryAllocated: r.categoryAllocated ?? "",
          stateAllocated: r.stateAllocated ?? "",
          co_marks: coMarks,
          co_parta: coPartA,
          co_partb: coPartB,
        };
      });

      const maleRows = rows.filter((r) => String(r?.gender ?? "").toUpperCase() === "M" || String(r?.gender ?? "") === "2");
      const femaleRows = rows.filter((r) => String(r?.gender ?? "").toUpperCase() === "F" || String(r?.gender ?? "") === "1");
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(maleRows), "Male");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(femaleRows), "Female");
      XLSX.writeFile(wb, exportFilename());
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setExportBusy(false);
    }
  }

  async function exportVacancySummaryCsv() {
    setReportExportBusy(true);
    setError("");
    try {
      const out = [];
      let vPage = 1;
      const vPageSize = 200;
      let vTotal = 0;
      while (true) {
        const qs = new URLSearchParams();
        qs.set("page", String(vPage));
        qs.set("pageSize", String(vPageSize));
        // eslint-disable-next-line no-await-in-loop
        const vRes = await fetch(`${apiBase()}/vacancy?${qs.toString()}`);
        // eslint-disable-next-line no-await-in-loop
        const vJson = await vRes.json();
        if (!vRes.ok) throw new Error(vJson?.error?.message ?? "Failed to export vacancy summary");
        const rows = Array.isArray(vJson?.rows) ? vJson.rows : [];
        out.push(...rows);
        vTotal = Number(vJson?.total ?? out.length);
        if (!rows.length || out.length >= vTotal) break;
        vPage += 1;
      }

      const filtered = out.filter((r) => {
        if (forceCode && String(r?.force ?? "").trim().toUpperCase() !== String(forceCode).trim().toUpperCase()) return false;
        if (state) {
          const needle = String(state).trim().toLowerCase();
          const stateName = String(r?.state_name ?? "").toLowerCase();
          const stateCode = String(r?.state_code ?? "").toLowerCase();
          if (!stateName.includes(needle) && !stateCode.includes(needle)) return false;
        }
        return true;
      });

      const headers = [
        "state_code",
        "state",
        "gender",
        "post_code",
        "force",
        "area",
        "category",
        "category_code",
        "vacancies",
        "allocated",
        "left_vacancy",
      ];
      const lines = [headers.join(",")];
      for (const r of filtered) {
        const row = [
          r?.state_code ?? "",
          r?.state_name ?? "",
          r?.gender ?? "",
          r?.post_code ?? "",
          r?.force ?? "",
          r?.area ?? "",
          r?.category ?? "",
          r?.category_code ?? "",
          r?.vacancies ?? "",
          r?.allocated ?? "",
          r?.left_vacancy ?? "",
        ];
        lines.push(row.map(csvCell).join(","));
      }

      const csv = `${lines.join("\n")}\n`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = vacancyReportFilename();
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setReportExportBusy(false);
    }
  }

  function toUpper(v) {
    return String(v ?? "").trim().toUpperCase();
  }

  function parseIsoDate(s) {
    const t = String(s ?? "").trim();
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return new Date(Date.UTC(y, mo - 1, d));
  }

  function isDobInRangeInclusive(birthDateIso, fromDateIso, toDateIso) {
    const b = parseIsoDate(birthDateIso);
    const f = parseIsoDate(fromDateIso);
    const t = parseIsoDate(toDateIso);
    if (!b || !f || !t) return null;
    return b >= f && b <= t;
  }

  function extractRuleBenefitRows(allRows) {
    const out = [];
    for (const r of allRows) {
      const meta = r?.allocationMeta && typeof r.allocationMeta === "object" ? r.allocationMeta : {};
      const cMeta = meta?.candidate && typeof meta.candidate === "object" ? meta.candidate : {};
      const allocatedCat = toUpper(r?.categoryAllocated);
      const originalCat = toUpper(cMeta?.category ?? r?.category);
      const isEsm = Boolean(cMeta?.isEsm ?? r?.isEsm);
      const normalizedScore = Number(cMeta?.normalizedMarks);
      const urCutoff = Number.isFinite(Number(cMeta?.urNormalizedCutoff)) ? Number(cMeta?.urNormalizedCutoff) : 35;
      const dobYear = Number(cMeta?.birthYear);
      const birthDate = String(cMeta?.birthDate ?? "");
      const urDobFromDate = String(cMeta?.urDobFrom ?? "");
      const urDobToDate = String(cMeta?.urDobTo ?? "");
      const dobYearMin = Number.isFinite(Number(cMeta?.urDobYearMin)) ? Number(cMeta?.urDobYearMin) : 1998;
      const dobYearMax = Number.isFinite(Number(cMeta?.urDobYearMax)) ? Number(cMeta?.urDobYearMax) : 2003;
      const dobEligibleByDate = isDobInRangeInclusive(birthDate, urDobFromDate, urDobToDate);
      const dobEligible = cMeta?.birthDateEligibleForUr != null
        ? Boolean(cMeta?.birthDateEligibleForUr)
        : dobEligibleByDate != null
          ? Boolean(dobEligibleByDate)
        : cMeta?.birthYearEligibleForUr != null
          ? Boolean(cMeta?.birthYearEligibleForUr)
          : (Number.isFinite(dobYear) ? (dobYear >= dobYearMin && dobYear <= dobYearMax) : false);
      const usedRelaxation = Boolean(cMeta?.usedRelaxation);
      const reason = String(meta?.allocation_reason ?? "");

      let benefitType = "";
      if (allocatedCat === "UR" && isEsm) {
        benefitType = "UR by ESM bypass";
      } else if (
        allocatedCat === "UR" &&
        !isEsm &&
        ["OBC", "SC", "ST"].includes(originalCat) &&
        ((Number.isFinite(normalizedScore) && normalizedScore >= urCutoff) || /qualified for UR vacancy/i.test(reason)) &&
        dobEligible &&
        !usedRelaxation
      ) {
        benefitType = "UR by normalized-score rule";
      }
      const benefitYes = Boolean(benefitType);
      let notBenefitReason = "";
      if (!benefitYes) {
        if (allocatedCat !== "UR") notBenefitReason = "Allocated in own/reserved category (not UR)";
        else if (usedRelaxation) notBenefitReason = "Used age/physical relaxation";
        else if (!dobEligible) notBenefitReason = "DOB outside allowed range";
        else if (!isEsm && ["OBC", "SC", "ST"].includes(originalCat) && !(Number.isFinite(normalizedScore) && normalizedScore >= urCutoff)) {
          notBenefitReason = "Normalized score below UR cutoff";
        } else {
          notBenefitReason = "Did not match benefit criteria";
        }
      }

      out.push({
        meritRank: r?.meritRank ?? "",
        rollNo: r?.rollNo ?? "",
        name: r?.name ?? "",
        originalCategory: originalCat,
        allocatedCategory: allocatedCat,
        benefit: benefitYes ? "YES" : "NO",
        benefitType: benefitType || "Not benefited",
        forceCode: r?.forceCode ?? "",
        stateAllocated: r?.stateAllocated ?? "",
        normalizedScore: Number.isFinite(normalizedScore) ? normalizedScore : "",
        urCutoff: Number.isFinite(urCutoff) ? urCutoff : 35,
        dob: birthDate || "NA",
        birthDate: birthDate || "NA",
        dobRange: `${urDobFromDate || "02/08/1998"} to ${urDobToDate || "01/08/2003"}`,
        dobInRange: dobEligible ? "YES" : "NO",
        usedAgeRelaxation: usedRelaxation ? "YES" : "NO",
        esmBypass: isEsm ? "YES" : "NO",
        shortProof: `${benefitYes ? benefitType : notBenefitReason}; ${originalCat}->${allocatedCat}; score ${Number.isFinite(normalizedScore) ? normalizedScore : "NA"}/${Number.isFinite(urCutoff) ? urCutoff : 35}; dobInRange=${dobEligible ? "YES" : "NO"}; relax=${usedRelaxation ? "YES" : "NO"}`,
        notBenefitReason,
        allocationReason: reason,
      });
    }
    return out;
  }

  async function exportRuleBenefitProofExcel() {
    setRuleExportBusy(true);
    setError("");
    try {
      const allRows = await fetchAllRows();
      const reportRows = extractRuleBenefitRows(allRows);
      const benefitedRows = reportRows.filter((r) => r.benefit === "YES");
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const summary = [
        { metric: "Total allocated candidates checked", value: reportRows.length },
        { metric: "Total rule-benefit candidates", value: benefitedRows.length },
        { metric: "UR by normalized-score rule", value: benefitedRows.filter((r) => r.benefitType === "UR by normalized-score rule").length },
        { metric: "UR by ESM bypass", value: benefitedRows.filter((r) => r.benefitType === "UR by ESM bypass").length },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(benefitedRows), "BenefitOnly");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reportRows), "AllChecked");
      XLSX.writeFile(wb, ruleBenefitFilename());
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setRuleExportBusy(false);
    }
  }

  async function runAllocationOnly() {
    setRunBusy(true);
    setError("");
    setRunMsg("");
    try {
      const res = await fetch(`${apiBase()}/allocation/run`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `Allocation failed (${res.status})`);
      const d = json.diagnostics;
      const extra =
        d && typeof d === "object"
          ? ` · Cleared in pool: ${d.clearedCandidates ?? "—"} · No slot: ${d.skippedNoSlot ?? "—"} · Gender skip: ${d.skippedGender ?? "—"} · Domicile→code unresolved: ${d.unresolvedStateCode ?? "—"}`
          : "";
      setRunMsg(
        `Allocated ${json.allocated?.toLocaleString?.() ?? json.allocated} candidate(s) · mode: ${json.mode ?? "—"}${extra}`
      );
      await load({ page: 1 });
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setRunBusy(false);
    }
  }

  const rows = useMemo(() => data.rows ?? [], [data.rows]);
  const total = Number(data.total ?? 0);
  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);

  return (
    <div style={{ padding: 28 }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <div className="filter-row">
            <select className="filter-select" value={forceCode} onChange={(e) => setForceCode(e.target.value)}>
              <option value="">All forces</option>
              {["A", "B", "C", "D", "E", "F", "G", "H"].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input
              className="filter-select"
              style={{ minWidth: 220 }}
              placeholder="Filter by state…"
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
            <select
              className="filter-select"
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => {
                const ps = Number(e.target.value);
                load({ page: 1, pageSize: ps });
              }}
              disabled={busy}
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => load({ page: 1 })} disabled={busy}>
              {busy ? "Loading…" : "Apply"}
            </button>
            <button className="btn btn-success btn-sm" type="button" onClick={runAllocationOnly} disabled={runBusy || busy}>
              {runBusy ? "Running…" : "Run allocation"}
            </button>
            <button className="btn btn-dark btn-sm" type="button" onClick={exportAllExcel} disabled={busy || exportBusy}>
              {exportBusy ? "Exporting..." : "Export Excel (Male/Female)"}
            </button>
            <button
              className="btn btn-dark btn-sm"
              type="button"
              onClick={exportRuleBenefitProofExcel}
              disabled={busy || ruleExportBusy}
            >
              {ruleExportBusy ? "Exporting..." : "Export Rule-Benefit Proof"}
            </button>
            <button className="btn btn-dark btn-sm" type="button" onClick={exportVacancySummaryCsv} disabled={busy || reportExportBusy}>
              {reportExportBusy ? "Exporting..." : "Export Vacancy Report (CSV)"}
            </button>
            {error ? <span style={{ color: "var(--red)", fontSize: 12, alignSelf: "center" }}>{error}</span> : null}
          </div>
          {runMsg ? (
            <div style={{ marginTop: 10 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--green)" }}>{runMsg}</p>
            </div>
          ) : null}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Merit Rank</th>
                <th>Roll No</th>
                <th>Name</th>
                <th>Force</th>
                <th>Vacancy key</th>
                <th>State code</th>
                <th>Area</th>
                <th>Category Allocated</th>
                <th>State</th>
                {/* <th>Basis</th> */}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td className="mono">{r.meritRank ?? "—"}</td>
                    <td className="mono">{r.rollNo ?? "—"}</td>
                    <td>
                      <strong>{r.name ?? "—"}</strong>
                    </td>
                    <td className="mono">{r.forceCode}</td>
                    <td className="mono">{r.vacancyRowKey ?? "—"}</td>
                    <td className="mono">{r.stateCode ?? "—"}</td>
                    <td className="mono">{r.area ?? "—"}</td>
                    <td className="mono">{r.categoryAllocated}</td>
                    <td>{r.stateAllocated}</td>
                    {/* <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setBasisOpenId((id) => (id === r.id ? null : r.id))}
                      >
                        {basisOpenId === r.id ? "Hide" : "Show"}
                      </button>
                    </td> */}
                  </tr>
                  {basisOpenId === r.id ? (
                    <tr className="allocation-basis-row">
                      <td colSpan={10} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                        <AllocationMetaPanel meta={r.allocationMeta} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={10} style={{ padding: 16, color: "var(--ink3)" }}>
                    {busy
                      ? "Loading…"
                      : "No allocations yet. Run allocation above, or the full processing pipeline from Result Upload."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="pager" style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
          <div className="pager-info">
            Showing {rangeFrom.toLocaleString()}–{rangeTo.toLocaleString()} of {total.toLocaleString()} · Page{" "}
            <span className="mono">{page}</span> / <span className="mono">{totalPages}</span>
          </div>
          <div className="pager-btns">
            <button className="pager-btn" type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1 || busy}>
              ‹
            </button>
            {(() => {
              const list = buildPagerPages(page, totalPages);
              const out = [];
              for (let i = 0; i < list.length; i += 1) {
                const n = list[i];
                const prev = list[i - 1];
                if (i > 0 && n - prev > 1) {
                  out.push(
                    <span key={`dots-${prev}-${n}`} style={{ fontSize: 12, color: "var(--ink4)", margin: "0 4px" }}>
                      …
                    </span>
                  );
                }
                out.push(
                  <button
                    key={n}
                    className={`pager-btn${n === page ? " active" : ""}`}
                    type="button"
                    onClick={() => goToPage(n)}
                    disabled={busy}
                  >
                    {n.toLocaleString()}
                  </button>
                );
              }
              return out;
            })()}
            <button
              className="pager-btn"
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages || busy}
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

