"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";

export default function AppShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeManual = useCallback(() => {
    setManualOpen(false);
    try {
      localStorage.setItem("resultpro_manual_seen_v1", "1");
    } catch {}
  }, []);

  const openFullManual = useCallback(() => {
    closeManual();
    router.push("/manual");
  }, [closeManual, router]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSidebar]);

  useEffect(() => {
    if (pathname === "/manual") return;
    try {
      const seen = localStorage.getItem("resultpro_manual_seen_v1");
      if (!seen) setManualOpen(true);
    } catch {}
  }, [pathname]);

  return (
    <>
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className={`sidebar-overlay${sidebarOpen ? " show" : ""}`} onClick={closeSidebar} />
      {manualOpen ? (
        <div className="manual-overlay" onClick={closeManual}>
          <div className="manual-modal" onClick={(e) => e.stopPropagation()}>
            <div className="manual-modal-title">Welcome to ResultPro</div>
            <div className="manual-modal-subtitle">Quick steps for first-time users</div>
            <ul className="manual-quick-list">
              <li>Open <strong>Candidates</strong> to upload the candidate master CSV.</li>
              <li>Go to <strong>Result Upload</strong> and upload stage-wise result files.</li>
              <li>Check <strong>Validation Rules</strong> to verify system logic.</li>
              <li>Open <strong>Merit List</strong> to review ranking and cleared candidates.</li>
              <li>Use <strong>Force Allocation</strong> to run allocation and export results.</li>
            </ul>
            <div className="manual-modal-actions">
              <button className="btn btn-ghost btn-sm" type="button" onClick={closeManual}>
                Close guide
              </button>
              <button className="btn btn-primary btn-sm" type="button" onClick={openFullManual}>
                Open full manual
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="main-area">
        <div className="mobile-bar">
          <button className="btn btn-ghost btn-sm sidebar-toggle" onClick={toggleSidebar} type="button" aria-label="Toggle menu">
            ☰
          </button>
        </div>
        <div className="processing-bar hidden" id="proc-bar">
          <div className="spinner"></div>
          <span id="proc-msg">Running result processing pipeline…</span>
          <div className="progress-track">
            <div className="progress-fill" id="proc-fill" style={{ width: "0%" }}></div>
          </div>
          <span id="proc-pct" style={{ fontSize: 12, opacity: 0.8 }}>
            0%
          </span>
        </div>
        {children}
      </div>
      <div className="toast-container" id="toast-container"></div>
    </>
  );
}

