"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "./Sidebar";

export default function AppShell({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSidebar]);

  return (
    <>
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className={`sidebar-overlay${sidebarOpen ? " show" : ""}`} onClick={closeSidebar} />
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

