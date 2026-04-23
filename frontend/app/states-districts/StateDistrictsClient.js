"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiBase } from "../lib/api";

function fmtBool(v) {
  if (v === true) return "t";
  if (v === false) return "f";
  return "—";
}

function buildPagerPages(curr, last) {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const pages = new Set([1, last, curr, curr - 1, curr + 1, curr - 2, curr + 2]);
  const arr = Array.from(pages).filter((n) => n >= 1 && n <= last);
  arr.sort((a, b) => a - b);
  return arr;
}

/** Set to `true` to show the master CSV upload panel on this page. */
const SHOW_STATE_DISTRICT_UPLOAD = true;

export default function StateDistrictsClient({ initial }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [qInput, setQInput] = useState(searchParams.get("q") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [data, setData] = useState(initial);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef(null);

  const page = Number(searchParams.get("page") ?? data.page ?? 1) || 1;
  const pageSize = Number(searchParams.get("pageSize") ?? data.pageSize ?? 50) || 50;
  const totalPages = Math.max(1, Math.ceil(Number(data.total ?? 0) / pageSize));

  function pushParams(next) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || String(v) === "") sp.delete(k);
      else sp.set(k, String(v));
    }
    router.push(`/states-districts?${sp.toString()}`);
  }

  async function refresh() {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    if (q) sp.set("q", q);
    const res = await fetch(`${apiBase()}/state-districts?${sp.toString()}`, { cache: "no-store" });
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

  async function onUpload(file) {
    if (!file) return;
    setUploadBusy(true);
    setUploadErr("");
    setUploadMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${apiBase()}/state-districts/upload`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `Upload failed (${res.status})`);
      setUploadMsg(
        `Saved ${json.rowsUpserted?.toLocaleString?.() ?? json.rowsUpserted} row(s) (${json.distinctDistIds?.toLocaleString?.() ?? json.distinctDistIds} districts) from ${json.rowsInFile?.toLocaleString?.() ?? json.rowsInFile} CSV lines.`
      );
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
      await refresh();
    } catch (e) {
      setUploadErr(String(e?.message ?? e));
    } finally {
      setUploadBusy(false);
    }
  }

  const rows = data.rows ?? [];

  return (
    <div style={{ padding: 28 }}>
      {SHOW_STATE_DISTRICT_UPLOAD ? (
        <div className="card mb-24">
          <div className="card-header">
            <div>
              <div className="card-title">Upload state / district master CSV</div>
              <div className="card-subtitle">
                Expected headers: stateId, stateName, stateCode, distId, distCode, districtName, description, createdById,
                createdByRoleId, updatedById, isActive, ipAddress, isNaxalDistrict, isBoarderDistrict, Present_Active
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
                {uploadBusy ? "Uploading…" : "Upload & store"}
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
            <div className="card-title">Stored rows</div>
            <div className="card-subtitle">Horizontal scroll on smaller screens · Search matches state or district fields</div>
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
                  <th>stateCode</th>
                  <th>stateName</th>
                  <th>distCode</th>
                  <th>districtName</th>
                  <th>description</th>
                  <th>isActive</th>
                  <th>isNaxalDistrict</th>
                  <th>isBoarderDistrict</th>
                  <th>Present_Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ color: "var(--ink3)", padding: 24 }}>
                      No data yet. Upload your CSV above.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.state_code}</td>
                      <td>{r.state_name}</td>
                      <td className="mono">{r.dist_code ?? "—"}</td>
                      <td>{r.district_name}</td>
                      <td>{r.description ?? "—"}</td>
                      <td className="mono">{fmtBool(r.is_active)}</td>
                      <td className="mono">{fmtBool(r.is_naxal_district)}</td>
                      <td className="mono">{fmtBool(r.is_border_district)}</td>
                      <td className="mono">{fmtBool(r.present_active)}</td>
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
    </div>
  );
}
