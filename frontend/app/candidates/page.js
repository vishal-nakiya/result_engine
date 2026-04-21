import AppShell from "../components/AppShell";
import { apiGet } from "../lib/api";
import CandidatesClient from "./CandidatesClient";

export default async function CandidatesPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const page = sp?.page ?? 1;
  const pageSize = sp?.pageSize ?? 50;
  const data = await apiGet(
    `/candidates?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`
  );

  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">Candidate Management</div>
          <div className="topbar-sub">
            Candidates keyed by registrationNo · rollno · state_ut_code_considered · Click any row to view details
          </div>
        </div>
        <div className="topbar-actions"></div>
      </div>

      <CandidatesClient initial={data} />
    </AppShell>
  );
}

