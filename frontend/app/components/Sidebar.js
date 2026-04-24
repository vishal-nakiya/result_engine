"use client";

import { usePathname, useRouter } from "next/navigation";

function NavItem({ href, current, onClick, children }) {
  return (
    <div className={`nav-item${current ? " active" : ""}`} onClick={onClick} role="link" tabIndex={0}>
      {children}
    </div>
  );
}

export default function Sidebar({ open = false, onClose = () => {} } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const is = (p) => pathname === p;

  const go = (p) => {
    router.push(p);
    onClose();
  };

  return (
    <nav className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="brand-name">BEL Result Engine</div>
        </div>
        {/* <div className="brand-sub">SSC CAPFs (GD) · Result System</div> */}
        <button className="sidebar-close" type="button" onClick={onClose} aria-label="Close menu">
          ✕
        </button>
      </div>

      <div className="nav-section-label">Data Management</div>
      <NavItem href="/candidates" current={is("/candidates")} onClick={() => go("/candidates")}>
        <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="6" r="3" />
          <path d="M2 17c0-3.3 2.7-6 6-6" />
          <rect x="12" y="12" width="7" height="5" rx="1.5" />
          <path d="M15.5 12V10.5a1.5 1.5 0 00-3 0V12" />
        </svg>
        Candidates
        {/* <span className="nav-badge">2.4L</span> */}
      </NavItem>
      <NavItem href="/upload" current={is("/upload")} onClick={() => go("/upload")}>
        <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 13V4M6 7l4-4 4 4" />
          <path d="M4 16h12" />
        </svg>
        Result Upload
        {/* <span className="nav-badge alert">82</span> */}
      </NavItem>
      <NavItem href="/states-districts" current={is("/states-districts")} onClick={() => go("/states-districts")}>
        <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 7l7-4 7 4M3 7v6l7 4 7-4V7M3 7l7 4 7-4M10 11v6" />
        </svg>
        States &amp; districts
      </NavItem>
      <NavItem href="/vacancy" current={is("/vacancy")} onClick={() => go("/vacancy")}>
        <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="5" width="14" height="11" rx="1.5" />
          <path d="M7 8h6M7 11h4M7 14h5" />
        </svg>
        Vacancy
      </NavItem>

      <div className="nav-section-label">Processing</div>
      <NavItem href="/rules" current={is("/rules")} onClick={() => go("/rules")}>
        <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 2v4M10 14v4M4.22 4.22l2.83 2.83M12.95 12.95l2.83 2.83M2 10h4M14 10h4M4.22 15.78l2.83-2.83M12.95 7.05l2.83-2.83" />
        </svg>
        Validation Rules
      </NavItem>
      <NavItem href="/merit" current={is("/merit")} onClick={() => go("/merit")}>
        <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 17h4M10 13V7" />
          <circle cx="10" cy="5" r="2" />
          <path d="M6 13h8" />
        </svg>
        Merit List
      </NavItem>
      <NavItem href="/allocation" current={is("/allocation")} onClick={() => go("/allocation")}>
        <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="4" width="16" height="12" rx="2" />
          <path d="M8 4v12M14 4v12M2 10h16" />
        </svg>
        Force Allocation
      </NavItem>

      <div className="nav-section-label">System</div>
      <NavItem href="/manual" current={is("/manual")} onClick={() => go("/manual")}>
        <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 3.5h9.5a2.5 2.5 0 0 1 2.5 2.5v10.5H6.5A2.5 2.5 0 0 0 4 19V3.5Z" />
          <path d="M6.5 16.5H16" />
          <path d="M7 7h6M7 10h6" />
        </svg>
        User Manual
      </NavItem>
      <NavItem href="/logs" current={is("/logs")} onClick={() => go("/logs")}>
        <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <path d="M7 7h6M7 10h6M7 13h4" />
        </svg>
        Logs &amp; Audit
      </NavItem>

    </nav>
  );
}

