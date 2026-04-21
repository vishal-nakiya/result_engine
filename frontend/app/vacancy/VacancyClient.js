"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiBase } from "../lib/api";

/** Set to `true` to show the vacancy CSV upload panel. */
const SHOW_VACANCY_UPLOAD = true;

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

  async function onUpload(file) {
    if (!file) return;
    setUploadBusy(true);
    setUploadErr("");
    setUploadMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${apiBase()}/vacancy/upload`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `Upload failed (${res.status})`);
      setUploadMsg(
        `Saved ${json.rowsUpserted?.toLocaleString?.() ?? json.rowsUpserted} row(s); ${json.statesTouched?.toLocaleString?.() ?? json.statesTouched} state code(s) in states table.`
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
  const colCount = 24;

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
                  <th>min_marks_prev</th>
                  <th>min_marks_parta_prev</th>
                  <th>min_marks_partb_prev</th>
                  <th>min_marks_cand_dob_prev</th>
                  <th>min_marks</th>
                  <th>min_marks_parta</th>
                  <th>min_marks_partb</th>
                  <th>min_marks_cand_dob</th>
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
                      <td className="mono">{fmtCell(r.min_marks_prev)}</td>
                      <td className="mono">{fmtCell(r.min_marks_parta_prev)}</td>
                      <td className="mono">{fmtCell(r.min_marks_partb_prev)}</td>
                      <td className="mono">{fmtCell(r.min_marks_cand_dob_prev)}</td>
                      <td className="mono">{fmtCell(r.min_marks)}</td>
                      <td className="mono">{fmtCell(r.min_marks_parta)}</td>
                      <td className="mono">{fmtCell(r.min_marks_partb)}</td>
                      <td className="mono">{fmtCell(r.min_marks_cand_dob)}</td>
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
