import { apiRequest } from "./api.js?v=20261107-csrf";
import { escapeHtml, shell } from "./common.js?v=20261114-purchases";
import { CSV_TEMPLATE, csvRowsToPurchases, parseCsv } from "./purchase-csv.js?v=20261114-purchases";

document.body.innerHTML = shell({
  active: "purchases",
  title: "Offline Purchases",
  content: `
  <div class="page-heading">
    <div>
      <p class="eyebrow">Purchase verification</p>
      <h2>Offline invoices</h2>
      <p class="muted">GST and non-GST invoices recorded here unlock warranty-linked service requests for the registered mobile number.</p>
    </div>
    <button class="button secondary" id="refresh" type="button">Refresh</button>
  </div>

  <section class="panel">
    <h3>Add a purchase</h3>
    <form id="purchase-form">
      <div class="form-grid">
        <label>Invoice type
          <select name="invoice_type" required>
            <option value="GST">GST invoice</option>
            <option value="NON_GST">Non-GST invoice</option>
          </select>
        </label>
        <label>Invoice number <input name="invoice_number" maxlength="120" required></label>
        <label>Customer name <input name="customer_name" maxlength="120" required></label>
        <label>Registered mobile <input name="mobile" inputmode="numeric" maxlength="10" required placeholder="10-digit number"></label>
        <label>Email (optional) <input name="email" type="email" maxlength="254"></label>
        <label>Purchase date <input name="purchase_date" type="date" required></label>
        <label>Product name <input name="product_name" maxlength="255" required></label>
        <label>Product model <input name="product_model" maxlength="160"></label>
        <label>Serial number <input name="serial_number" maxlength="160"></label>
        <label>Warranty months <input name="warranty_months" type="number" min="0" max="120" value="0"></label>
        <label>Invoice amount (₹) <input name="invoice_amount" type="number" min="0" step="0.01" value="0"></label>
      </div>
      <button class="button" type="submit">Add purchase</button>
      <p id="form-message" class="muted" role="status"></p>
    </form>
  </section>

  <section class="panel">
    <h3>Bulk CSV import</h3>
    <p class="muted">Columns: ${escapeHtml("invoice_type, invoice_number, customer_name, mobile, product_name, product_model, serial_number, purchase_date, warranty_months, invoice_amount")}</p>
    <p><input id="csv-file" type="file" accept=".csv,text/csv"></p>
    <p><button class="button secondary" id="download-template" type="button">Download template</button>
      <button class="button" id="import-csv" type="button" disabled>Import rows</button></p>
    <p id="import-message" class="muted" role="status"></p>
    <div id="import-details"></div>
  </section>

  <section class="panel">
    <div class="filter-bar">
      <input id="search" type="search" placeholder="Search invoice, mobile, customer, product, serial">
      <select id="invoice-type">
        <option value="">All invoice types</option>
        <option value="GST">GST</option>
        <option value="NON_GST">Non-GST</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Invoice</th><th>Customer</th><th>Product</th><th>Serial</th><th>Purchase date</th><th>Warranty</th><th>Amount</th></tr>
        </thead>
        <tbody id="purchase-rows"><tr><td colspan="7" class="empty">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>`
});

const formMessage = document.querySelector("#form-message");
const importMessage = document.querySelector("#import-message");
const importDetails = document.querySelector("#import-details");
const rows = document.querySelector("#purchase-rows");
let pendingPurchases = [];

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

async function load() {
  const params = new URLSearchParams();
  const search = document.querySelector("#search").value.trim();
  const invoiceType = document.querySelector("#invoice-type").value;
  if (search) params.set("search", search);
  if (invoiceType) params.set("invoice_type", invoiceType);
  try {
    const purchases = await apiRequest(`/admin/offline-purchases?${params}`);
    rows.innerHTML = purchases.length
      ? purchases.map(item => `<tr>
          <td><strong>${escapeHtml(item.invoice_number)}</strong><br><small>${escapeHtml(item.invoice_type)}</small></td>
          <td>${escapeHtml(item.customer_name)}<br><small>${escapeHtml(item.mobile)}${item.email ? ` · ${escapeHtml(item.email)}` : ""}</small></td>
          <td>${escapeHtml(item.product_name)}<br><small>${escapeHtml(item.product_model || "")}</small></td>
          <td>${escapeHtml(item.serial_number || "—")}</td>
          <td>${escapeHtml(formatDate(item.purchase_date))}</td>
          <td>${escapeHtml(`${item.warranty_months} mo`)}</td>
          <td>${escapeHtml(currency.format(Number(item.invoice_amount) || 0))}</td>
        </tr>`).join("")
      : `<tr><td colspan="7" class="empty">No offline purchases recorded yet.</td></tr>`;
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      window.location.href = "operations-login.html";
      return;
    }
    rows.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
  }
}

document.querySelector("#logout-button")?.addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "operations-login.html";
  }
});

document.querySelector("#purchase-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const payload = {
    invoice_type: String(data.get("invoice_type") || "GST"),
    invoice_number: String(data.get("invoice_number") || "").trim(),
    customer_name: String(data.get("customer_name") || "").trim(),
    mobile: String(data.get("mobile") || "").replace(/\D/g, "").slice(-10),
    email: String(data.get("email") || "").trim() || null,
    product_name: String(data.get("product_name") || "").trim(),
    product_model: String(data.get("product_model") || "").trim(),
    serial_number: String(data.get("serial_number") || "").trim(),
    purchase_date: String(data.get("purchase_date") || ""),
    warranty_months: Number(data.get("warranty_months") || 0),
    invoice_amount: Number(data.get("invoice_amount") || 0)
  };
  if (!payload.invoice_number || !payload.customer_name || !payload.product_name || !payload.purchase_date) {
    formMessage.textContent = "Invoice number, customer name, purchase date, and product name are required.";
    return;
  }
  if (!/^[6-9]\d{9}$/.test(payload.mobile)) {
    formMessage.textContent = "Enter the 10-digit registered mobile number starting with 6-9.";
    return;
  }
  payload.purchase_date = new Date(`${payload.purchase_date}T00:00:00Z`).toISOString();
  button.disabled = true;
  formMessage.textContent = "Saving…";
  try {
    await apiRequest("/admin/offline-purchases", { method: "POST", body: JSON.stringify(payload) });
    formMessage.textContent = `Saved invoice ${payload.invoice_number}.`;
    form.reset();
    await load();
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#csv-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  const importButton = document.querySelector("#import-csv");
  importDetails.innerHTML = "";
  pendingPurchases = [];
  importButton.disabled = true;
  if (!file) {
    importMessage.textContent = "";
    return;
  }
  const { purchases, errors } = csvRowsToPurchases(parseCsv(await file.text()));
  pendingPurchases = purchases;
  importMessage.textContent = `${purchases.length} valid row(s), ${errors.length} row(s) rejected.`;
  if (errors.length) {
    importDetails.innerHTML = `<ul>${errors.slice(0, 20).map(item => `<li>${escapeHtml(`Row ${item.row}: ${item.reason}`)}</li>`).join("")}</ul>`;
  }
  importButton.disabled = purchases.length === 0;
});

document.querySelector("#import-csv").addEventListener("click", async event => {
  const button = event.currentTarget;
  if (!pendingPurchases.length) return;
  button.disabled = true;
  importMessage.textContent = "Importing…";
  try {
    const result = await apiRequest("/admin/offline-purchases/bulk", {
      method: "POST",
      body: JSON.stringify(pendingPurchases)
    });
    importMessage.textContent = `${result.created} row(s) imported, ${result.failed} row(s) failed.`;
    importDetails.innerHTML = (result.failures || []).length
      ? `<ul>${result.failures.slice(0, 20).map(item => `<li>${escapeHtml(`Row ${item.row} (${item.invoice_number}): ${item.reason}`)}</li>`).join("")}</ul>`
      : "";
    await load();
  } catch (error) {
    importMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#download-template").addEventListener("click", () => {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "offline-purchases-template.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});

document.querySelector("#refresh").addEventListener("click", load);
document.querySelector("#search").addEventListener("input", load);
document.querySelector("#invoice-type").addEventListener("change", load);

await load();
