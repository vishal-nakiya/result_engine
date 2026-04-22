import AppShell from "../components/AppShell";

const steps = [
  {
    title: "1) Prepare Master Data",
    points: [
      "Open Candidates and upload the master CSV file.",
      "Use States & districts to keep state and district references updated.",
      "Upload vacancy data in Vacancy before running processing.",
    ],
  },
  {
    title: "2) Upload Result Files",
    points: [
      "Open Result Upload and upload each stage file as required.",
      "Wait for upload and parsing to complete before moving to next stage.",
      "If any file has format issues, correct the CSV and re-upload.",
    ],
  },
  {
    title: "3) Validate Rules",
    points: [
      "Go to Validation Rules to review rule values used by the engine.",
      "Confirm category, gender, ESM, and cut-off logic settings.",
      "Save changes only after checking with policy documents.",
    ],
  },
  {
    title: "4) Generate Merit",
    points: [
      "Open Merit List to verify merit ranking and candidate status.",
      "Search and filter to verify category and gender wise records.",
      "Fix data issues at source and re-run if ranking looks incorrect.",
    ],
  },
  {
    title: "5) Run Force Allocation",
    points: [
      "Open Force Allocation and click Run allocation.",
      "Review allocated force/state/district for each candidate.",
      "Use Export CSV to download the final allocation report.",
    ],
  },
];

export default function ManualPage() {
  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">User Manual</div>
          <div className="topbar-sub">Simple step-by-step guide for first-time users</div>
        </div>
      </div>

      <div className="page active" style={{ display: "block", overflow: "visible", padding: 28 }}>
        <div className="alert alert-info mb-16">
          <div className="alert-icon">i</div>
          <div className="alert-body">
            <div className="alert-title">Recommended flow</div>
            <div className="alert-text">
              Follow the order below from data upload to final force allocation. This avoids missing dependencies.
            </div>
          </div>
        </div>

        <div className="grid-2">
          {steps.map((step) => (
            <div className="card" key={step.title}>
              <div className="card-header">
                <div className="card-title">{step.title}</div>
              </div>
              <div className="card-body">
                {step.points.map((p) => (
                  <div className="manual-step-row" key={p}>
                    {p}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
