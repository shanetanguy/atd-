const TOKEN_KEY = "atd:staffToken";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 401 && token) {
    // Only an authenticated request going stale counts as "session expired" —
    // a 401 on login itself just means the password was wrong.
    setToken(null);
    const err = new Error("Your session has expired. Please sign in again.");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function login(password) {
  const { token } = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  setToken(token);
  return token;
}

export function logout() {
  setToken(null);
}

export function fetchIndex() {
  return request("/reports");
}

export function fetchReport(id) {
  return request(`/reports/${encodeURIComponent(id)}`);
}

export function saveReportApi(report) {
  return request("/reports", { method: "POST", body: JSON.stringify(report) });
}

export async function uploadPhoto(dataUrl) {
  const { url } = await request("/uploads", { method: "POST", body: JSON.stringify({ dataUrl }) });
  return url;
}

export function respondToReport(id, response) {
  return request(`/reports/${encodeURIComponent(id)}/respond`, {
    method: "POST",
    body: JSON.stringify(response),
  });
}
