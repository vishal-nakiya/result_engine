export function apiBase() {
  const raw = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
  const s = String(raw).trim();
  if (!s) return "/api";
  const normalized = s.endsWith("/") ? s.slice(0, -1) : s;

  // On the server, Node's fetch requires absolute URLs.
  // When user config is relative (e.g. "/api"), derive an origin from env.
  const isServer = typeof window === "undefined";
  if (isServer && normalized.startsWith("/")) {
    // Prefer an explicit server-only backend base to avoid relying on self-origin rewrites.
    // Example: "http://140.245.20.98:4500/api"
    const serverApiBase = process.env.API_SERVER_BASE ?? process.env.BACKEND_API_BASE;
    if (serverApiBase && String(serverApiBase).trim()) {
      return String(serverApiBase).trim().replace(/\/+$/, "");
    }

    const explicitOrigin =
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.SITE_URL ??
      process.env.NEXT_PUBLIC_APP_ORIGIN ??
      process.env.APP_ORIGIN;
    const vercelUrl = process.env.VERCEL_URL; // e.g. "my-app.vercel.app"
    const origin = explicitOrigin
      ? String(explicitOrigin).trim().replace(/\/+$/, "")
      : vercelUrl
        ? `https://${String(vercelUrl).trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
        : "http://localhost:3000";
    return `${origin}${normalized}`;
  }

  return normalized;
}

export async function apiGet(path, init) {
  const url = `${apiBase()}${path}`;
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let details = "";
    try {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const j = await res.json();
        details = typeof j?.error?.message === "string" ? j.error.message : JSON.stringify(j);
      } else {
        const t = await res.text();
        details = t.slice(0, 500);
      }
    } catch {
      // ignore
    }
    throw new Error(`API error ${res.status} for ${url}${details ? ` :: ${details}` : ""}`);
  }
  return res.json();
}

export async function apiPost(path, body, init) {
  const url = `${apiBase()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let details = "";
    try {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const j = await res.json();
        details = typeof j?.error?.message === "string" ? j.error.message : JSON.stringify(j);
      } else {
        const t = await res.text();
        details = t.slice(0, 500);
      }
    } catch {
      // ignore
    }
    throw new Error(`API error ${res.status} for ${url}${details ? ` :: ${details}` : ""}`);
  }
  return res.json();
}

