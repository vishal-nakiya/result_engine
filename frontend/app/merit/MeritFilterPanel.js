"use client";

const FIELD_OPTIONS = [
  { value: "meritRank", label: "Merit rank", type: "number" },
  { value: "rollNo", label: "Roll no", type: "string" },
  { value: "name", label: "Name", type: "string" },
  { value: "fatherName", label: "Father name", type: "string" },
  { value: "category", label: "Category", type: "enum" },
  { value: "gender", label: "Gender", type: "gender" },
  { value: "dob", label: "DOB", type: "date" },
  { value: "normalizedMarks", label: "Normalized marks", type: "number" },
  { value: "finalMarks", label: "Final marks", type: "number" },
  { value: "marksCbe", label: "CBE marks", type: "number" },
  { value: "nccCert", label: "NCC cert", type: "string" },
  { value: "status", label: "Row status", type: "enum" },
  { value: "isEsm", label: "ESM (boolean)", type: "bool" },
  { value: "domicileState", label: "Domicile state", type: "string" },
  { value: "district", label: "District", type: "string" },
  { value: "ruleQualified", label: "Rule eval pass", type: "bool" },
  { value: "failReasonContains", label: "Fail reason contains", type: "jsonContains" },
];

const OPS_BY_TYPE = {
  number: [
    { value: "eq", label: "=" },
    { value: "ne", label: "≠" },
    { value: "gt", label: ">" },
    { value: "gte", label: "≥" },
    { value: "lt", label: "<" },
    { value: "lte", label: "≤" },
    { value: "between", label: "Between (a,b)" },
    { value: "isNull", label: "Is empty" },
    { value: "isNotNull", label: "Is not empty" },
  ],
  string: [
    { value: "eq", label: "Equals" },
    { value: "ne", label: "Not equals" },
    { value: "contains", label: "Contains" },
    { value: "startsWith", label: "Starts with" },
    { value: "isNull", label: "Is empty" },
    { value: "isNotNull", label: "Is not empty" },
  ],
  enum: [
    { value: "eq", label: "Equals" },
    { value: "ne", label: "Not equals" },
    { value: "in", label: "Any of (comma list)" },
    { value: "isNull", label: "Is empty" },
    { value: "isNotNull", label: "Is not empty" },
  ],
  gender: [
    { value: "eq", label: "Equals (M / F)" },
    { value: "ne", label: "Not equals" },
    { value: "in", label: "Any of (M,F,…)" },
    { value: "isNull", label: "Is empty" },
    { value: "isNotNull", label: "Is not empty" },
  ],
  date: [
    { value: "eq", label: "On date" },
    { value: "ne", label: "Not on date" },
    { value: "gt", label: "After" },
    { value: "gte", label: "On or after" },
    { value: "lt", label: "Before" },
    { value: "lte", label: "On or before" },
    { value: "between", label: "Between (date1,date2)" },
    { value: "isNull", label: "Is empty" },
    { value: "isNotNull", label: "Is not empty" },
  ],
  bool: [
    { value: "eq", label: "Is" },
    { value: "isNull", label: "Is empty" },
    { value: "isNotNull", label: "Is not empty" },
  ],
  jsonContains: [{ value: "contains", label: "Text contains" }],
};

export function emptyMeritFilterGroup() {
  return { op: "and", conditions: [], children: [] };
}

export function meritFilterHasContent(group) {
  if (!group || typeof group !== "object") return false;
  if (Array.isArray(group.conditions) && group.conditions.length > 0) return true;
  if (Array.isArray(group.children)) {
    return group.children.some((ch) => meritFilterHasContent(ch));
  }
  return false;
}

/** Drop nested groups with no conditions (avoids sending invalid empty branches). */
export function pruneMeritFilterGroup(g) {
  if (!g || typeof g !== "object") return emptyMeritFilterGroup();
  const children = (g.children ?? []).map(pruneMeritFilterGroup).filter(meritFilterHasContent);
  return {
    op: g.op === "or" ? "or" : "and",
    conditions: [...(g.conditions ?? [])],
    children,
  };
}

function fieldMeta(field) {
  return FIELD_OPTIONS.find((f) => f.value === field) ?? FIELD_OPTIONS[0];
}

function defaultOpForField(field) {
  const t = fieldMeta(field).type;
  const ops = OPS_BY_TYPE[t] ?? OPS_BY_TYPE.string;
  return ops[0]?.value ?? "eq";
}

export function cloneMeritFilterGroup(g) {
  return JSON.parse(JSON.stringify(g ?? emptyMeritFilterGroup()));
}

function GroupEditor({ group, onChange, depth, disabled }) {
  const conditions = group.conditions ?? [];
  const children = group.children ?? [];

  const setOp = (op) => onChange({ ...group, op });

  const patchCondition = (i, patch) => {
    const next = conditions.map((c, j) => (j === i ? { ...c, ...patch } : c));
    onChange({ ...group, conditions: next });
  };

  const addCondition = () => {
    onChange({
      ...group,
      conditions: [
        ...conditions,
        {
          field: "meritRank",
          op: defaultOpForField("meritRank"),
          value: "",
        },
      ],
    });
  };

  const removeCondition = (i) => {
    onChange({
      ...group,
      conditions: conditions.filter((_, j) => j !== i),
    });
  };

  const addChild = () => {
    if (depth >= 3) return;
    onChange({
      ...group,
      children: [...children, emptyMeritFilterGroup()],
    });
  };

  const removeChild = (i) => {
    onChange({
      ...group,
      children: children.filter((_, j) => j !== i),
    });
  };

  const replaceChild = (i, nextChild) => {
    const nextChildren = children.map((ch, j) => (j === i ? nextChild : ch));
    onChange({ ...group, children: nextChildren });
  };

  return (
    <div
      style={{
        border: depth === 0 ? "1px solid var(--border)" : "1px dashed var(--border)",
        borderRadius: 10,
        padding: depth === 0 ? 12 : 10,
        marginTop: depth === 0 ? 0 : 8,
        background: depth === 0 ? "var(--surface)" : "rgba(0,0,0,0.02)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "var(--ink3)" }}>{depth === 0 ? "Match" : "Subgroup"}</span>
        <select
          className="input"
          style={{ height: 30, fontSize: 12, padding: "0 8px" }}
          value={group.op}
          onChange={(e) => setOp(e.target.value)}
          disabled={disabled}
        >
          <option value="and">All of (AND)</option>
          <option value="or">Any of (OR)</option>
        </select>
      </div>

      {conditions.map((c, i) => {
        const meta = fieldMeta(c.field);
        const ops = OPS_BY_TYPE[meta.type] ?? OPS_BY_TYPE.string;
        const hideValue = c.op === "isNull" || c.op === "isNotNull";
        return (
          <div
            key={`c-${depth}-${i}`}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <select
              className="input"
              style={{ height: 30, fontSize: 12, padding: "0 8px", minWidth: 150 }}
              value={c.field}
              onChange={(e) => {
                const field = e.target.value;
                patchCondition(i, { field, op: defaultOpForField(field), value: "" });
              }}
              disabled={disabled}
            >
              {FIELD_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              className="input"
              style={{ height: 30, fontSize: 12, padding: "0 8px", minWidth: 120 }}
              value={c.op}
              onChange={(e) => patchCondition(i, { op: e.target.value })}
              disabled={disabled}
            >
              {ops.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {!hideValue ? (
              <input
                className="input"
                style={{ height: 30, fontSize: 12, padding: "0 10px", minWidth: 200, flex: "1 1 180px" }}
                placeholder={
                  c.op === "between"
                    ? meta.type === "date"
                      ? "YYYY-MM-DD, YYYY-MM-DD"
                      : "min, max"
                    : c.op === "in"
                      ? "UR, OBC, SC …"
                      : meta.type === "bool"
                        ? "true / false"
                        : meta.type === "date"
                          ? "YYYY-MM-DD"
                          : "Value"
                }
                value={c.value ?? ""}
                onChange={(e) => patchCondition(i, { value: e.target.value })}
                disabled={disabled}
              />
            ) : (
              <span style={{ fontSize: 12, color: "var(--ink4)" }}>—</span>
            )}
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeCondition(i)} disabled={disabled}>
              Remove
            </button>
          </div>
        );
      })}

      {children.map((ch, i) => (
        <div key={`ch-${depth}-${i}`} style={{ marginLeft: depth ? 8 : 0 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeChild(i)} disabled={disabled}>
              Remove group
            </button>
          </div>
          <GroupEditor group={ch} onChange={(next) => replaceChild(i, next)} depth={depth + 1} disabled={disabled} />
        </div>
      ))}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={addCondition} disabled={disabled}>
          + Condition
        </button>
        {depth < 3 ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={addChild} disabled={disabled}>
            + Nested group
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Global filter builder: AND/OR groups, multiple conditions, nested groups.
 */
export default function MeritFilterPanel({ group, onChange, onApply, onClear, disabled, busy }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-header">
        <div>
          <div className="card-title">Global filter</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4 }}>
            Combine conditions with AND/OR. Nested groups support expressions like (A OR B) AND (C). Applied together with the search box and category/gender dropdowns.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" type="button" onClick={onApply} disabled={disabled || busy}>
            Apply filter
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClear} disabled={disabled || busy}>
            Clear
          </button>
        </div>
      </div>
      <div style={{ padding: "0 14px 14px 14px" }}>
        <GroupEditor group={group} onChange={onChange} depth={0} disabled={disabled || busy} />
      </div>
    </div>
  );
}
