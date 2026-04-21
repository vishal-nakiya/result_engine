import AppShell from "../components/AppShell";
import { apiGet } from "../lib/api";
import VacancyClient from "./VacancyClient";

export default async function VacancyPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const page = sp?.page ?? 1;
  const pageSize = sp?.pageSize ?? 50;
  const q = sp?.q ?? "";
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("pageSize", String(pageSize));
  if (String(q).trim()) qs.set("q", String(q).trim());

  let data = { page: 1, pageSize: 50, total: 0, rows: [] };
  try {
    data = await apiGet(`/vacancy?${qs.toString()}`);
  } catch {
    // Backend offline / migrations pending
  }

  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">Vacancy</div>
          <div className="topbar-sub">
            Vacancy table CSV · upsert by key column · state_code → states (name from join, not duplicated on each row)
          </div>
        </div>
        <div className="topbar-actions" />
      </div>

      <VacancyClient initial={data} />
    </AppShell>
  );
}
