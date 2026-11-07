import { ADMIN_CONFIG } from "./config.js?v=20261107-api-config";

export async function apiRequest(path, options = {}) {
  if (!ADMIN_CONFIG.API_BASE_URL) throw new Error("The operations API URL has not been configured.");
  const method = String(options.method || "GET").toUpperCase();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && path !== "/auth/login") {
    let csrfToken = sessionStorage.getItem("aig_csrf_token");
    if (!csrfToken) {
      const sessionResponse = await fetch(`${ADMIN_CONFIG.API_BASE_URL}/auth/session`, { credentials: "include" });
      if (sessionResponse.ok) {
        const session = await sessionResponse.json();
        csrfToken = session.csrf_token;
        if (csrfToken) sessionStorage.setItem("aig_csrf_token", csrfToken);
      }
    }
    if (!csrfToken) throw new Error("Your admin session needs to be refreshed. Sign in again.");
    headers["X-CSRF-Token"] = csrfToken;
  }
  const response = await fetch(`${ADMIN_CONFIG.API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.detail || `API request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) {
    if (path === "/auth/logout") sessionStorage.removeItem("aig_csrf_token");
    return null;
  }
  const payload = await response.json();
  if (payload?.csrf_token) sessionStorage.setItem("aig_csrf_token", payload.csrf_token);
  return payload;
}
