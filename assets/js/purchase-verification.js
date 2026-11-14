import { API_BASE_URL } from "./api-config.js?v=20261114-purchase";

export const PURCHASE_STORAGE_KEY = "aig_purchase_verification";
export const MOBILE_PATTERN = /^[6-9]\d{9}$/;
export const PURCHASE_TYPE_LABELS = {
  GST: "GST invoice",
  NON_GST: "Non-GST invoice",
  ONLINE: "Online order"
};

export function normalizeMobile(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export async function verifyPurchase({ invoiceType, invoiceNumber, mobile }) {
  if (!API_BASE_URL) throw new Error("The API address is not configured for this site.");
  const response = await fetch(`${API_BASE_URL}/customer/verify-purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoice_type: invoiceType,
      invoice_number: invoiceNumber,
      mobile
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    if (typeof detail === "string") throw new Error(detail);
    if (response.status === 429) throw new Error("Too many attempts. Please wait a minute and try again.");
    throw new Error(`Purchase verification failed (${response.status}).`);
  }
  if (!payload?.verified) throw new Error("Purchase verification failed.");
  return payload;
}

export function saveVerifiedPurchase(purchase) {
  sessionStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(purchase));
}

export function readVerifiedPurchase() {
  try {
    return JSON.parse(sessionStorage.getItem(PURCHASE_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function clearVerifiedPurchase() {
  sessionStorage.removeItem(PURCHASE_STORAGE_KEY);
}

export function fillCopyrightYear(root = document) {
  root.querySelectorAll("[data-year]").forEach(element => {
    element.textContent = String(new Date().getFullYear());
  });
}
