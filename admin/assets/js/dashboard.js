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
} catch {
  location.href = "operations-login.html";
}
