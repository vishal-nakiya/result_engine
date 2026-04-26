export function apiBase() {
  const raw = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
  const s = String(raw).trim();
  if (!s) return "/api";
  // Normalize trailing slash but preserve protocol form (http://...).
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export async function apiGet(path, init) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function apiPost(path, body, init) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

