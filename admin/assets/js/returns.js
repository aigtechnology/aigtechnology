import { apiRequest } from "./api.js?v=20261107-csrf";
import { escapeHtml, shell } from "./common.js";

const content = `<div class="page-heading"><div><p class="eyebrow">Flipkart management</p><h2>Returns</h2><p class="muted">Review return requests and inspection status.</p></div><button class="button secondary" id="refresh-returns" type="button">Refresh returns</button></div>
<div class="filter-bar"><input id="return-search" type="search" placeholder="Search return, order, or SKU" aria-label="Search returns"><select id="return-status" aria-label="Filter by return status"><option value="">All statuses</option><option value="requested">Requested</option><option value="received">Received</option><option value="inspected">Inspected</option><option value="completed">Completed</option></select></div>
<section class="panel"><div class="table-wrap"><table><thead><tr><th>Return ID</th><th>Order ID</th><th>Product / SKU</th><th>Date</th><th>Reason</th><th>Status</th><th>Refund</th></tr></thead><tbody id="returns-table"><tr><td colspan="7" class="empty">Loading returns…</td></tr></tbody></table></div></section>`;

document.body.innerHTML = shell({ active: "returns", title: "Returns", content });
const table = document.querySelector("#returns-table");
let returns = [];

function render() {
  const term = document.querySelector("#return-search").value.trim().toLowerCase();
  const status = document.querySelector("#return-status").value;
  const filtered = returns.filter(item =>
    (!status || item.status === status) &&
    (!term || `${item.return_id} ${item.order_id} ${item.sku} ${item.product_name}`.toLowerCase().includes(term))
  );
  table.innerHTML = filtered.length ? filtered.map(item => `<tr><td>${escapeHtml(item.return_id)}</td><td>${escapeHtml(item.order_id)}</td><td>${escapeHtml(item.product_name)}<br><small class="muted">${escapeHtml(item.sku)}</small></td><td>${escapeHtml(item.return_date ? new Date(item.return_date).toLocaleDateString() : "—")}</td><td>${escapeHtml(item.reason || "—")}</td><td><span class="status ${item.status === "completed" || item.status === "inspected" ? "success" : item.status === "requested" ? "danger" : "pending"}">${escapeHtml(item.status)}</span></td><td>₹ ${escapeHtml(item.refund_amount)}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">No returns found.</td></tr>`;
}

async function load() {
  table.innerHTML = `<tr><td colspan="7" class="empty">Loading returns…</td></tr>`;
  try { returns = await apiRequest("/returns"); render(); }
  catch { location.href = "operations-login.html"; }
}

document.querySelector("#return-search").addEventListener("input", render);
document.querySelector("#return-status").addEventListener("change", render);
document.querySelector("#refresh-returns").addEventListener("click", load);
await load();
