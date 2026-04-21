import AppShell from "../components/AppShell";
import { apiGet } from "../lib/api";

export default async function DashboardPage() {
  const stats = await apiGet("/dashboard/stats");
  const totalVacancies = stats.totalPosts ?? 0;
  const allocated = stats.allocated ?? 0;
  const left = Math.max(0, totalVacancies - allocated);
  const fillRate = totalVacancies > 0 ? ((allocated / totalVacancies) * 100).toFixed(1) : "0.0";

  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">Dashboard</div>
          <div className="topbar-sub">Last processed: — · Vacancy table: {totalVacancies} slots · 8 forces</div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost btn-sm">↓ Export Report</button>
          <form action={`${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api"}/process/run`} method="post">
            <button className="btn btn-primary btn-sm" type="submit">
              ▶ Run Processing
            </button>
          </form>
        </div>
      </div>

      <div className="page active" id="page-dashboard-inner" style={{ display: "block", overflow: "visible", padding: 28 }}>
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-card-accent" style={{ background: "var(--accent)" }}></div>
            <div className="stat-label">Total Vacancies</div>
            <div className="stat-value">{totalVacancies.toLocaleString("en-IN")}</div>
            <div className="stat-delta">Across 8 forces · 28 states/UTs</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-accent" style={{ background: "var(--green)" }}></div>
            <div className="stat-label">Allocated</div>
            <div className="stat-value">{allocated.toLocaleString("en-IN")}</div>
            <div className={`stat-delta ${Number(fillRate) >= 50 ? "up" : ""}`}>↑ {fillRate}% fill rate</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-accent" style={{ background: "#F59E0B" }}></div>
            <div className="stat-label">Left / Pending</div>
            <div className="stat-value">{left.toLocaleString("en-IN")}</div>
            <div className="stat-delta">{totalVacancies > 0 ? (100 - Number(fillRate)).toFixed(1) : "0.0"}% vacancies unfilled</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-accent" style={{ background: "var(--red)" }}></div>
            <div className="stat-label">Female Vacancies</div>
            <div className="stat-value">—</div>
            <div className="stat-delta down">Male: — · Gender code 1=F, 2=M</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

