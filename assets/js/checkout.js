import { backendRequest } from "./backend-api.js?v=20261107-api-config";
import { clearCart, readCart, removeCartItem, updateCartItem } from "./cart-store.js";

const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const money = value => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2
}).format(Number(value));
const orderKey = orderId => `aigOrderAccess:${orderId}`;

function cartLines(cart, pricedItems = []) {
  const prices = new Map(pricedItems.map(item => [item.sku, item]));
  return cart.map(item => {
    const price = prices.get(item.sku);
    return `<article class="cart-line">
      ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy">` : `<span class="product-placeholder" aria-hidden="true">Image unavailable</span>`}
      <div class="cart-line__details"><h3>${escapeHtml(price?.name || item.name || item.sku)}</h3><p>SKU: ${escapeHtml(item.sku)}</p>
        ${price ? `<p>${money(price.unit_price)} each · Subtotal ${money(price.subtotal)}</p>` : `<p>Price and availability will be checked at checkout.</p>`}
      </div>
      <label class="cart-quantity">Quantity
        <input type="number" min="1" max="10" value="${item.quantity}" data-cart-quantity="${escapeHtml(item.sku)}" aria-label="Quantity for ${escapeHtml(price?.name || item.name || item.sku)}">
      </label>
      <button class="button button-secondary button-small" type="button" data-remove-cart="${escapeHtml(item.sku)}">Remove</button>
    </article>`;
  }).join("");
}

function renderSummary(target, result) {
  target.innerHTML = `<div class="price-breakdown">
    <div><span>Subtotal</span><strong>${money(result.subtotal)}</strong></div>
    <div><span>Delivery</span><strong>${money(result.delivery_charge)}</strong></div>
    <div><span>Discount</span><strong>−${money(result.discount)}</strong></div>
    <div class="price-breakdown__total"><span>Total payable</span><strong>${money(result.total)}</strong></div>
  </div>`;
}

async function validateCart(cart) {
  if (!cart.length) throw new Error("Your cart is empty.");
  return backendRequest("/checkout/validate", {
    method: "POST",
    body: JSON.stringify({ items: cart.map(({ sku, quantity }) => ({ sku, quantity })) })
  });
}

async function initCartPage() {
  const items = byId("cart-items");
  if (!items) return;
  const summary = byId("cart-summary");
  const status = byId("cart-status");
  const checkout = byId("cart-checkout");
  const render = async () => {
    let cart;
    try { cart = readCart(); }
    catch (error) {
      status.textContent = error.message;
      items.innerHTML = "";
      checkout.hidden = true;
      return;
    }
    if (!cart.length) {
      items.innerHTML = `<div class="empty-state">Your cart is empty. <a href="products.html">Browse products</a>.</div>`;
      summary.innerHTML = `<p>No items yet.</p>`;
      checkout.hidden = true;
      status.textContent = "";
      return;
    }
    checkout.hidden = false;
    items.innerHTML = cartLines(cart);
    try {
      const result = await validateCart(cart);
      items.innerHTML = cartLines(cart, result.items);
      renderSummary(summary, result);
      status.textContent = "";
    } catch (error) {
      summary.innerHTML = `<p>Current totals are unavailable until the server confirms product price and stock.</p>`;
      status.textContent = error.message;
    }
  };
  items.addEventListener("change", async event => {
    const input = event.target.closest("[data-cart-quantity]");
    if (!input) return;
    try { updateCartItem(input.dataset.cartQuantity, input.value); await render(); }
    catch (error) { status.textContent = error.message; }
  });
  items.addEventListener("click", async event => {
    const button = event.target.closest("[data-remove-cart]");
    if (!button) return;
    try {
      removeCartItem(button.dataset.removeCart);
      await render();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  window.addEventListener("aig-cart-updated", render);
  await render();
}

function addressFrom(form, prefix = "") {
  const value = name => form.elements[`${prefix}${name}`].value.trim();
  return {
    line1: value("line1"),
    line2: value("line2"),
    city: value("city"),
    state: value("state"),
    postal_code: value("postal_code")
  };
}

function storeOrderAccess(order) {
  sessionStorage.setItem(orderKey(order.order_id), order.lookup_token);
  sessionStorage.setItem("aigLatestWebsiteOrder", order.order_id);
}

function showPaymentMessage(panel, message, error = false) {
  panel.hidden = false;
  panel.innerHTML = `<div class="notice${error ? " notice-warning" : ""}" role="status">${escapeHtml(message)}</div>`;
}

function redirectToOrder(orderId) {
  location.href = `order-confirmation.html?id=${encodeURIComponent(orderId)}`;
}

function showFailedPayment(order, panel) {
  panel.hidden = false;
  panel.innerHTML = `<div class="notice notice-warning" role="status"><strong>Payment was not completed.</strong> No payment was captured. You can try placing a new order.</div><button class="button button-secondary" id="retry-order" type="button">Return to checkout</button>`;
  byId("retry-order").addEventListener("click", () => {
    panel.hidden = true;
    byId("checkout-form").hidden = false;
    byId("place-order").disabled = false;
    sessionStorage.removeItem("aigCheckoutIdempotencyKey");
    sessionStorage.removeItem(orderKey(order.order_id));
  });
}

async function verifyPayment(order, body, panel) {
  const lookupToken = sessionStorage.getItem(orderKey(order.order_id));
  if (!lookupToken) throw new Error("This order's secure access token is missing.");
  const status = await backendRequest("/payments/verify", {
    method: "POST",
    headers: { "X-Order-Access-Token": lookupToken },
    body: JSON.stringify({ order_id: order.order_id, payment_id: order.payment_id, ...body })
  });
  if (status.payment_status === "Captured" && status.order_status === "Confirmed") {
    clearCart();
    redirectToOrder(order.order_id);
    return;
  }
  if (status.payment_status === "Failed") {
    showFailedPayment(order, panel);
    return;
  }
  if (["Refunded", "Partially Refunded"].includes(status.payment_status) ||
      (status.order_status === "Cancelled" && status.payment_status === "Captured")) {
    showPaymentMessage(panel, `Payment status: ${status.payment_status}. Check the order and refund status on the order page.`);
    const details = document.createElement("a");
    details.className = "button button-secondary";
    details.href = `order-confirmation.html?id=${encodeURIComponent(order.order_id)}`;
    details.textContent = "View order status";
    panel.append(details);
    return;
  }
  showPaymentMessage(panel, "Payment is not yet confirmed. You can safely check the status again; do not retry payment unless the provider confirms it failed.");
  const statusButton = document.createElement("button");
  statusButton.className = "button button-secondary";
  statusButton.type = "button";
  statusButton.textContent = "Check payment status";
  statusButton.addEventListener("click", () => checkPaymentStatus(order, panel));
  panel.append(statusButton);
}

async function checkPaymentStatus(order, panel) {
  const lookupToken = sessionStorage.getItem(orderKey(order.order_id));
  const response = await backendRequest(`/payments/${encodeURIComponent(order.payment_id)}/status`, {
    headers: { "X-Order-Access-Token": lookupToken }
  });
  if (response.payment_status === "Captured" && response.order_status === "Confirmed") {
    clearCart();
    redirectToOrder(order.order_id);
  } else if (response.payment_status === "Failed") {
    showFailedPayment(order, panel);
  } else if (["Refunded", "Partially Refunded"].includes(response.payment_status) ||
      (response.order_status === "Cancelled" && response.payment_status === "Captured")) {
    showPaymentMessage(panel, `Payment status: ${response.payment_status}. Check the order and refund status on the order page.`);
    const details = document.createElement("a");
    details.className = "button button-secondary";
    details.href = `order-confirmation.html?id=${encodeURIComponent(order.order_id)}`;
    details.textContent = "View order status";
    panel.append(details);
  } else {
    showPaymentMessage(panel, `Payment status: ${response.payment_status}. The order is not marked paid.`);
  }
}

async function loadRazorpayCheckout() {
  if (window.Razorpay) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Razorpay Checkout could not be loaded."));
    document.head.append(script);
  });
}

async function startPayment(order, customer, panel) {
  const lookupToken = sessionStorage.getItem(orderKey(order.order_id));
  const payment = await backendRequest("/payments/create-order", {
    method: "POST",
    headers: { "X-Order-Access-Token": lookupToken },
    body: JSON.stringify({ order_id: order.order_id })
  });
  panel.hidden = false;
  if (payment.provider === "mock" && payment.test_mode) {
    panel.innerHTML = `<p class="eyebrow">TEST MODE</p><h2>Simulated payment</h2><p>${escapeHtml(payment.notice)} Choose an outcome for local testing:</p><div class="payment-actions"><button class="button" type="button" data-mock-outcome="success">Simulate successful test payment</button><button class="button button-secondary" type="button" data-mock-outcome="failure">Simulate failed test payment</button></div><p id="payment-status" class="form-status" role="status"></p>`;
    panel.querySelectorAll("[data-mock-outcome]").forEach(button => button.addEventListener("click", async () => {
      panel.querySelectorAll("button").forEach(control => { control.disabled = true; });
      try {
        await verifyPayment(order, { outcome: button.dataset.mockOutcome }, panel);
      } catch (error) {
        showPaymentMessage(panel, error.message, true);
      } finally {
        panel.querySelectorAll("button").forEach(control => { control.disabled = false; });
      }
    }));
    return;
  }
  if (payment.provider !== "razorpay" || !payment.key_id) {
    throw new Error("No usable payment provider is configured.");
  }
  await loadRazorpayCheckout();
  const checkout = new window.Razorpay({
    key: payment.key_id,
    amount: Math.round(Number(payment.amount) * 100),
    currency: payment.currency,
    name: "AIG TECHNOLOGY",
    description: `Order ${order.order_id}`,
    order_id: payment.provider_order_id,
    prefill: { name: customer.full_name, email: customer.email, contact: customer.phone },
    handler: async result => {
      try {
        await verifyPayment(order, {
          razorpay_order_id: result.razorpay_order_id,
          razorpay_payment_id: result.razorpay_payment_id,
          razorpay_signature: result.razorpay_signature
        }, panel);
      } catch (error) {
        await checkPaymentStatus(order, panel).catch(() => showPaymentMessage(panel, error.message, true));
      }
    },
    modal: { ondismiss: () => checkPaymentStatus(order, panel).catch(error => showPaymentMessage(panel, error.message, true)) },
    theme: { color: "#1269A6" }
  });
  checkout.open();
}

async function initCheckoutPage() {
  const form = byId("checkout-form");
  if (!form) return;
  const status = byId("checkout-status");
  const summary = byId("checkout-summary");
  const paymentPanel = byId("payment-panel");
  const billingDetails = document.querySelector(".billing-details");
  const billingFields = [...form.querySelectorAll("[name^='billing_']")];
  billingDetails.addEventListener("toggle", () => {
    billingFields.forEach(field => { field.required = billingDetails.open && field.name !== "billing_line2"; });
  });
  let cart;
  try {
    cart = readCart();
    const result = await validateCart(cart);
    renderSummary(summary, result);
    summary.insertAdjacentHTML("afterbegin", `<ul class="checkout-items">${result.items.map(item => `<li>${escapeHtml(item.name)} × ${item.quantity}</li>`).join("")}</ul>`);
  } catch (error) {
    summary.innerHTML = `<p class="notice notice-warning">${escapeHtml(error.message)} <a href="cart.html">Review your cart</a>.</p>`;
    form.querySelector("#place-order").disabled = true;
    return;
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = byId("place-order");
    button.disabled = true;
    status.textContent = "Rechecking price and stock before creating your order…";
    try {
      const validated = await validateCart(cart);
      renderSummary(summary, validated);
      const billing = billingDetails.open ? {
        line1: form.elements.billing_line1.value.trim(),
        line2: form.elements.billing_line2.value.trim(),
        city: form.elements.billing_city.value.trim(),
        state: form.elements.billing_state.value.trim(),
        postal_code: form.elements.billing_postal_code.value.trim()
      } : null;
      const customer = {
        full_name: form.elements.full_name.value.trim(),
        phone: form.elements.phone.value.trim(),
        email: form.elements.email.value.trim()
      };
      let idempotencyKey = sessionStorage.getItem("aigCheckoutIdempotencyKey");
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        sessionStorage.setItem("aigCheckoutIdempotencyKey", idempotencyKey);
      }
      const order = await backendRequest("/orders/create", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          customer,
          address: addressFrom(form),
          billing_address: billing,
          items: cart.map(({ sku, quantity }) => ({ sku, quantity })),
          terms_accepted: form.elements.terms_accepted.checked
        })
      });
      storeOrderAccess(order);
      sessionStorage.removeItem("aigCheckoutIdempotencyKey");
      form.hidden = true;
      status.textContent = "";
      try {
        await startPayment(order, customer, paymentPanel);
      } catch (error) {
        showPaymentMessage(paymentPanel, `Your order ${order.order_id} was created, but payment could not be started: ${error.message}`, true);
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "button button-secondary";
        retry.textContent = "Retry payment setup";
        retry.addEventListener("click", () => startPayment(order, customer, paymentPanel).catch(failure => showPaymentMessage(paymentPanel, failure.message, true)));
        paymentPanel.append(retry);
      }
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = "error";
      button.disabled = false;
    }
  });
}

async function initConfirmationPage() {
  const target = byId("order-details");
  if (!target) return;
  const orderId = new URLSearchParams(location.search).get("id");
  const lookupToken = orderId ? sessionStorage.getItem(orderKey(orderId)) : null;
  if (!orderId || !lookupToken) {
    target.innerHTML = `<div class="empty-state">This order cannot be opened in this browser session. Order details are protected by a private access token. <a href="products.html">Return to products</a>.</div>`;
    return;
  }
  try {
    const order = await backendRequest(`/orders/${encodeURIComponent(orderId)}`, {
      headers: { "X-Order-Access-Token": lookupToken }
    });
    const payment = order.payment_reference || "Not available";
    const confirmedPayment = order.payment_status === "Captured" && order.status !== "Cancelled";
    const refundDetails = Array.isArray(order.refunds) ? order.refunds.map(refund => `${refund.status}: ${money(refund.amount)}`).join(", ") : "";
    target.innerHTML = `<section class="panel order-confirmation">
      <p class="eyebrow">${order.payment_status === "Captured" ? "Payment confirmed" : "Order status"}</p>
      <h2>Order ${escapeHtml(order.order_id)}</h2>
      <p><strong>Payment:</strong> ${escapeHtml(order.payment_status)} · <strong>Fulfilment:</strong> ${escapeHtml(order.status)}</p>
      <p><strong>Payment reference:</strong> ${escapeHtml(payment)}</p>
      ${confirmedPayment ? `<p><strong>Total paid:</strong> ${money(order.total_amount)}</p>` : order.payment_status === "Refunded" || order.payment_status === "Partially Refunded" ? `<p><strong>Refund status:</strong> ${escapeHtml(refundDetails || order.payment_status)}</p>` : order.payment_status === "Captured" && order.status === "Cancelled" ? `<p>Payment was captured, but this order was cancelled and is not confirmed. Refund status: ${escapeHtml(refundDetails || "being checked")}.</p>` : `<p>Payment is not confirmed. The order total is ${money(order.total_amount)}; do not treat it as paid.</p>`}
      <h3>Products</h3><ul>${order.items.map(item => `<li>${escapeHtml(item.name)} (SKU ${escapeHtml(item.sku)}) × ${item.quantity} — ${money(item.subtotal)}</li>`).join("")}</ul>
      <h3>Delivery address</h3><address>${escapeHtml(order.shipping_address.line1)}${order.shipping_address.line2 ? `<br>${escapeHtml(order.shipping_address.line2)}` : ""}<br>${escapeHtml(order.shipping_address.city)}, ${escapeHtml(order.shipping_address.state)} ${escapeHtml(order.shipping_address.postal_code)}</address>
      <p><strong>Order date:</strong> ${escapeHtml(order.order_date ? new Date(order.order_date).toLocaleString() : "—")}</p>
      ${Array.isArray(order.status_history) && order.status_history.length ? `<h3>Status history</h3><ul>${order.status_history.map(item => `<li>${escapeHtml(item.new_status)} — ${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : "")}</li>`).join("")}</ul>` : ""}
      ${order.whatsapp_fallback_url ? `<p><a class="button button-whatsapp" href="${escapeHtml(order.whatsapp_fallback_url)}" target="_blank" rel="noopener noreferrer">Contact AIG on WhatsApp</a></p>` : ""}
      <p>Expected delivery will be shared when available.</p>
    </section>`;
  } catch (error) {
    target.innerHTML = `<div class="empty-state" role="alert">${escapeHtml(error.message)}</div>`;
  }
}

initCartPage().catch(error => {
  const status = byId("cart-status");
  if (status) status.textContent = error.message;
});
initCheckoutPage().catch(error => {
  const status = byId("checkout-status");
  if (status) status.textContent = error.message;
});
initConfirmationPage().catch(error => {
  const target = byId("order-details");
  if (target) target.innerHTML = `<div class="empty-state" role="alert">${escapeHtml(error.message)}</div>`;
});
