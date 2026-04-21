import AppShell from "../components/AppShell";
import { apiGet } from "../lib/api";
import StateDistrictsClient from "./StateDistrictsClient";

export default async function StatesDistrictsPage({ searchParams }) {
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
    data = await apiGet(`/state-districts?${qs.toString()}`);
  } catch {
    // API offline or migration not run — client still allows upload once backend is up
  }

  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">States &amp; districts</div>
          <div className="topbar-sub">State/district master CSV · stored in PostgreSQL · upsert by distId</div>
        </div>
        <div className="topbar-actions" />
      </div>

      <StateDistrictsClient initial={data} />
    </AppShell>
  );
}
