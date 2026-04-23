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

  function toCsvValue(value) {
    if (value == null) return "";
    const s = typeof value === "string" ? value : String(value);
    if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function downloadCsv(filename, rows) {
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportFilename() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `force-allocation-${stamp}.csv`;
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

  async function exportAllCsv() {
    setExportBusy(true);
    setError("");
    try {
      const allRows = await fetchAllRows();
      const header = [
        "meritRank",
        "rollNo",
        "name",
        "forceCode",
        "vacancyRowKey",
        "stateCode",
        "area",
        "categoryAllocated",
        "stateAllocated",
        "districtAllocated",
      ];
      const lines = [
        header.map(toCsvValue).join(","),
        ...allRows.map((r) =>
          [
            r.meritRank,
            r.rollNo,
            r.name,
            r.forceCode,
            r.vacancyRowKey,
            r.stateCode,
            r.area,
            r.categoryAllocated,
            r.stateAllocated,
            r.districtAllocated,
          ]
            .map(toCsvValue)
            .join(",")
        ),
      ];
      downloadCsv(exportFilename(), lines);
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setExportBusy(false);
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
      <div className="card mb-24">
        <div className="card-header">
          <div>
            <div className="card-title">Run allocation only</div>
            <div className="card-subtitle">
              Uses current merit ranks and vacancy data (vacancy_rows when present). Does not recompute merit, PST/PET,
              or rules. Each row can show an <strong>Allocation basis</strong> snapshot (domicile resolution, master
              district flags, vacancy row match, pool state vs All-India).
            </div>
          </div>
          <button className="btn btn-primary btn-sm" type="button" onClick={runAllocationOnly} disabled={runBusy || busy}>
            {runBusy ? "Running…" : "Run allocation"}
          </button>
        </div>
        {runMsg ? (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--green)" }}>{runMsg}</p>
          </div>
        ) : null}
      </div>

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
            <button className="btn btn-ghost btn-sm" type="button" onClick={exportAllCsv} disabled={busy || exportBusy}>
              {exportBusy ? "Exporting..." : "Export CSV (all data)"}
            </button>
            {error ? <span style={{ color: "var(--red)", fontSize: 12, alignSelf: "center" }}>{error}</span> : null}
          </div>
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
                <th>District</th>
                <th>Basis</th>
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
                    <td>{r.districtAllocated}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setBasisOpenId((id) => (id === r.id ? null : r.id))}
                      >
                        {basisOpenId === r.id ? "Hide" : "Show"}
                      </button>
                    </td>
                  </tr>
                  {basisOpenId === r.id ? (
                    <tr className="allocation-basis-row">
                      <td colSpan={11} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                        <AllocationMetaPanel meta={r.allocationMeta} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={11} style={{ padding: 16, color: "var(--ink3)" }}>
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

