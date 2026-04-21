"use client";

import { useRef } from "react";
import AppShell from "../components/AppShell";
import RulesClient from "./RulesClient";

export default function RulesPageClient() {
  const ref = useRef(null);

  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">Validation Rules Engine</div>
          <div className="topbar-sub">Fully editable · JSON-driven · Category-aware · Export to PDF &amp; Word</div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => ref.current?.switchTab("visual")}>
            Visual Editor
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => ref.current?.switchTab("json")}>
            JSON View
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => ref.current?.switchTab("missing")}>
            ⚠ Missing Rules
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => ref.current?.exportWord?.()}>
            ⬇ Export Word
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => ref.current?.exportPdf?.()}>
            ⬇ Export PDF
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => ref.current?.saveAll?.()}>
            Save &amp; Apply
          </button>
        </div>
      </div>

      <RulesClient ref={ref} />
    </AppShell>
  );
}

