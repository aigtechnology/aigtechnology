import { apiRequest } from "./api.js?v=20261107-csrf";

document.querySelector("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const status = document.querySelector("#login-status");
  const form = new FormData(event.currentTarget);
  status.textContent = "Signing in…";
  status.className = "muted";
  try {
    sessionStorage.removeItem("aig_csrf_token");
    await apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    location.href = "operations.html";
  } catch { status.textContent = "Unable to sign in. Check your credentials or try again later."; status.className = "error"; }
});
