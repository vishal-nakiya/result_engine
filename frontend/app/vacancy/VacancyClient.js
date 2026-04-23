"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiBase } from "../lib/api";
import { useProcessing } from "../lib/processing";

/** Set to `true` to show the vacancy CSV upload panel. */
const SHOW_VACANCY_UPLOAD = true;

function normalizeHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function buildPagerPages(curr, last) {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const pages = new Set([1, last, curr, curr - 1, curr + 1, curr - 2, curr + 2]);
  const arr = Array.from(pages).filter((n) => n >= 1 && n <= last);
  arr.sort((a, b) => a - b);
  return arr;
}

function fmtCell(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export default function VacancyClient({ initial }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processing = useProcessing();
  const [qInput, setQInput] = useState(searchParams.get("q") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [data, setData] = useState(initial);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef(null);
  const [csvPreview, setCsvPreview] = useState(null);
  const [csvMapping, setCsvMapping] = useState({});
  const [mapOpen, setMapOpen] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitErr, setCommitErr] = useState("");
  const [commitResult, setCommitResult] = useState(null);

  const page = Number(searchParams.get("page") ?? data.page ?? 1) || 1;
  const pageSize = Number(searchParams.get("pageSize") ?? data.pageSize ?? 50) || 50;
  const totalPages = Math.max(1, Math.ceil(Number(data.total ?? 0) / pageSize));

  function pushParams(next) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || String(v) === "") sp.delete(k);
      else sp.set(k, String(v));
    }
    router.push(`/vacancy?${sp.toString()}`);
  }

  async function refresh() {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    if (q) sp.set("q", q);
    const res = await fetch(`${apiBase()}/vacancy?${sp.toString()}`, { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setData(json);
  }

  function goToPage(p) {
    const next = Math.min(totalPages, Math.max(1, p));
    pushParams({ page: String(next), pageSize: String(pageSize) });
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput);
      pushParams({ q: qInput, page: "1" });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, q]);

  const headerOptions = useMemo(
    () => (csvPreview?.headers ?? []).map((h) => ({ value: h, label: h })),
    [csvPreview]
  );

  function autoPickFor(dbCol) {
    const headers = csvPreview?.headers ?? [];
    const want = normalizeHeader(dbCol);
    const byNorm = new Map(headers.map((h) => [normalizeHeader(h), h]));
    if (byNorm.has(want)) return byNorm.get(want);
    return "";
  }

  function setMap(dbCol, csvHeader) {
    setCsvMapping((m) => ({ ...m, [dbCol]: csvHeader || undefined }));
  }

  function closeMap() {
    setMapOpen(false);
    setCommitErr("");
  }

  async function onUpload(file) {
    if (!file) return;
    setUploadBusy(true);
    setUploadErr("");
    setUploadMsg("");
    setCommitErr("");
    setCommitResult(null);
    try {
      processing.start("Uploading vacancy CSV…");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${apiBase()}/vacancy/upload/preview`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `Preview failed (${res.status})`);
      setCsvPreview(json);
      setCsvMapping(json.autoMapping ?? {});
      setMapOpen(true);
      setUploadMsg(`Preview ready · ${json.totalRows?.toLocaleString?.() ?? json.totalRows} row(s) detected. Map columns and commit.`);
    } catch (e) {
      setUploadErr(String(e?.message ?? e));
    } finally {
      setUploadBusy(false);
      processing.stop();
    }
  }

  async function onCommitMapping() {
    if (!csvPreview) return;
    setCommitBusy(true);
    setCommitErr("");
    setCommitResult(null);
    try {
      processing.start("Committing vacancy rows to DB…");
      const res = await fetch(`${apiBase()}/vacancy/upload/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: csvPreview.uploadId, mapping: csvMapping }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "Commit failed");
      setCommitResult(json);
      if (!json?.ok) setCommitErr(json?.totalErrors ? `Commit completed with errors (${json.totalErrors})` : "Commit completed with errors");
      else {
        setUploadMsg(
          `Saved ${json.rowsUpserted?.toLocaleString?.() ?? json.rowsUpserted} row(s); ${json.statesTouched?.toLocaleString?.() ?? json.statesTouched} state code(s) in states table.`
        );
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
        await refresh();
        setMapOpen(false);
      }
    } catch (e) {
      setCommitErr(String(e?.message ?? e));
    } finally {
      setCommitBusy(false);
      processing.stop();
    }
  }

  const rows = data.rows ?? [];
  const colCount = 16;

  return (
    <div style={{ padding: 28 }}>
      {SHOW_VACANCY_UPLOAD ? (
        <div className="card mb-24">
          <div className="card-header">
            <div>
              <div className="card-title">Upload vacancy CSV</div>
              <div className="card-subtitle">
                Same columns as the official vacancy export CSV. The state column updates the states reference table; vacancy rows store only
                state_code.
              </div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={uploadBusy} />
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={uploadBusy}
                onClick={() => {
                  const f = fileRef.current?.files?.[0];
                  if (f) onUpload(f);
                  else setUploadErr("Choose a .csv file first.");
                }}
              >
                {uploadBusy ? "Uploading…" : "Upload & preview"}
              </button>
            </div>
            {uploadErr ? (
              <p className="mt-16" style={{ color: "var(--red)", fontSize: 13 }}>
                {uploadErr}
              </p>
            ) : null}
            {uploadMsg ? (
              <p className="mt-16" style={{ color: "var(--green)", fontSize: 13 }}>
                {uploadMsg}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Vacancy rows</div>
            <div className="card-subtitle">state name is loaded from states via state_code</div>
          </div>
          <div className="search-box" style={{ flex: "0 1 320px" }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="var(--ink4)" strokeWidth="1.5">
              <circle cx="8" cy="8" r="5.5" />
              <path d="M12 12l5 5" />
            </svg>
            <input placeholder="Search…" value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="Search" />
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>state_code</th>
                  <th>state</th>
                  <th>gender</th>
                  <th>post_code</th>
                  <th>force</th>
                  <th>area</th>
                  <th>category</th>
                  <th>category_code</th>
                  <th>vacancies</th>
                  <th>initial</th>
                  <th>current</th>
                  <th>allocated</th>
                  <th>left_vacancy</th>
                  <th>allocated_hc</th>
                  <th>allocated_hc_prev</th>
                  <th>key</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} style={{ color: "var(--ink3)", padding: 24 }}>
                      No data yet. Upload the vacancy CSV above.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{fmtCell(r.state_code)}</td>
                      <td>{fmtCell(r.state_name)}</td>
                      <td className="mono">{fmtCell(r.gender)}</td>
                      <td className="mono">{fmtCell(r.post_code)}</td>
                      <td>{fmtCell(r.force)}</td>
                      <td>{fmtCell(r.area)}</td>
                      <td>{fmtCell(r.category)}</td>
                      <td className="mono">{fmtCell(r.category_code)}</td>
                      <td className="mono">{fmtCell(r.vacancies)}</td>
                      <td className="mono">{fmtCell(r.initial)}</td>
                      <td className="mono">{fmtCell(r.current)}</td>
                      <td className="mono">{fmtCell(r.allocated)}</td>
                      <td className="mono">{fmtCell(r.left_vacancy)}</td>
                      <td className="mono">{fmtCell(r.allocated_hc)}</td>
                      <td className="mono">{fmtCell(r.allocated_hc_prev)}</td>
                      <td className="mono">{fmtCell(r.key)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="pager" style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
            <div className="pager-info">
              Showing {rows.length} of {Number(data.total ?? 0).toLocaleString()} row(s)
            </div>
            <div className="pager-btns">
              <button className="pager-btn" type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
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
                    >
                      {n.toLocaleString()}
                    </button>
                  );
                }
                return out;
              })()}
              <button className="pager-btn" type="button" onClick={() => goToPage(page + 1)} disabled={page >= totalPages}>
                ›
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Vacancy mapping modal */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: mapOpen ? "rgba(0,0,0,0.35)" : "transparent",
          display: mapOpen ? "flex" : "none",
          alignItems: "center",
          justifyContent: "center",
          padding: 18,
          zIndex: 60,
        }}
        onClick={closeMap}
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
              <div className="card-title">Map CSV fields → Vacancy DB</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>
                Rows in file: <span className="mono">{csvPreview?.totalRows ?? "—"}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn btn-ghost btn-sm" type="button" onClick={closeMap} disabled={commitBusy}>
                Close
              </button>
              <button className="btn btn-success btn-sm" type="button" onClick={onCommitMapping} disabled={!csvPreview || commitBusy}>
                {commitBusy ? "Committing…" : "Commit to DB"}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {commitErr ? (
              <div style={{ padding: "10px 16px", color: "var(--red)", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
                {commitErr}
              </div>
            ) : null}

            {commitResult?.ok ? (
              <div style={{ padding: "10px 16px", color: "var(--green)", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
                Upserted <span className="mono">{commitResult.rowsUpserted}</span> rows into <span className="mono">vacancy_rows</span>.
              </div>
            ) : null}

            {commitResult && commitResult.ok === false ? (
              <div style={{ padding: "10px 16px", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
                <div style={{ color: "var(--red)", fontWeight: 600 }}>
                  Commit completed with errors · total errors: <span className="mono">{commitResult.totalErrors ?? "—"}</span>
                </div>
                {commitResult.errorStats ? (
                  <div style={{ marginTop: 6, color: "var(--ink3)" }}>
                    Top reasons:{" "}
                    <span className="mono">
                      {Object.entries(commitResult.errorStats)
                        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                        .slice(0, 4)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(" · ")}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="table-wrap" style={{ overflow: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>DB field</th>
                    <th>CSV column</th>
                    <th>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {(csvPreview?.vacancyColumns ?? []).map((dbCol) => {
                    const selected = csvMapping?.[dbCol] ?? "";
                    const sample = csvPreview?.previewRows?.[0]?.[selected] ?? "";
                    return (
                      <tr key={dbCol}>
                        <td className="mono">{dbCol}</td>
                        <td>
                          <select
                            className="filter-select"
                            value={selected}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "__AUTO__") setMap(dbCol, autoPickFor(dbCol));
                              else setMap(dbCol, v);
                            }}
                          >
                            <option value="">— Not mapped —</option>
                            <option value="__AUTO__">Auto-pick</option>
                            {headerOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="mono" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {String(sample ?? "")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "var(--ink3)" }}>
              Unmapped fields: <span className="mono">{(csvPreview?.unmapped ?? []).join(", ") || "—"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
