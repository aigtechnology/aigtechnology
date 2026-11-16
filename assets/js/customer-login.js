import {
  MOBILE_PATTERN,
  fillCopyrightYear,
  normalizeMobile,
  saveVerifiedPurchase,
  verifyPurchase
} from "./purchase-verification.js?v=20261116-purchase-audit";

const form = document.querySelector("#purchase-verify-form");
const status = document.querySelector("#purchase-verify-status");

function setStatus(text, state = "") {
  if (!status) return;
  status.textContent = text;
  status.dataset.state = state;
}

function readField(name) {
  return String(form?.elements?.[name]?.value ?? "").trim();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!form) return;

  const invoiceType = readField("invoiceType");
  const invoiceNumber = readField("invoiceNumber");
  const mobile = normalizeMobile(readField("mobile"));

  if (!invoiceNumber) {
    setStatus("Enter the invoice or order number printed on your bill.", "error");
    form.elements.invoiceNumber?.focus();
    return;
  }
  if (!MOBILE_PATTERN.test(mobile)) {
    setStatus("Enter the 10-digit mobile number registered with that purchase.", "error");
    form.elements.mobile?.focus();
    return;
  }

  const button = form.querySelector("button[type=submit]");
  if (button) button.disabled = true;
  setStatus("Checking your purchase…");

  try {
    const purchase = await verifyPurchase({ invoiceType, invoiceNumber, mobile });
    saveVerifiedPurchase(purchase);
    setStatus("Purchase verified. Opening your account…", "success");
    window.location.href = "customer-account.html";
  } catch (error) {
    setStatus(error.message || "We could not verify that purchase.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

if (form) {
  form.addEventListener("submit", handleSubmit);
  form.elements.invoiceType?.addEventListener("change", () => {
    const isOnline = form.elements.invoiceType.value === "ONLINE";
    if (form.elements.invoiceNumber) {
      form.elements.invoiceNumber.placeholder = isOnline ? "Order ID, e.g. AIG-20261114-AB12CD" : "Invoice number, e.g. INV-1001";
    }
  });
}

fillCopyrightYear();
