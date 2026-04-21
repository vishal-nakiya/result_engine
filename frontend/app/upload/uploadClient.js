"use client";

import { useMemo, useRef, useState } from "react";
import { apiBase } from "../lib/api";

function normalizeHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

const STAGES = [
  { id: "cbe", label: "CBE Marks" },
  { id: "pst", label: "PST" },
  { id: "pet", label: "PET" },
  { id: "dme", label: "DME / RME" },
  { id: "dv", label: "DV" },
];

/** First CSV column name for “Stage template” download per tab */
const STAGE_TEMPLATE_HEAD = {
  cbe: "registrationNo",
  pst: "registrationNo",
  pet: "registrationNo",
  dme: "registrationNo",
  dv: "registrationNo",
};

const TYPE_BADGE = {
  roll_no: "TEXT",
  name: "TEXT",
  father_name: "TEXT",
  dob: "DATE",
  gender: "ENUM",
  category: "ENUM",
  is_esm: "BOOL",
  domicile_state: "TEXT",
  district: "TEXT",
  height: "DECIMAL",
  chest: "DECIMAL",
  weight: "DECIMAL",
  is_pwd: "BOOL",
  ncc_cert: "TEXT",
  marks_cbe: "DECIMAL",
  normalized_marks: "DECIMAL(12,5)",
  part_a_marks: "DECIMAL",
  part_b_marks: "DECIMAL",
  status: "ENUM",
};

async function fileToCsvFile(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) return file;
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const name = wb.SheetNames[0];
    if (!name) throw new Error("Workbook has no sheets");
    const sheet = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return new File([csv], file.name.replace(/\.xlsx?$/i, ".csv"), { type: "text/csv" });
  }
  throw new Error("Use a .csv, .xlsx, or .xls file");
}

function findHeader(headers, ...candidates) {
  const norm = new Map(headers.map((h) => [normalizeHeader(h), h]));
  for (const c of candidates) {
    const n = normalizeHeader(c);
    if (norm.has(n)) return norm.get(n);
  }
  return null;
}

function computeSummary(preview, mapping) {
  if (!preview?.previewRows?.length) return null;
  const headers = preview.headers ?? [];
  const rows = preview.previewRows;
  const regCol = findHeader(headers, "registrationNo", "registration_no") ?? mapping.roll_no;
  const catCol = mapping.category;
  const statusCol = findHeader(headers, "candidature_status", "candidature status");

  const ids = [];
  for (const r of rows) {
    const id = regCol ? String(r[regCol] ?? "").trim() : "";
    if (id) ids.push(id);
  }
  const dup = ids.length - new Set(ids).size;

  let missingCat = 0;
  if (catCol) {
    for (const r of rows) {
      if (!String(r[catCol] ?? "").trim()) missingCat += 1;
    }
  }

  let qualified = 0;
  if (statusCol) {
    for (const r of rows) {
      const s = String(r[statusCol] ?? "").trim().toUpperCase();
      if (s === "Q") qualified += 1;
    }
  }

  const normCol = mapping.normalized_marks;
  let marksMin = null;
  let marksMax = null;
  const nccColUse = findHeader(headers, "ncc_marks_new", "ncc_marks_app");
  if (normCol) {
    for (const r of rows) {
      const n = Number(String(r[normCol] ?? "").replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      marksMin = marksMin == null ? n : Math.min(marksMin, n);
      marksMax = marksMax == null ? n : Math.max(marksMax, n);
    }
  }

  let toBeYes = 0;
  const tbc = findHeader(headers, "to_be_considered");
  if (tbc) {
    for (const r of rows) {
      if (String(r[tbc] ?? "").trim().toLowerCase() === "yes") toBeYes += 1;
    }
  }

  return {
    sample: rows.length,
    total: preview.totalRows ?? rows.length,
    dup,
    missingCat,
    qualified,
    statusCol: !!statusCol,
    marksRange:
      marksMin != null && marksMax != null ? `${marksMin} – ${marksMax}` : normCol ? "— (check values)" : "—",
    nccNote: nccColUse ? `Column: ${nccColUse}` : "ncc_marks_new (if present)",
    toBeYes,
    tbc: !!tbc,
  };
}

export default function UploadClient() {
  const fileRef = useRef(null);
  const [activeStage, setActiveStage] = useState("cbe");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [commitResult, setCommitResult] = useState(null);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState(null);
  const [validateBanner, setValidateBanner] = useState(null);
  const [uploadByStage, setUploadByStage] = useState({});
  const [processMsg, setProcessMsg] = useState("");

  const headerList = preview?.headers;
  const headerOptions = useMemo(() => (headerList ?? []).map((h) => ({ value: h, label: h })), [headerList]);
  const summary = useMemo(() => computeSummary(preview, mapping), [preview, mapping]);

  const requiredMapped = ["roll_no", "name", "dob", "gender", "category"].every((k) => Boolean(mapping[k]));
  const schemaOk = Boolean(preview) && requiredMapped;

  function selectStage(id) {
    setActiveStage(id);
    const b = uploadByStage[id];
    setPreview(b?.preview ?? null);
    setMapping(b?.mapping ?? {});
    setFile(null);
    setCommitResult(null);
    setError("");
    setBanner(null);
    setValidateBanner(null);
  }

  function pickFile() {
    fileRef.current?.click();
  }

  async function onPreview() {
    if (!file) return;
    setBusy(true);
    setError("");
    setCommitResult(null);
    setBanner(null);
    setValidateBanner(null);
    try {
      const csvFile = await fileToCsvFile(file);
      const fd = new FormData();
      fd.append("file", csvFile);
      const endpoint =
        activeStage === "pst" ? "pst" : activeStage === "pet" ? "pet" : "csv";
      const res = await fetch(`${apiBase()}/upload/${endpoint}`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Preview failed");
      const nextMapping = json.autoMapping ?? {};
      setPreview(json);
      setMapping(nextMapping);
      setUploadByStage((prev) => ({
        ...prev,
        [activeStage]: { preview: json, mapping: nextMapping, fileName: file.name },
      }));
      const summ = computeSummary(json, nextMapping);
      const parts = [
        `Upload complete · ${json.totalRows?.toLocaleString?.() ?? json.totalRows} row(s)`,
        summ ? `${summ.sample} sample preview row(s)` : "",
        summ && summ.dup ? `${summ.dup} duplicate ID(s) in sample` : summ ? "0 ID duplicates in sample" : "",
        "Map registrationNo / rollno to roll_no as needed",
        summ && summ.missingCat ? `${summ.missingCat} missing category in sample` : "",
      ].filter(Boolean);
      setBanner({ kind: "success", text: parts.join(" · ") });
    } catch (e) {
      setError(String(e?.message ?? e));
      setPreview(null);
      setMapping({});
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    setCommitResult(null);
    try {
      const commitEndpoint =
        activeStage === "pst"
          ? "pst/commit"
          : activeStage === "pet"
            ? "pet/commit"
            : "csv/commit";
      const res = await fetch(`${apiBase()}/upload/${commitEndpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: preview.uploadId,
          mapping,
          stage: activeStage,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Commit failed");
      setCommitResult(json);
      setBanner({
        kind: json.ok ? "success" : "error",
        text: json.ok ? `Committed ${json.inserted} row(s) for stage “${STAGES.find((s) => s.id === activeStage)?.label}”.` : `Commit failed (${json.totalErrors} error(s)).`,
      });
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function setMap(dbCol, csvHeader) {
    setMapping((m) => {
      const next = { ...m, [dbCol]: csvHeader || undefined };
      setUploadByStage((prev) => {
        const cur = prev[activeStage];
        if (!cur?.preview) return prev;
        return { ...prev, [activeStage]: { ...cur, mapping: next } };
      });
      return next;
    });
  }

  function autoPickFor(dbCol) {
    const hdrs = preview?.headers ?? [];
    const want = normalizeHeader(dbCol);
    const byNorm = new Map(hdrs.map((h) => [normalizeHeader(h), h]));
    if (byNorm.has(want)) return byNorm.get(want);
    return "";
  }

  function onValidateAll() {
    const stages = STAGES.map((s) => s.id);
    const lines = stages.map((id) => {
      const b = uploadByStage[id];
      if (!b?.preview) return `${STAGES.find((x) => x.id === id)?.label}: no upload yet`;
      const m = b.mapping ?? {};
      const ok = ["roll_no", "name", "dob", "gender", "category"].every((k) => Boolean(m[k]));
      return `${STAGES.find((x) => x.id === id)?.label}: ${ok ? "required maps OK" : "missing required maps"} · ${b.preview.totalRows} rows`;
    });
    setValidateBanner({ kind: "info", text: lines.join(" · ") });
  }

  async function onRunProcessing() {
    setProcessMsg("");
    setBusy(true);
    try {
      const res = await fetch(`${apiBase()}/process/run`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Processing failed");
      setProcessMsg(
        typeof json?.message === "string"
          ? json.message
          : `Processed ${json?.processed ?? "—"} · cleared ${json?.cleared ?? "—"}`
      );
      setBanner({ kind: "success", text: "Pipeline run completed. Check Merit / Allocation pages for results." });
    } catch (e) {
      setProcessMsg(String(e?.message ?? e));
      setBanner({ kind: "error", text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const head = STAGE_TEMPLATE_HEAD[activeStage] ?? "registrationNo";
    const csv = `${head},column2,column3\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `template_${activeStage}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">Stage-wise Result Upload</div>
          <div className="topbar-sub">
            Map by <span className="mono">registrationNo</span> / <span className="mono">rollno</span>. Pick a stage tab, upload CSV or Excel — then map columns and commit. Run processing after all stages are loaded.
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onValidateAll} disabled={busy}>
            Validate All
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={onRunProcessing} disabled={busy}>
            Run Processing
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={downloadTemplate}>
            ↓ Stage template
          </button>
        </div>
      </div>

      <div style={{ padding: "0 28px 28px" }}>
        <div className="stage-upload-tabs" role="tablist">
          {STAGES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeStage === s.id}
              className={`stage-upload-tab${activeStage === s.id ? " active" : ""}`}
              onClick={() => selectStage(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {banner ? (
          <div
            className={`card`}
            style={{
              marginBottom: 16,
              borderLeft: `4px solid var(--${banner.kind === "success" ? "green" : banner.kind === "error" ? "red" : "accent"})`,
              background: banner.kind === "success" ? "var(--green-bg)" : banner.kind === "error" ? "var(--red-bg)" : "var(--accent-bg)",
            }}
          >
            <div style={{ padding: "12px 16px", fontSize: 13 }}>{banner.text}</div>
          </div>
        ) : null}

        {validateBanner ? (
          <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid var(--accent)", background: "var(--accent-bg)" }}>
            <div style={{ padding: "12px 16px", fontSize: 13 }}>{validateBanner.text}</div>
          </div>
        ) : null}

        {processMsg ? (
          <div style={{ marginBottom: 12, fontSize: 12, color: "var(--ink3)" }} className="mono">
            {processMsg}
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          style={{ display: "none" }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <div className="card" style={{ marginBottom: 18, overflow: "hidden" }}>
          <div
            className="upload-zone"
            onClick={pickFile}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") pickFile();
            }}
            style={{ cursor: "pointer", border: "none", borderRadius: 0 }}
          >
            <div className="upload-icon-big">📄</div>
            <div className="upload-title">
              {file ? file.name : uploadByStage[activeStage]?.fileName ?? "Drop CSV / Excel here or click to browse"}
            </div>
            <div className="upload-hint">
              Excel uses the <strong>first sheet only</strong>. Data is converted to CSV for preview. Extra columns are kept in <span className="mono">raw_data</span>.
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-ghost btn-sm" type="button" onClick={(e) => { e.stopPropagation(); pickFile(); }}>
                Choose file
              </button>
              <button className="btn btn-primary btn-sm" type="button" disabled={!file || busy} onClick={(e) => { e.stopPropagation(); onPreview(); }}>
                {busy ? "Working…" : "Preview"}
              </button>
              <button className="btn btn-success btn-sm" type="button" disabled={!preview || busy} onClick={(e) => { e.stopPropagation(); onCommit(); }}>
                Commit to DB
              </button>
            </div>
            {error ? <div style={{ marginTop: 10, color: "var(--red)", fontSize: 12 }}>{error}</div> : null}
          </div>
        </div>

        {preview ? (
          <div className="upload-two-col">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Field schema validation</div>
                <span className={`badge ${schemaOk ? "badge-green" : "badge-amber"}`}>{schemaOk ? "Required maps OK" : "Map required fields"}</span>
              </div>
              <div style={{ padding: "8px 0" }}>
                {(preview.candidateColumns ?? []).map((dbCol) => {
                  const selected = mapping?.[dbCol] ?? "";
                  const badge = TYPE_BADGE[dbCol] ?? "TEXT";
                  const ok = Boolean(selected);
                  return (
                    <div
                      key={dbCol}
                      className="field-schema-row"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto auto",
                        gap: 10,
                        alignItems: "center",
                        padding: "10px 16px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div>
                        <span className="mono" style={{ fontWeight: 600 }}>
                          {dbCol}
                        </span>
                        <span className="badge badge-purple" style={{ marginLeft: 8, fontSize: 10 }}>
                          {badge}
                        </span>
                        <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>{ok ? "Mapped" : "Not mapped"}</div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 12, color: ok ? "var(--green)" : "var(--ink4)" }}>{ok ? "✓" : "—"}</div>
                      <select
                        className="filter-select"
                        style={{ maxWidth: 200 }}
                        value={selected}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__AUTO__") setMap(dbCol, autoPickFor(dbCol));
                          else setMap(dbCol, v);
                        }}
                      >
                        <option value="">—</option>
                        <option value="__AUTO__">Auto</option>
                        {headerOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--ink3)", borderTop: "1px solid var(--border)" }}>
                Unmapped auto-fields: <span className="mono">{(preview.unmapped ?? []).join(", ") || "—"}</span>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Processing summary</div>
                <span className="badge badge-gray">{STAGES.find((s) => s.id === activeStage)?.label ?? activeStage}</span>
              </div>
              <div style={{ padding: 16, fontSize: 13, lineHeight: 1.7 }}>
                <div>
                  <span style={{ color: "var(--ink3)" }}>Total records (file):</span>{" "}
                  <strong>{preview.totalRows?.toLocaleString?.() ?? preview.totalRows}</strong>
                </div>
                {summary ? (
                  <>
                    <div>
                      <span style={{ color: "var(--ink3)" }}>Sample rows used below:</span> <strong>{summary.sample}</strong>
                    </div>
                    {summary.statusCol ? (
                      <div>
                        <span style={{ color: "var(--ink3)" }}>candidature_status = Q (sample):</span>{" "}
                        <strong>
                          {summary.qualified} of {summary.sample}
                        </strong>
                      </div>
                    ) : null}
                    <div>
                      <span style={{ color: "var(--ink3)" }}>Marks range (normalized sample):</span> <span className="mono">{summary.marksRange}</span>
                    </div>
                    <div>
                      <span style={{ color: "var(--ink3)" }}>NCC marks:</span> {summary.nccNote}
                    </div>
                    {summary.tbc ? (
                      <div>
                        <span style={{ color: "var(--ink3)" }}>to_be_considered = Yes (sample):</span> <strong>{summary.toBeYes}</strong>
                      </div>
                    ) : null}
                    {summary.missingCat > 0 ? (
                      <div style={{ color: "var(--amber)", marginTop: 8 }}>
                        category missing in <strong>{summary.missingCat}</strong> sample row(s) — review before commit.
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div style={{ color: "var(--ink3)" }}>Preview rows to see summary stats.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {commitResult ? (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-header">
              <div className="card-title">Commit result</div>
            </div>
            <div style={{ padding: 16 }}>
              {commitResult.ok ? (
                <div style={{ color: "var(--green)" }}>
                  Inserted <span className="mono">{commitResult.inserted}</span> rows into <span className="mono">candidates</span>.
                </div>
              ) : (
                <div style={{ color: "var(--red)" }}>
                  Commit failed. Errors: <span className="mono">{commitResult.totalErrors}</span>
                </div>
              )}
              <pre style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, overflowX: "auto" }}>{JSON.stringify(commitResult, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
