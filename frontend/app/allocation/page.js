import AppShell from "../components/AppShell";
import AllocationClient from "./allocationClient";

export default function AllocationPage() {
  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">Force Allocation</div>
          <div className="topbar-sub">
            View results · use Run allocation on this page to refresh without rerunning the full pipeline.
          </div>
        </div>
        <div className="topbar-actions" />
      </div>
      <AllocationClient />
    </AppShell>
  );
}

