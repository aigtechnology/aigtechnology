import { apiRequest } from "./api.js?v=20261107-csrf";
import { escapeHtml, shell } from "./common.js";

const onlineView = document.body.dataset.orderView === "razorpay";
const content = `<div class="page-heading"><div><p class="eyebrow">${onlineView ? "Website payments" : "Website &amp; Flipkart"}</p><h2>${onlineView ? "Online Razorpay Orders" : "Orders"}</h2><p class="muted">${onlineView ? "Orders placed on the website and paid through Razorpay." : "Website orders and synchronized marketplace orders."}</p><p id="sync-status" class="muted" role="status"></p></div><div>${onlineView ? "" : '<button class="button" id="sync-orders" type="button">Sync from Flipkart</button> '}<button class="button secondary" id="refresh-orders" type="button">Refresh orders</button></div></div>
<div class="filter-bar"><input id="order-search" type="search" placeholder="Search order or shipment ID" aria-label="Search orders"><select id="order-status" aria-label="Filter by status"><option value="">All statuses</option><option value="pending payment">Pending payment</option><option value="confirmed">Confirmed</option><option value="processing">Processing</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select><select id="payment-status" aria-label="Filter by payment status"><option value="">All payment statuses</option><option>Created</option><option>Pending</option><option>Authorized</option><option>Captured</option><option>Failed</option><option>Refunded</option><option>Partially Refunded</option></select><label>From <input id="date-from" type="date"></label><label>To <input id="date-to" type="date"></label></div>
<p id="orders-status" class="muted" role="status"></p><section class="panel"><div class="table-wrap"><table><thead><tr><th>Order ID</th><th>Source</th><th>Date</th><th>Fulfilment</th><th>Payment status</th><th>Total</th><th></th></tr></thead><tbody id="orders-table"><tr><td colspan="7" class="empty">Loading orders…</td></tr></tbody></table></div></section><section id="order-detail" class="panel" hidden aria-live="polite"></section>`;

document.body.innerHTML = shell({ active: onlineView ? "online-orders" : "orders", title: onlineView ? "Online Razorpay Orders" : "Orders", content });
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
  table.innerHTML = filtered.length ? filtered.map(order => `<tr><td>${escapeHtml(order.order_id)}</td><td>${escapeHtml(order.source === "website" ? "Website" : `Flipkart · ${order.shipment_id || "—"}`)}</td><td>${escapeHtml(order.order_date ? new Date(order.order_date).toLocaleString() : "—")}</td><td><span class="status ${String(order.status).toLowerCase() === "delivered" ? "success" : String(order.status).toLowerCase() === "cancelled" ? "danger" : "pending"}">${escapeHtml(order.status)}</span></td><td>${escapeHtml(order.payment_status || "—")}</td><td>₹ ${escapeHtml(order.total_amount)}</td><td>${order.source === "website" ? `<button class="button secondary" type="button" data-order-detail="${escapeHtml(order.order_id)}">Details</button> <button class="button secondary" type="button" data-order-print="${escapeHtml(order.order_id)}">Print label</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">No orders found.</td></tr>`;
  table.querySelectorAll("[data-order-detail]").forEach(button => button.addEventListener("click", () => loadOrderDetail(button.dataset.orderDetail)));
  table.querySelectorAll("[data-order-print]").forEach(button => button.addEventListener("click", () => printParcelLabel(button.dataset.orderPrint)));
}

async function printParcelLabel(orderId) {
  const popup = window.open("", "_blank", "width=700,height=700");
  if (!popup) { statusMessage.textContent = "Allow pop-ups for this admin page to print the parcel label."; return; }
  popup.document.write("<p style='font-family:Arial;padding:24px'>Loading parcel label…</p>");
  try {
    const order = await apiRequest(`/admin/orders/${encodeURIComponent(orderId)}?include_private=true`);
    const address = order.shipping_address || {};
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><title>Parcel label ${escapeHtml(order.order_id)}</title><style>@page{margin:12mm}body{margin:0;font-family:Arial,sans-serif;color:#000}.label{position:relative;box-sizing:border-box;min-height:240mm;border:2px solid #000;padding:8mm;padding-bottom:48mm}.to{font-size:16pt;font-weight:800;margin-bottom:6mm}.pin{font-size:28pt;font-weight:800;letter-spacing:.05em;margin-bottom:8mm}.name{font-size:20pt;font-weight:800;text-transform:uppercase;margin-bottom:4mm}.mobile{font-size:16pt;font-weight:700;margin-bottom:5mm}.address{font-size:16pt;line-height:1.45}.from{position:absolute;right:8mm;bottom:8mm;width:78mm;font-size:13pt;font-weight:800;line-height:1.35;text-align:right}.from small{font-size:9pt;font-weight:600}</style></head><body><main class="label"><div class="to">TO:</div><div class="pin">PIN CODE: ${escapeHtml(address.postal_code || "")}</div><div class="name">${escapeHtml(order.customer || "")}</div><div class="mobile">Mobile: ${escapeHtml(order.customer_phone || "")}</div><div class="address">${escapeHtml(address.line1 || "")}${address.line2 ? `<br>${escapeHtml(address.line2)}` : ""}<br>${escapeHtml(address.city || "")}, ${escapeHtml(address.state || "")}</div><div class="from">FROM: AIG TECHNOLOGY<br><small>G6, Gayatri Complex, Near Jaymala AMTS Bus Stop, Jaymala Cross Road, Isanpur, Ahmedabad, Gujarat 382443, India<br>+91 8511693405</small></div></main></body></html>`);
    popup.document.close();
    popup.focus();
    popup.setTimeout(() => popup.print(), 200);
  } catch (error) {
    popup.document.body.innerHTML = `<p style="font-family:Arial;padding:24px">${escapeHtml(error.message || "Could not load parcel label.")}</p>`;
  }
}

async function load() {
  table.innerHTML = `<tr><td colspan="7" class="empty">Loading orders…</td></tr>`;
  statusMessage.textContent = "";
  const params = new URLSearchParams();
  if (document.querySelector("#date-from").value) params.set("date_from", new Date(`${document.querySelector("#date-from").value}T00:00:00`).toISOString());
  if (document.querySelector("#date-to").value) params.set("date_to", new Date(`${document.querySelector("#date-to").value}T23:59:59`).toISOString());
  if (document.querySelector("#order-status").value) params.set("status", document.querySelector("#order-status").value);
  if (document.querySelector("#payment-status").value) params.set("payment_status", document.querySelector("#payment-status").value);
  if (onlineView) { params.set("source", "website"); params.set("payment_provider", "razorpay"); }
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
      apiRequest(`/admin/orders/${encodeURIComponent(orderId)}?include_private=true`),
      apiRequest(`/admin/orders/${encodeURIComponent(orderId)}/transactions`)
    ]);
    const address = order.shipping_address || {};
    const chargeSummary = `<div class="price-breakdown"><div><span>Product subtotal</span><strong>₹ ${escapeHtml(order.subtotal || "0.00")}</strong></div><div><span>Packaging &amp; delivery</span><strong>₹ ${escapeHtml(order.delivery_charge || "0.00")}</strong></div><div><span>Final payable</span><strong>₹ ${escapeHtml(order.total_amount || "0.00")}</strong></div></div>`;
    const statuses = ["Order Placed", "Confirmed", "Processing", "Packed", "Shipped", "In Transit", "Out for Delivery", "Delivered", "Delivery Failed", "Returned", "Cancelled"];
    const nextStatus = order.status;
    const statusOptions = statuses.map(status => `<option value="${escapeHtml(status)}" ${status === order.status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("");
    const canRefund = ["Captured", "Partially Refunded"].includes(order.payment_status);
    const canReconcile = order.payment_method === "razorpay" && order.payment_id && ["Pending", "Authorized"].includes(order.payment_status);
    detail.innerHTML = `<h2>Website order ${escapeHtml(order.order_id)}</h2><p><strong>Customer:</strong> ${escapeHtml(order.customer)} · ${escapeHtml(order.customer_email)} · ${escapeHtml(order.customer_phone)}</p><p><strong>Payment:</strong> ${escapeHtml(order.payment_status)} · ${escapeHtml(order.payment_method || "—")} · ${escapeHtml(order.payment_reference || "—")}</p><p><strong>Delivery:</strong> ${escapeHtml(address.line1)} ${escapeHtml(address.line2 || "")}, ${escapeHtml(address.city)}, ${escapeHtml(address.state)} ${escapeHtml(address.postal_code)}</p>${canReconcile ? `<button class="button secondary" id="reconcile-payment" type="button">Reconcile with Razorpay</button>` : ""}${nextStatus && ["Captured", "Partially Refunded", "Refunded"].includes(order.payment_status) ? `<form id="fulfillment-form" class="filter-bar"><label>Fulfilment status<select name="status"><option value="${escapeHtml(nextStatus)}">${escapeHtml(nextStatus)}</option></select></label><button class="button" type="submit">Update status</button></form>` : ""}${canRefund ? `<button class="button secondary" id="issue-refund" type="button">Issue refund</button>` : ""}<p id="order-action-status" role="status"></p><h3>Products</h3><div class="table-wrap"><table><thead><tr><th>Product / SKU</th><th>Quantity</th><th>Unit price</th><th>Subtotal</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${escapeHtml(item.name)}<br><small>${escapeHtml(item.sku)}</small></td><td>${escapeHtml(item.quantity)}</td><td>₹ ${escapeHtml(item.unit_price)}</td><td>₹ ${escapeHtml(item.subtotal)}</td></tr>`).join("")}</tbody></table></div><h3>Payment and refund history</h3><div class="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Reference</th><th>Amount</th><th>Date</th></tr></thead><tbody>${transactions.map(item => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.provider_reference || "—")}</td><td>${escapeHtml(item.amount || "—")}</td><td>${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : "—")}</td></tr>`).join("") || `<tr><td colspan="5">No payment events yet.</td></tr>`}</tbody></table></div>`;
    detail.innerHTML = `<h2>Website order ${escapeHtml(order.order_id)}</h2><p><strong>Payment:</strong> ${escapeHtml(order.payment_status)} · ${escapeHtml(order.payment_method || "—")}</p><p>Customer contact, delivery address, and provider references are not exposed in this operations view.</p>${canReconcile ? `<button class="button secondary" id="reconcile-payment" type="button">Reconcile with Razorpay</button>` : ""}${nextStatus && ["Captured", "Partially Refunded", "Refunded"].includes(order.payment_status) ? `<form id="fulfillment-form" class="filter-bar"><label>Fulfilment status<select name="status"><option value="${escapeHtml(nextStatus)}">${escapeHtml(nextStatus)}</option></select></label><button class="button" type="submit">Update status</button></form>` : ""}${canRefund ? `<button class="button secondary" id="issue-refund" type="button">Issue refund</button>` : ""}<p id="order-action-status" role="status"></p><h3>Products</h3><div class="table-wrap"><table><thead><tr><th>Product / SKU</th><th>Quantity</th><th>Unit price</th><th>Subtotal</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${escapeHtml(item.name)}<br><small>${escapeHtml(item.sku)}</small></td><td>${escapeHtml(item.quantity)}</td><td>₹ ${escapeHtml(item.unit_price)}</td><td>₹ ${escapeHtml(item.subtotal)}</td></tr>`).join("")}</tbody></table></div><h3>Payment and refund history</h3><div class="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead><tbody>${transactions.map(item => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.status)}</td><td>₹ ${escapeHtml(item.amount || "—")}</td><td>${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : "—")}</td></tr>`).join("") || `<tr><td colspan="4">No payment events yet.</td></tr>`}</tbody></table></div>`;
    detail.insertAdjacentHTML("afterbegin", `<div class="parcel-label" aria-label="Parcel label"><div class="parcel-label__pincode">PIN CODE: ${escapeHtml(address.postal_code || "")}</div><div class="parcel-label__name">${escapeHtml(order.customer || "")}</div><div class="parcel-label__address">${escapeHtml(address.line1 || "")}${address.line2 ? `<br>${escapeHtml(address.line2)}` : ""}<br>${escapeHtml(address.city || "")}, ${escapeHtml(address.state || "")}</div></div><div class="panel"><p><strong>Customer:</strong> ${escapeHtml(order.customer)} · ${escapeHtml(order.customer_email)} · ${escapeHtml(order.customer_phone)}</p><p><strong>Address:</strong> ${escapeHtml(address.line1)} ${escapeHtml(address.line2 || "")}, ${escapeHtml(address.city)}, ${escapeHtml(address.state)} ${escapeHtml(address.postal_code)}</p><p><a class="button secondary" href="tel:${escapeHtml(order.customer_phone)}">Call customer</a> <a class="button secondary" href="https://wa.me/91${escapeHtml(order.customer_phone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a> <button class="button secondary" id="print-order" type="button">Print parcel label</button></p><h3>Status history</h3><ul>${(order.status_history || []).map(item => `<li>${escapeHtml(item.new_status)} — ${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : "")}</li>`).join("") || "<li>No status history.</li>"}</ul></div>`);
    detail.insertAdjacentHTML("afterbegin", `<div class="panel"><p><strong>Detected delivery state:</strong> ${escapeHtml(address.delivery_state || address.state || "—")} · <strong>PIN:</strong> ${escapeHtml(address.postal_code || "—")}</p>${chargeSummary}</div>`);
    detail.querySelector("#print-order")?.addEventListener("click", () => printParcelLabel(order.order_id));
    detail.insertAdjacentHTML("afterbegin", `<div class="panel dispatch-panel"><h3>Dispatch notification</h3><p><strong>Expected dispatch date:</strong> ${escapeHtml(order.dispatch_date || "To be confirmed")}</p><form id="dispatch-form" class="filter-bar"><label>Carrier <input name="carrier" maxlength="120" value="${escapeHtml(order.carrier || "")}" placeholder="Courier name"></label><label>Tracking ID <input name="tracking_number" maxlength="160" required value="${escapeHtml(order.tracking_number || "")}" placeholder="Tracking number"></label><button class="button" type="submit">Save tracking &amp; send dispatch email</button></form><p id="dispatch-action-status" role="status"></p></div>`);
    const fulfillmentSelect = detail.querySelector("#fulfillment-form select");
    if (fulfillmentSelect) fulfillmentSelect.insertAdjacentHTML("beforeend", statusOptions);
    const dispatchForm = detail.querySelector("#dispatch-form");
    if (dispatchForm && !dispatchForm.elements.tracking_url) {
      dispatchForm.insertAdjacentHTML("afterbegin", `<label>Estimated delivery <input name="estimated_delivery_date" type="date" value="${escapeHtml((order.estimated_delivery_date || "").slice(0, 10))}"></label><label>Tracking URL <input name="tracking_url" type="url" maxlength="2048" value="${escapeHtml(order.tracking_url || "")}" placeholder="https://courier.example/track"></label>`);
    }
    detail.querySelector("#dispatch-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const message = detail.querySelector("#dispatch-action-status");
      button.disabled = true;
      try {
        const result = await apiRequest(`/admin/orders/${encodeURIComponent(order.order_id)}/dispatch`, {
          method: "POST",
          body: JSON.stringify({ carrier: form.elements.carrier.value.trim() || null, tracking_number: form.elements.tracking_number.value.trim(), tracking_url: form.elements.tracking_url?.value.trim() || null, estimated_delivery_date: form.elements.estimated_delivery_date?.value ? `${form.elements.estimated_delivery_date.value}T00:00:00` : null })
        });
        message.textContent = result.email_sent ? "Tracking saved and dispatch email sent." : "Tracking saved, but the dispatch email was not sent. Check Mailjet configuration.";
        await load();
        await loadOrderDetail(order.order_id);
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
      }
    });
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
document.querySelector("#sync-orders")?.addEventListener("click", async () => {
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
