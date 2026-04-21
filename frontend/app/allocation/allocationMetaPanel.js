"use client";

function flattenEntries(obj, prefix = "") {
  if (obj == null) return [[prefix || "value", String(obj)]];
  if (typeof obj !== "object") return [[prefix || "value", String(obj)]];
  if (Array.isArray(obj)) {
    return obj.flatMap((v, i) => flattenEntries(v, `${prefix}[${i}]`));
  }
  const rows = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      rows.push(...flattenEntries(v, key));
    } else {
      rows.push([key, v === null || v === undefined ? "—" : String(v)]);
    }
  }
  return rows;
}

export default function AllocationMetaPanel({ meta }) {
  if (!meta || typeof meta !== "object") {
    return (
      <div style={{ fontSize: 12, color: "var(--ink3)", padding: "8px 0" }}>
        No basis snapshot on this row. Re-run <strong>Run allocation</strong> after upgrading the backend to store proof
        metadata.
      </div>
    );
  }

  const summary = typeof meta.noticeSummary === "string" ? meta.noticeSummary : "";
  const rows = flattenEntries(meta).filter(([k]) => k !== "noticeSummary");

  return (
    <div style={{ padding: "12px 16px", background: "var(--surface2)", borderTop: "1px solid var(--border)" }}>
      {summary ? (
        <p style={{ margin: "0 0 12px", fontSize: 12, lineHeight: 1.45, color: "var(--ink2)" }}>
          <strong style={{ color: "var(--ink)" }}>Notice / logic summary:</strong> {summary}
        </p>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: "38%" }}>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="mono" style={{ fontSize: 11, color: "var(--ink3)", verticalAlign: "top" }}>
                  {k}
                </td>
                <td className="mono" style={{ fontSize: 11, wordBreak: "break-word" }}>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--accent)" }}>Raw JSON</summary>
        <pre
          style={{
            margin: "8px 0 0",
            padding: 10,
            fontSize: 11,
            overflow: "auto",
            maxHeight: 240,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        >
          {JSON.stringify(meta, null, 2)}
        </pre>
      </details>
    </div>
  );
}
