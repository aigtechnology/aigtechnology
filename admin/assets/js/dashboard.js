import { apiRequest } from "./api.js?v=20261107-csrf";
import { shell, stat } from "./common.js";

const content = `<div class="page-heading"><div><p class="eyebrow">Business overview</p><h2>Dashboard</h2></div><div class="filter-bar"><select aria-label="Date range"><option>Last 30 Days</option><option>Today</option><option>Last 7 Days</option><option>This Month</option><option>Previous Month</option></select><button class="button secondary" type="button">Refresh data</button></div></div>
<section class="stats-grid">${stat("Total Flipkart Orders", "—")}${stat("Today's Orders", "—")}${stat("Pending Orders", "—")}${stat("Shipped Orders", "—")}${stat("Delivered Orders", "—")}${stat("Return Requests", "—")}${stat("Total Revenue", "₹ —")}${stat("Net Profit", "₹ —")}</section>
<div class="dashboard-grid"><section class="panel"><h3>Daily sales performance</h3><div class="chart-placeholder">Chart.js visualization will load from authorized API data.</div></section><section class="panel"><h3>Order status distribution</h3><div class="chart-placeholder">No synchronized order data yet.</div></section></div>
<section class="panel"><h3>Recent activity</h3><div class="empty">Connect the backend to display synchronized orders, returns, and settlements.</div></section>`;

try {
  await apiRequest("/auth/session");
  document.body.innerHTML = shell({ active: "dashboard", title: "Dashboard", content });
  document.querySelector("#logout-button").addEventListener("click", async () => { try { await apiRequest("/auth/logout", { method: "POST" }); } finally { location.href = "operations-login.html"; } });
  const settingsPanel = document.createElement("section");
  settingsPanel.className = "panel";
  settingsPanel.innerHTML = `<h3>Dispatch date automation</h3><p class="muted">Customer emails calculate dispatch as this many working days after the order date. Weekends are skipped.</p><form id="dispatch-settings-form" class="filter-bar"><label for="dispatch-working-days">Working days <input id="dispatch-working-days" type="number" min="0" max="30" step="1" required></label><button class="button" type="submit">Save dispatch setting</button></form><p id="dispatch-settings-status" class="muted" role="status"></p>`;
  document.querySelector(".admin-main").append(settingsPanel);
  const input = settingsPanel.querySelector("#dispatch-working-days");
  const status = settingsPanel.querySelector("#dispatch-settings-status");
  try { input.value = (await apiRequest("/admin/dispatch-settings")).working_days; }
  catch (error) { status.textContent = error.message || "Could not load dispatch setting."; }
  settingsPanel.querySelector("#dispatch-settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    try { const result = await apiRequest("/admin/dispatch-settings", { method: "PATCH", body: JSON.stringify({ working_days: Number(input.value) }) }); input.value = result.working_days; status.textContent = "Dispatch setting saved."; }
    catch (error) { status.textContent = error.message || "Could not save dispatch setting."; }
  });
} catch {
  location.href = "operations-login.html";
}
