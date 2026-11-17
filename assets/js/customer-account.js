import {
  clearVerifiedPurchase,
  fillCopyrightYear,
  readVerifiedPurchase
} from "./purchase-verification.js?v=20261116-purchase-audit-2";
import { API_BASE_URL } from "./api-config.js?v=20261117-customer-account";
import { signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { auth } from "./firebase-client.js";

const LOGIN_PAGE = "customer-login.html";
const profileName = document.querySelector("#customer-phone-display");
const purchaseStatus = document.querySelector("#purchase-status");
const purchaseSource = document.querySelector("#purchase-source");
const purchaseList = document.querySelector("#purchase-records");
const signOutButton = document.querySelector("#customer-sign-out");

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

function renderLinkedOrders(account) {
  const orders = Array.isArray(account.orders) ? account.orders : [];
  const offline = Array.isArray(account.offline_purchases) ? account.offline_purchases : [];
  if (profileName) profileName.textContent = account.customer?.full_name || "Verified customer";
  if (purchaseStatus) purchaseStatus.textContent = `${orders.length + offline.length} purchase record${orders.length + offline.length === 1 ? "" : "s"} linked to this account.`;
  if (purchaseSource) purchaseSource.textContent = [`Registered mobile: ${account.customer?.phone || account.verified_mobile}`, account.customer?.email ? `Email: ${account.customer.email}` : ""].filter(Boolean).join(" · ");
  if (!purchaseList) return;
  const cards = orders.map((order, index) => {
    const row = document.createElement("li"); row.className = "purchase-record";
    const title = document.createElement("p"); title.className = "purchase-record__title"; title.textContent = `${index + 1}. Order ${order.order_id}`; row.append(title);
    const meta = document.createElement("dl"); meta.className = "purchase-record__meta";
    [["Products", (order.items || []).map(item => `${item.name} × ${item.quantity}`).join(", ")], ["Purchase date", formatDate(order.order_date)], ["Payment", order.payment_status], ["Delivery status", order.status || "Order Placed"], ["Total paid", formatAmount(order.total_amount)], ["Dispatch date", formatDate(order.actual_dispatch_date || order.dispatch_date)], ["Estimated delivery", formatDate(order.estimated_delivery_date)], ["Shipment", order.tracking_number ? `${order.carrier || "Courier"} · ${order.tracking_number}` : "Tracking details will be available once your order is dispatched."]].forEach(([label, value]) => { const term = document.createElement("dt"); term.textContent = label; const description = document.createElement("dd"); description.textContent = value || "Not recorded"; meta.append(term, description); });
    row.append(meta);
    if (order.tracking_url && /^https?:\/\//i.test(order.tracking_url)) { const link = document.createElement("a"); link.className = "button button-secondary button-small"; link.href = order.tracking_url; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Track shipment"; row.append(link); }
    return row;
  });
  offline.forEach(record => {
    const source = document.createElement("li"); source.className = "purchase-record purchase-record--source";
    source.textContent = `Offline purchase ${record.reference} · ${formatDate(record.purchase_date)} · ${record.invoice_type || "Purchase"} · ${record.warranty_status || "Verification Required"}`;
    cards.push(source);
    (record.products || []).forEach((product, index) => cards.push(productRow(product, orders.length + index)));
  });
  purchaseList.replaceChildren(...cards);
}

function formatAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && value !== null && value !== "" ? currency.format(amount) : "Not recorded";
}

function formatDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function productRow(product, index) {
  const row = document.createElement("li");
  row.className = "purchase-record";

  const heading = document.createElement("p");
  heading.className = "purchase-record__title";
  heading.textContent = `${index + 1}. ${product.name || "Product"}`;
  row.append(heading);

  const details = [
    ["Model", product.model],
    ["Serial number", product.serial_number],
    ["Warranty", Number(product.warranty_months) > 0 ? `${product.warranty_months} month(s)` : ""],
    ["Quantity", product.quantity],
    ["Invoice amount", product.invoice_amount !== undefined ? formatAmount(product.invoice_amount) : ""]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");

  const list = document.createElement("dl");
  list.className = "purchase-record__meta";
  details.forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    list.append(term, description);
  });
  row.append(list);
  return row;
}

function renderPurchase(purchase) {
  const purchases = Array.isArray(purchase.purchases) && purchase.purchases.length ? purchase.purchases : [purchase];
  const firstPurchase = purchases[0];
  if (profileName) {
    profileName.textContent = firstPurchase.customer_name || "Verified customer";
  }
  if (purchaseStatus) {
    purchaseStatus.textContent = `${purchases.length} purchase record${purchases.length === 1 ? "" : "s"} verified.`;
  }
  if (purchaseSource) {
    purchaseSource.textContent = [
      firstPurchase.mobile ? `Registered mobile: ${firstPurchase.mobile}` : "",
      firstPurchase.email ? `Email: ${firstPurchase.email}` : ""
    ].filter(Boolean).join(" · ");
  }
  if (!purchaseList) return;
  purchaseList.replaceChildren();
  let productIndex = 0;
  purchases.forEach(record => {
    const sourceRow = document.createElement("li");
    sourceRow.className = "purchase-record purchase-record--source";
    sourceRow.textContent = `Purchase reference: ${record.reference} · ${formatDate(record.purchase_date)} · ${record.warranty_status || "Verification Required"}`;
    purchaseList.append(sourceRow);
    const products = Array.isArray(record.products) ? record.products : [];
    products.forEach(product => purchaseList.append(productRow(product, productIndex++)));
  });
  if (!productIndex) {
    const empty = document.createElement("li");
    empty.className = "purchase-record";
    empty.textContent = "No product lines were recorded for this purchase.";
    purchaseList.append(empty);
  }
}

function signOut() {
  clearVerifiedPurchase();
  window.location.href = LOGIN_PAGE;
}

async function loadAccount() {
  try {
    const response = await fetch(`${API_BASE_URL}/customer/account`, { credentials: "include" });
    if (!response.ok) throw new Error("Customer verification is required");
    renderLinkedOrders(await response.json());
  } catch { window.location.href = LOGIN_PAGE; }
}
signOutButton?.addEventListener("click", async () => {
  await fetch(`${API_BASE_URL}/customer/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  if (auth?.currentUser) await firebaseSignOut(auth).catch(() => {});
  signOut();
});
fillCopyrightYear();
loadAccount();
