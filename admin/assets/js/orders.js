import { apiRequest } from "./api.js?v=20261107-csrf";
import { escapeHtml, shell } from "./common.js";

const content = `<div class="page-heading"><div><p class="eyebrow">Website &amp; Flipkart</p><h2>Orders</h2><p class="muted">Website orders and synchronized marketplace orders.</p><p id="sync-status" class="muted" role="status"></p></div><div><button class="button" id="sync-orders" type="button">Sync from Flipkart</button> <button class="button secondary" id="refresh-orders" type="button">Refresh orders</button></div></div>
<div class="filter-bar"><input id="order-search" type="search" placeholder="Search order or shipment ID" aria-label="Search orders"><select id="order-status" aria-label="Filter by status"><option value="">All statuses</option><option value="pending payment">Pending payment</option><option value="confirmed">Confirmed</option><option value="processing">Processing</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select><select id="payment-status" aria-label="Filter by payment status"><option value="">All payment statuses</option><option>Created</option><option>Pending</option><option>Authorized</option><option>Captured</option><option>Failed</option><option>Refunded</option><option>Partially Refunded</option></select><label>From <input id="date-from" type="date"></label><label>To <input id="date-to" type="date"></label></div>
<p id="orders-status" class="muted" role="status"></p><section class="panel"><div class="table-wrap"><table><thead><tr><th>Order ID</th><th>Source</th><th>Date</th><th>Fulfilment</th><th>Payment status</th><th>Total</th><th></th></tr></thead><tbody id="orders-table"><tr><td colspan="7" class="empty">Loading orders…</td></tr></tbody></table></div></section><section id="order-detail" class="panel" hidden aria-live="polite"></section>`;

document.body.innerHTML = shell({ active: "orders", title: "Orders", content });
const table = document.querySelector("#orders-table");
let orders = [];
const statusMessage = document.querySelector("#orders-status");

function render() {
  const term = document.querySelector("#order-search").value.trim().toLowerCase();
  const status = document.querySelector("#order-status").value;
  const paymentStatus = document.querySelector("#payment-status").value;
  const filtered = orders.filter(order =>
    (!status || String(order.status).toLowerCase() === status.toLowerCase()) &&
    (!paymentStatus || String(order.payment_status || "").toLowerCase() === paymentStatus.toLowerCase()) &&
    (!term || `${order.order_id} ${order.shipment_id || ""}`.toLowerCase().includes(term))
  );
  table.innerHTML = filtered.length ? filtered.map(order => `<tr><td>${escapeHtml(order.order_id)}</td><td>${escapeHtml(order.source === "website" ? "Website" : `Flipkart · ${order.shipment_id || "—"}`)}</td><td>${escapeHtml(order.order_date ? new Date(order.order_date).toLocaleString() : "—")}</td><td><span class="status ${String(order.status).toLowerCase() === "delivered" ? "success" : String(order.status).toLowerCase() === "cancelled" ? "danger" : "pending"}">${escapeHtml(order.status)}</span></td><td>${escapeHtml(order.payment_status || "—")}</td><td>₹ ${escapeHtml(order.total_amount)}</td><td>${order.source === "website" ? `<button class="button secondary" type="button" data-order-detail="${escapeHtml(order.order_id)}">Details</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">No orders found.</td></tr>`;
  table.querySelectorAll("[data-order-detail]").forEach(button => button.addEventListener("click", () => loadOrderDetail(button.dataset.orderDetail)));
}

async function load() {
  table.innerHTML = `<tr><td colspan="7" class="empty">Loading orders…</td></tr>`;
  statusMessage.textContent = "";
  const params = new URLSearchParams();
  if (document.querySelector("#date-from").value) params.set("date_from", new Date(`${document.querySelector("#date-from").value}T00:00:00`).toISOString());
  if (document.querySelector("#date-to").value) params.set("date_to", new Date(`${document.querySelector("#date-to").value}T23:59:59`).toISOString());
  if (document.querySelector("#order-status").value) params.set("status", document.querySelector("#order-status").value);
  if (document.querySelector("#payment-status").value) params.set("payment_status", document.querySelector("#payment-status").value);
  try { orders = await apiRequest(`/orders${params.size ? `?${params}` : ""}`); render(); }
  catch (error) {
    if (error.status === 401) location.href = "operations-login.html";
    else statusMessage.textContent = error.message || "Could not load orders.";
  }
}

async function loadOrderDetail(orderId) {
  const detail = document.querySelector("#order-detail");
  detail.hidden = false;
  detail.innerHTML = `<p>Loading order details…</p>`;
  try {
    const [order, transactions] = await Promise.all([
      apiRequest(`/admin/orders/${encodeURIComponent(orderId)}`),
      apiRequest(`/admin/orders/${encodeURIComponent(orderId)}/transactions`)
    ]);
    const address = order.shipping_address || {};
    const nextStatus = { Confirmed: "Processing", Processing: "Shipped", Shipped: "Delivered" }[order.status];
    const canRefund = ["Captured", "Partially Refunded"].includes(order.payment_status);
    const canReconcile = order.payment_method === "razorpay" && order.payment_id && ["Pending", "Authorized"].includes(order.payment_status);
    detail.innerHTML = `<h2>Website order ${escapeHtml(order.order_id)}</h2><p><strong>Customer:</strong> ${escapeHtml(order.customer)} · ${escapeHtml(order.customer_email)} · ${escapeHtml(order.customer_phone)}</p><p><strong>Payment:</strong> ${escapeHtml(order.payment_status)} · ${escapeHtml(order.payment_method || "—")} · ${escapeHtml(order.payment_reference || "—")}</p><p><strong>Delivery:</strong> ${escapeHtml(address.line1)} ${escapeHtml(address.line2 || "")}, ${escapeHtml(address.city)}, ${escapeHtml(address.state)} ${escapeHtml(address.postal_code)}</p>${canReconcile ? `<button class="button secondary" id="reconcile-payment" type="button">Reconcile with Razorpay</button>` : ""}${nextStatus && ["Captured", "Partially Refunded", "Refunded"].includes(order.payment_status) ? `<form id="fulfillment-form" class="filter-bar"><label>Fulfilment status<select name="status"><option value="${escapeHtml(nextStatus)}">${escapeHtml(nextStatus)}</option></select></label><button class="button" type="submit">Update status</button></form>` : ""}${canRefund ? `<button class="button secondary" id="issue-refund" type="button">Issue refund</button>` : ""}<p id="order-action-status" role="status"></p><h3>Products</h3><div class="table-wrap"><table><thead><tr><th>Product / SKU</th><th>Quantity</th><th>Unit price</th><th>Subtotal</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${escapeHtml(item.name)}<br><small>${escapeHtml(item.sku)}</small></td><td>${escapeHtml(item.quantity)}</td><td>₹ ${escapeHtml(item.unit_price)}</td><td>₹ ${escapeHtml(item.subtotal)}</td></tr>`).join("")}</tbody></table></div><h3>Payment and refund history</h3><div class="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Reference</th><th>Amount</th><th>Date</th></tr></thead><tbody>${transactions.map(item => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.provider_reference || "—")}</td><td>${escapeHtml(item.amount || "—")}</td><td>${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : "—")}</td></tr>`).join("") || `<tr><td colspan="5">No payment events yet.</td></tr>`}</tbody></table></div>`;
    detail.innerHTML = `<h2>Website order ${escapeHtml(order.order_id)}</h2><p><strong>Payment:</strong> ${escapeHtml(order.payment_status)} · ${escapeHtml(order.payment_method || "—")}</p><p>Customer contact, delivery address, and provider references are not exposed in this operations view.</p>${canReconcile ? `<button class="button secondary" id="reconcile-payment" type="button">Reconcile with Razorpay</button>` : ""}${nextStatus && ["Captured", "Partially Refunded", "Refunded"].includes(order.payment_status) ? `<form id="fulfillment-form" class="filter-bar"><label>Fulfilment status<select name="status"><option value="${escapeHtml(nextStatus)}">${escapeHtml(nextStatus)}</option></select></label><button class="button" type="submit">Update status</button></form>` : ""}${canRefund ? `<button class="button secondary" id="issue-refund" type="button">Issue refund</button>` : ""}<p id="order-action-status" role="status"></p><h3>Products</h3><div class="table-wrap"><table><thead><tr><th>Product / SKU</th><th>Quantity</th><th>Unit price</th><th>Subtotal</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${escapeHtml(item.name)}<br><small>${escapeHtml(item.sku)}</small></td><td>${escapeHtml(item.quantity)}</td><td>₹ ${escapeHtml(item.unit_price)}</td><td>₹ ${escapeHtml(item.subtotal)}</td></tr>`).join("")}</tbody></table></div><h3>Payment and refund history</h3><div class="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead><tbody>${transactions.map(item => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.status)}</td><td>₹ ${escapeHtml(item.amount || "—")}</td><td>${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : "—")}</td></tr>`).join("") || `<tr><td colspan="4">No payment events yet.</td></tr>`}</tbody></table></div>`;
    const actionStatus = detail.querySelector("#order-action-status");
    detail.querySelector("#reconcile-payment")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await apiRequest(`/admin/payments/${encodeURIComponent(order.payment_id)}/reconcile`, { method: "POST" });
        await load();
        await loadOrderDetail(order.order_id);
      } catch (error) {
        actionStatus.textContent = error.message;
        button.disabled = false;
      }
    });
    detail.querySelector("#fulfillment-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("button");
      button.disabled = true;
      try {
        await apiRequest(`/admin/orders/${encodeURIComponent(order.order_id)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: event.currentTarget.elements.status.value })
        });
        await load();
        await loadOrderDetail(order.order_id);
      } catch (error) { actionStatus.textContent = error.message; }
      finally { button.disabled = false; }
    });
    detail.querySelector("#issue-refund")?.addEventListener("click", async event => {
      const amount = prompt(`Refund amount in INR (maximum captured total ₹ ${order.total_amount}):`);
      if (amount === null) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const refund = await apiRequest(`/payments/${encodeURIComponent(order.payment_id)}/refund`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ amount: Number(amount) })
        });
        actionStatus.textContent = `Refund ${refund.status.toLowerCase()}: ₹ ${refund.amount}.`;
        await load();
        await loadOrderDetail(order.order_id);
      } catch (error) { actionStatus.textContent = error.message; }
      finally { button.disabled = false; }
    });
  } catch (error) { detail.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`; }
}

document.querySelector("#order-search").addEventListener("input", render);
document.querySelector("#order-status").addEventListener("change", load);
document.querySelector("#payment-status").addEventListener("change", load);
document.querySelector("#date-from").addEventListener("change", load);
document.querySelector("#date-to").addEventListener("change", load);
document.querySelector("#refresh-orders").addEventListener("click", load);
document.querySelector("#sync-orders").addEventListener("click", async () => {
  const button = document.querySelector("#sync-orders");
  const status = document.querySelector("#sync-status");
  button.disabled = true;
  status.textContent = "Checking Flipkart connection…";
  try {
    const result = await apiRequest("/sync/flipkart/check", { method: "POST" });
    status.textContent = result.status === "success"
      ? `Sync check completed. ${result.records_seen || 0} shipment records received.`
      : (result.message || "Flipkart sync did not complete.");
    await load();
  } catch (error) {
    status.textContent = error.message || "Flipkart sync failed.";
  } finally { button.disabled = false; }
});
await load();
