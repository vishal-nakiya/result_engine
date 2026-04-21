export function apiBase() {
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:4000/api";
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

