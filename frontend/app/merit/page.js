import AppShell from "../components/AppShell";
import MeritClient from "./meritClient";

export default function MeritPage() {
  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">Merit List</div>
          <div className="topbar-sub">Run pipeline, then view final marks and merit ranking.</div>
        </div>
      </div>
      <MeritClient />
    </AppShell>
  );
}

