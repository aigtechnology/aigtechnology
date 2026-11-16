import {
  PURCHASE_TYPE_LABELS,
  clearVerifiedPurchase,
  fillCopyrightYear,
  readVerifiedPurchase
} from "./purchase-verification.js?v=20261116-purchase-audit";

const LOGIN_PAGE = "customer-login.html";
const profileName = document.querySelector("#customer-phone-display");
const purchaseStatus = document.querySelector("#purchase-status");
const purchaseSource = document.querySelector("#purchase-source");
const purchaseList = document.querySelector("#purchase-records");
const signOutButton = document.querySelector("#customer-sign-out");

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

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
    const type = PURCHASE_TYPE_LABELS[record.invoice_type || record.source] || record.invoice_type || record.source || "Purchase";
    sourceRow.textContent = `${type} · ${record.reference} · ${formatDate(record.purchase_date)} · ${record.warranty_status || "Verification Required"}`;
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

const purchase = readVerifiedPurchase();
if (!purchase?.verified) {
  window.location.href = LOGIN_PAGE;
} else {
  renderPurchase(purchase);
  signOutButton?.addEventListener("click", signOut);
  fillCopyrightYear();
}
