import AppShell from "../components/AppShell";
import { apiGet } from "../lib/api";

function clsForLevel(level) {
  if (level === "info") return "log-entry log-info";
  if (level === "warn") return "log-entry log-warn";
  if (level === "error") return "log-entry log-err";
  return "log-entry";
}

export default async function LogsPage() {
  const logs = await apiGet("/logs?page=1&pageSize=80");
  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">Logs &amp; Audit</div>
          <div className="topbar-sub">Processing pipeline logs from database</div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost btn-sm">Export</button>
        </div>
      </div>

      <div style={{ padding: 28 }}>
        <div className="log-container" id="log-container">
          {logs.rows.map((l) => (
            <div key={l.id} className={clsForLevel(l.level)}>
              <div className="log-ts">{new Date(l.timestamp).toISOString()}</div>
              <div className="log-level">{String(l.level).toUpperCase()}</div>
              <div className="log-msg">{l.message}</div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

