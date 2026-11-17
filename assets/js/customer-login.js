import {
  MOBILE_PATTERN,
  fillCopyrightYear,
  normalizeMobile,
  saveVerifiedPurchase,
  verifyPurchase
} from "./purchase-verification.js?v=20261116-purchase-audit-2";
import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { API_BASE_URL } from "./api-config.js?v=20261116-live";
import { auth, isFirebaseConfigured } from "./firebase-client.js";

const form = document.querySelector("#purchase-verify-form");
const status = document.querySelector("#purchase-verify-status");
const googleButton = document.querySelector("#google-login-button");

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
    const purchase = await verifyPurchase({ invoiceNumber, mobile });
    saveVerifiedPurchase(purchase);
    setStatus("Purchase verified. Opening your account…", "success");
    window.location.href = "customer-account.html";
  } catch (error) {
    setStatus(error.message || "We could not verify that purchase.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function handleGoogleLogin() {
  if (!isFirebaseConfigured || !auth) {
    setStatus("Google login is not configured yet. You can still verify a purchase below.", "error");
    return;
  }
  googleButton.disabled = true;
  setStatus("Opening Google sign-in…");
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const token = await result.user.getIdToken();
    const response = await fetch(`${API_BASE_URL}/customer/firebase-session`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || "Google login failed");
    if (payload.authenticated) {
      window.location.href = "customer-account.html";
      return;
    }
    setStatus(payload.message || "Verify a purchase below to link this Google account.", "warning");
  } catch (error) {
    setStatus(error.code === "auth/popup-closed-by-user" ? "Google sign-in was cancelled." : (error.message || "Google login failed."), "error");
  } finally {
    googleButton.disabled = false;
  }
}

if (form) {
  form.addEventListener("submit", handleSubmit);
}
if (googleButton) googleButton.addEventListener("click", handleGoogleLogin);

fillCopyrightYear();
