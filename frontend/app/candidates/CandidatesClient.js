"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiBase } from "../lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import { useProcessing } from "../lib/processing";

function normalizeHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function Badge({ className, children }) {
  return <span className={`badge ${className}`}>{children}</span>;
}

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

function fmtNum(v, fallback = "0.00") {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function genderShort(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "—";
  if (s === "1" || s === "f" || s === "female") return "F";
  if (s === "2" || s === "m" || s === "male") return "M";
  return String(v).slice(0, 1).toUpperCase();
}

function BadgeStatus({ value, kind }) {
  const v = String(value ?? "").trim();
  if (!v) return <Badge className="badge-gray">—</Badge>;
  const k = String(kind ?? "").toLowerCase();
  if (k === "qualified") return <Badge className="badge-green">Qualified</Badge>;
  if (k === "fit") return <Badge className="badge-green">Fit</Badge>;
  if (k === "yes") return <Badge className="badge-green">Yes</Badge>;
  if (k === "no") return <Badge className="badge-red">No</Badge>;
  return <Badge className="badge-gray">{v}</Badge>;
}

function initialsFromName(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "—";
  const a = parts[0][0] ?? "";
  const b = parts.length > 1 ? parts[1][0] : parts[0][1] ?? "";
  return (a + b).toUpperCase();
}

function formatDobLong(dobIso) {
  if (!dobIso) return "—";
  const s = String(dobIso).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0));
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function areaTypeFromRaw(raw) {
  const naxal = String(raw?.naxal_district ?? raw?.naxal_district_app ?? "").toLowerCase();
  const border = String(raw?.border_district ?? raw?.border_district_app ?? "").toLowerCase();
  const isNaxal = naxal === "t" || naxal === "true";
  const isBorder = border === "t" || border === "true";
  if (isNaxal && isBorder) return "Naxal + Border District";
  if (isNaxal) return "Naxal District";
  if (isBorder) return "Border District";
  return "General";
}

export default function CandidatesClient({ initial }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processing = useProcessing();
  const [qInput, setQInput] = useState(searchParams.get("q") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [category, setCategory] = useState(searchParams.get("category") ?? "");
  const [gender, setGender] = useState(searchParams.get("gender") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [data, setData] = useState(initial);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef(null);
  const [csvPreview, setCsvPreview] = useState(null);
  const [csvMapping, setCsvMapping] = useState({});
  const [mapOpen, setMapOpen] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitErr, setCommitErr] = useState("");
  const [commitResult, setCommitResult] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerErr, setDrawerErr] = useState("");
  const [drawer, setDrawer] = useState(null);

  const page = Number(searchParams.get("page") ?? data.page ?? 1) || 1;
  const pageSize = Number(searchParams.get("pageSize") ?? data.pageSize ?? 50) || 50;
  const totalPages = Math.max(1, Math.ceil(Number(data.total ?? 0) / pageSize));

  function pushParams(next) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || String(v) === "") sp.delete(k);
      else sp.set(k, String(v));
    }
    router.push(`/candidates?${sp.toString()}`);
  }

  async function refresh() {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    if (q) sp.set("q", q);
    if (category) sp.set("category", category);
    if (gender) sp.set("gender", gender);
    if (status) sp.set("status", status);

    const res = await fetch(
      `${apiBase()}/candidates?${sp.toString()}`,
      { cache: "no-store" }
    );
    const json = await res.json();
    if (res.ok) setData(json);
  }

  async function onFile(file) {
    if (!file) return;
    setUploadBusy(true);
    setUploadErr("");
    setCommitErr("");
    setCommitResult(null);
    try {
      processing.start("Uploading candidate master CSV…");
      const fd = new FormData();
      fd.append("file", file);
      const pres = await fetch(`${apiBase()}/upload/csv`, { method: "POST", body: fd });
      const pjson = await pres.json();
      if (!pres.ok) throw new Error(pjson?.error?.message ?? "Preview failed");
      setCsvPreview(pjson);
      setCsvMapping(pjson.autoMapping ?? {});
      setMapOpen(true);
    } catch (e) {
      setUploadErr(String(e?.message ?? e));
    } finally {
      setUploadBusy(false);
      processing.stop();
    }
  }

  function closeMap() {
    setMapOpen(false);
    setCommitErr("");
  }

  function setMap(dbCol, csvHeader) {
    setCsvMapping((m) => ({ ...m, [dbCol]: csvHeader || undefined }));
  }

  function autoPickFor(dbCol) {
    const headers = csvPreview?.headers ?? [];
    const want = normalizeHeader(dbCol);
    const byNorm = new Map(headers.map((h) => [normalizeHeader(h), h]));
    if (byNorm.has(want)) return byNorm.get(want);
    return "";
  }

  async function onCommitMapping() {
    if (!csvPreview) return;
    setCommitBusy(true);
    setCommitErr("");
    setCommitResult(null);
    try {
      processing.start("Committing candidate rows to DB…");
      const cres = await fetch(`${apiBase()}/upload/csv/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: csvPreview.uploadId, mapping: csvMapping }),
      });
      const cjson = await cres.json();
      if (!cres.ok) throw new Error(cjson?.error?.message ?? "Commit failed");
      setCommitResult(cjson);
      if (!cjson?.ok) setCommitErr(cjson?.totalErrors ? `Commit failed (${cjson.totalErrors} errors)` : "Commit failed");
      else await refresh();
    } catch (e) {
      setCommitErr(String(e?.message ?? e));
    } finally {
      setCommitBusy(false);
      processing.stop();
    }
  }

  const rows = data.rows;

  function goToPage(p) {
    const next = Math.min(totalPages, Math.max(1, p));
    pushParams({ page: String(next), pageSize: String(pageSize) });
  }

  function buildPagerPages(curr, last) {
    // Matches typical UI: 1 2 3 … N when large, but adapts dynamically.
    if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
    const pages = new Set([1, last, curr, curr - 1, curr + 1, curr - 2, curr + 2]);
    const arr = Array.from(pages).filter((n) => n >= 1 && n <= last);
    arr.sort((a, b) => a - b);
    return arr;
  }

  async function openDrawer(candidateId) {
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerErr("");
    try {
      const res = await fetch(`${apiBase()}/candidates/${encodeURIComponent(candidateId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load candidate");
      setDrawer(json);
    } catch (e) {
      setDrawerErr(String(e?.message ?? e));
      setDrawer(null);
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        closeDrawer();
        closeMap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounce search input → query param
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput);
      pushParams({ q: qInput, page: "1" });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  // When URL params change, fetch the new page from API.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, q, category, gender, status]);

  return (
    <>
      <div style={{ padding: 28 }}>
        <div id="cand-upload-section" className="mb-24">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <div
            className="upload-zone"
            style={{ cursor: uploadBusy ? "default" : "pointer", position: "relative" }}
            aria-busy={uploadBusy ? "true" : "false"}
            onClick={() => {
              if (uploadBusy) return;
              fileRef.current?.click();
            }}
            onDragOver={(e) => {
              if (uploadBusy) return;
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              if (uploadBusy) return;
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer?.files?.[0];
              onFile(f ?? null);
            }}
          >
            <div className="upload-icon-big">📄</div>
            <div className="upload-title">{uploadBusy ? "Uploading…" : "Drop Candidate_Master.csv here (or click)"}</div>
            {uploadErr ? <div style={{ marginTop: 10, color: "var(--red)", fontSize: 12 }}>{uploadErr}</div> : null}
            {uploadBusy ? (
              <div className="upload-overlay">
                <span className="spinner" />
                Uploading candidate file…
              </div>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Candidate list</div>
            <span />
          </div>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <div className="filter-row">
              <div className="search-box">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="9" cy="9" r="6" />
                  <path d="m15 15 4 4" />
                </svg>
                <input
                  placeholder="Search name, ID, roll number…"
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                />
              </div>
              <select
                className="filter-select"
                value={category}
                onChange={(e) => {
                  const v = e.target.value;
                  setCategory(v);
                  pushParams({ category: v, page: "1" });
                }}
              >
                <option value="">All categories</option>
                <option value="UR">UR</option>
                <option value="OBC">OBC</option>
                <option value="SC">SC</option>
                <option value="ST">ST</option>
                <option value="EWS">EWS</option>
              </select>
              <select
                className="filter-select"
                value={gender}
                onChange={(e) => {
                  const v = e.target.value;
                  setGender(v);
                  pushParams({ gender: v, page: "1" });
                }}
              >
                <option value="">All genders</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
              <select className="filter-select" onChange={() => {}}>
                <option>All states</option>
                <option>Delhi</option>
                <option>UP</option>
                <option>Bihar</option>
                <option>Rajasthan</option>
                <option>Uttarakhand</option>
                <option>Haryana</option>
              </select>
              <select
                className="filter-select"
                value={status}
                onChange={(e) => {
                  const v = e.target.value;
                  setStatus(v);
                  pushParams({ status: v, page: "1" });
                }}
              >
                <option value="">All provisions</option>
                <option value="cleared">Cleared</option>
                <option value="tu">TU</option>
                <option value="debarred">Debarred</option>
                <option value="withheld">Withheld</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
          <div className="table-wrap" id="cand-table-wrap">
            <table id="cand-table">
              <thead>
                <tr>
                  <th>Reg No</th>
                  <th>Roll No</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Gender</th>
                  <th>State</th>
                  <th>Norm. Marks</th>
                  <th>NCC Marks</th>
                  <th>Total Marks</th>
                  <th>DOB</th>
                  <th>PST/PET</th>
                  <th>DME</th>
                  <th>To Be Considered</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="cand-tbody">
                {rows.map((r) => (
                  <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => openDrawer(r.id)}>
                    <td className="mono">{r.rawData?.registrationNo ?? "—"}</td>
                    <td className="mono">{r.rollNo}</td>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td>
                      {r.category ? (
                        <Badge className={r.category === "SC" ? "badge-purple" : r.category === "OBC" ? "badge-amber" : "badge-gray"}>{r.category}</Badge>
                      ) : (
                        <Badge className="badge-gray">—</Badge>
                      )}
                    </td>
                    <td>{genderShort(r.gender ?? r.rawData?.gender_app ?? r.rawData?.gender)}</td>
                    <td>{[r.domicileState, r.district].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="mono">{r.normalizedMarks ?? "—"}</td>
                    <td className="mono">{fmtNum(r.rawData?.ncc_marks_new ?? r.rawData?.ncc_marks_app ?? 0, "0.00")}</td>
                    <td className="mono">
                      <strong>{fmtNum(r.rawData?.total_marks_new ?? r.rawData?.total_marks ?? r.finalMarks ?? r.normalizedMarks, "—")}</strong>
                    </td>
                    <td className="mono">{formatDob(r.dob)}</td>
                    <td>
                      {String(r.rawData?.final_pet_pst_status ?? r.rawData?.pet_status ?? "").toLowerCase().includes("qualified") ? (
                        <Badge className="badge-green">Qualified</Badge>
                      ) : (
                        <Badge className="badge-gray">—</Badge>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const dme = String(r.rawData?.dme_status ?? r.rawData?.dme_final_status ?? "").trim();
                        if (!dme) return <Badge className="badge-red">Unfit</Badge>;
                        if (dme.toLowerCase().includes("fit")) return <Badge className="badge-green">Fit</Badge>;
                        if (dme.toLowerCase().includes("unfit")) return <Badge className="badge-red">Unfit</Badge>;
                        return <Badge className="badge-gray">{dme}</Badge>;
                      })()}
                    </td>
                    <td>
                      {String(r.rawData?.to_be_considered ?? "").toLowerCase() === "yes" ? (
                        <Badge className="badge-green">Yes</Badge>
                      ) : String(r.rawData?.to_be_considered ?? "").toLowerCase() === "no" ? (
                        <Badge className="badge-red">No</Badge>
                      ) : (
                        <Badge className="badge-gray">—</Badge>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer(r.id);
                        }}
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <div className="pager-info">
              Showing {rows.length} of {data.total} candidates
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

      {/* CSV mapping modal */}
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
              <div className="card-title">Map CSV fields → Candidate DB</div>
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
              <div style={{ padding: "10px 16px", color: "var(--red)", fontSize: 12, borderBottom: "1px solid var(--border)" }}>{commitErr}</div>
            ) : null}

            {commitResult?.ok ? (
              <div style={{ padding: "10px 16px", color: "var(--green)", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
                Inserted <span className="mono">{commitResult.inserted}</span> rows into <span className="mono">candidates</span>.
              </div>
            ) : commitResult && commitResult.ok === false ? (
              <div style={{ padding: "10px 16px", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
                <div style={{ color: "var(--red)", fontWeight: 600 }}>
                  Commit failed · total errors: <span className="mono">{commitResult.totalErrors ?? "—"}</span>
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
                {Array.isArray(commitResult.errors) && commitResult.errors.length ? (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ color: "var(--ink3)", marginBottom: 6 }}>
                      Showing first <span className="mono">{commitResult.errors.length}</span> errors (max 2000):
                    </div>
                    <div style={{ maxHeight: 150, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                      <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
                        {commitResult.errors
                          .slice(0, 40)
                          .map((e) => `row ${e.row ?? "—"}: ${e.error}`)
                          .join("\n")}
                      </pre>
                    </div>
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
                  {(csvPreview?.candidateColumns ?? []).map((dbCol) => {
                    const headers = csvPreview?.headers ?? [];
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
                            {headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
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

      {/* Candidate detail drawer (matches source HTML) */}
      <div className={`detail-overlay${drawerOpen ? " open" : ""}`} id="drawer-overlay" onClick={closeDrawer}>
        <div className="detail-drawer" onClick={(e) => e.stopPropagation()}>
          <div className="drawer-header">
            <div className="drawer-avatar" id="drawer-avatar">
              {initialsFromName(drawer?.name)}
            </div>
            <div>
              <div className="drawer-name" id="drawer-name">
                {drawer?.name ?? (drawerLoading ? "Loading…" : "—")}
              </div>
              <div className="drawer-id" id="drawer-id">
                {drawer?.rawData?.registrationNo ? `Reg: ${drawer.rawData.registrationNo}` : "Reg: —"} · Roll: {drawer?.rollNo ?? "—"}
              </div>
            </div>
            <div className="drawer-close" onClick={closeDrawer} role="button" tabIndex={0}>
              ✕
            </div>
          </div>

          <div className="drawer-body">
            {drawerErr ? <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{drawerErr}</div> : null}

            <div className="detail-section">
              <div className="detail-section-title">Personal information</div>
              <div className="detail-row">
                <div className="detail-key">Date of birth</div>
                <div className="detail-val" id="dd-dob">
                  {formatDobLong(drawer?.dob)}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Gender</div>
                <div className="detail-val" id="dd-gender">
                  {drawer?.rawData?.gender_app ?? drawer?.gender ?? "—"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Category</div>
                <div className="detail-val" id="dd-cat">
                  {drawer?.category ?? drawer?.rawData?.category ?? "Not Set (review required)"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">ESM status</div>
                <div className="detail-val" id="dd-esm">
                  {String(drawer?.rawData?.whether_ex_serviceman ?? drawer?.isEsm ?? "No").toLowerCase() === "true" ||
                  String(drawer?.rawData?.whether_ex_serviceman ?? "").toLowerCase() === "true"
                    ? "Yes"
                    : "No"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">NCC certificate</div>
                <div className="detail-val" id="dd-ncc">
                  {drawer?.rawData?.type_of_ncc_certificate || drawer?.rawData?.ncc_type_app || drawer?.nccCert || "0 (none)"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">State / District</div>
                <div className="detail-val" id="dd-state">
                  {[drawer?.domicileState, drawer?.district].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Area type</div>
                <div className="detail-val" id="dd-area">
                  {areaTypeFromRaw(drawer?.rawData)}
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">Force preferences</div>
              <div className="detail-row">
                <div className="detail-key">Pref 1–4</div>
                <div className="detail-val" id="dd-forces">
                  {String(drawer?.rawData?.post_preference ?? "").split(",").slice(0, 4).join(", ") || "—"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Pref 5–8</div>
                <div className="detail-val">
                  {String(drawer?.rawData?.post_preference ?? "").split(",").slice(4, 8).join(", ") || "—"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Force allotted</div>
                <div className="detail-val" id="dd-allot">
                  {drawer?.allocation?.forceCode ? <span className="badge badge-green">{drawer.allocation.forceCode}</span> : <span className="badge badge-gray">Pending</span>}
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">CBE performance</div>
              <div className="detail-row">
                <div className="detail-key">Normalised marks</div>
                <div className="detail-val mono" id="dd-marks">
                  {drawer?.rawData?.normalized_score ?? drawer?.normalizedMarks ?? "—"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Part-A (Reasoning)</div>
                <div className="detail-val mono" id="dd-pa">
                  {drawer?.rawData?.parta_gi ?? drawer?.partAMarks ?? "—"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Part-B (GK)</div>
                <div className="detail-val mono" id="dd-pb">
                  {drawer?.rawData?.partb_ga ?? drawer?.partBMarks ?? "—"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">NCC bonus</div>
                <div className="detail-val mono" id="dd-nccb">
                  {drawer?.rawData?.ncc_marks_new ?? drawer?.rawData?.ncc_marks_app ?? "0.00"}
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Total (with NCC)</div>
                <div className="detail-val mono" id="dd-total">
                  <strong>{drawer?.rawData?.total_marks_new ?? drawer?.rawData?.total_marks ?? drawer?.finalMarks ?? "—"}</strong>
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Overall rank</div>
                <div className="detail-val mono" id="dd-rank">
                  <strong>{drawer?.meritRank ? `#${drawer.meritRank}` : "—"}</strong>
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">Stage journey</div>
              <div className="stage-timeline">
                <div className="timeline-item">
                  <div className="timeline-dot done"></div>
                  <div className="timeline-stage" id="dd-s1">
                    CBE — {drawer?.rawData?.normalized_score ?? drawer?.normalizedMarks ?? "—"}
                  </div>
                  <div className="timeline-detail">Cleared cutoff · Shortlisted for PST/PET</div>
                </div>
                <div className="timeline-item">
                  <div className={`timeline-dot ${String(drawer?.rawData?.final_pet_pst_status ?? "").toLowerCase().includes("qualified") ? "done" : "pending-dot"}`} id="dd-dot2"></div>
                  <div className="timeline-stage" id="dd-s2">
                    PST/PET — {drawer?.rawData?.final_pet_pst_status ?? drawer?.rawData?.pet_status ?? "Not recorded"}
                  </div>
                  <div className="timeline-detail" id="dd-s2d">
                    final_pet_pst_status = {drawer?.rawData?.final_pet_pst_status ?? "—"}
                  </div>
                </div>
                <div className="timeline-item">
                  <div className={`timeline-dot ${String(drawer?.rawData?.dme_status ?? "").toLowerCase().includes("fit") ? "done" : "pending-dot"}`} id="dd-dot3"></div>
                  <div className="timeline-stage" id="dd-s3">
                    DME — {drawer?.rawData?.dme_status ?? "Not recorded"}
                  </div>
                  <div className="timeline-detail" id="dd-s3d">
                    dme_status = {drawer?.rawData?.dme_status ?? "—"}
                  </div>
                </div>
                <div className="timeline-item">
                  <div className="timeline-dot pending-dot" id="dd-dot4"></div>
                  <div className="timeline-stage" id="dd-s4">
                    Final RME — {drawer?.rawData?.final_rme_status ?? "Not recorded"}
                  </div>
                  <div className="timeline-detail" id="dd-s4d">
                    final_rme_status = {drawer?.rawData?.final_rme_status ?? "—"}
                  </div>
                </div>
                <div className="timeline-item">
                  <div className="timeline-dot pending-dot" id="dd-dot5"></div>
                  <div className="timeline-stage" id="dd-s5">
                    To Be Considered — {drawer?.rawData?.to_be_considered ?? "—"}
                  </div>
                  <div className="timeline-detail" id="dd-s5d">
                    to_be_considered = {drawer?.rawData?.to_be_considered ?? "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">Provision status</div>
              <div className="detail-row">
                <div className="detail-key">Code</div>
                <div className="detail-val" id="dd-prov">
                  <span className={`badge ${drawer?.status === "cleared" ? "badge-green" : drawer?.status === "rejected" ? "badge-red" : "badge-gray"}`}>
                    {drawer?.status ?? "—"}
                  </span>
                </div>
              </div>
              <div className="detail-row">
                <div className="detail-key">Remarks</div>
                <div className="detail-val" id="dd-remarks">
                  {drawer?.rawData?.remarks ?? drawer?.rawData?.remarks_dv ?? "—"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

