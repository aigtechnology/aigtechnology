import { RecaptchaVerifier, onAuthStateChanged, signInWithPhoneNumber, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { auth, isFirebaseConfigured } from "./firebase-client.js";
const loginForm = document.querySelector("#customer-login-form");
const sendCode = document.querySelector("#send-code");
const verifyCode = document.querySelector("#verify-code");
const otpSection = document.querySelector("#otp-section");
const status = document.querySelector("#customer-login-status");
const phoneInput = document.querySelector("#customer-phone");
const otpInput = document.querySelector("#customer-otp");
const accountPhone = document.querySelector("#customer-phone-display");
let confirmationResult = null;
let recaptcha = null;
function message(text, error = false) { const target = status || document.querySelector("#customer-account-status"); if (target) { target.textContent = text; target.classList.toggle("error", error); } }
function normalizePhone(value) { const digits = String(value || "").replace(/\D/g, ""); return digits.length === 10 ? `+91${digits}` : String(value || "").trim(); }
if (!isFirebaseConfigured || !auth) message("Customer login is temporarily unavailable. Please use guest checkout or contact support.", true);
else if (loginForm) {
  onAuthStateChanged(auth, user => { if (user) location.href = "customer-account.html"; });
  recaptcha = new RecaptchaVerifier(auth, "recaptcha-container", { size: "normal" });
  loginForm.addEventListener("submit", async event => { event.preventDefault(); const phone = normalizePhone(phoneInput.value); if (!/^\+91[6-9]\d{9}$/.test(phone)) { message("Enter a valid 10-digit Indian mobile number.", true); return; } sendCode.disabled = true; try { confirmationResult = await signInWithPhoneNumber(auth, phone, recaptcha); otpSection.hidden = false; message("Verification code sent. Enter the 6-digit code."); phoneInput.disabled = true; } catch (error) { message(error.message || "Could not send the verification code.", true); recaptcha.clear(); recaptcha = new RecaptchaVerifier(auth, "recaptcha-container", { size: "normal" }); } finally { sendCode.disabled = false; } });
  verifyCode.addEventListener("click", async () => { if (!confirmationResult || !/^\d{6}$/.test(otpInput.value.trim())) { message("Enter the 6-digit verification code.", true); return; } verifyCode.disabled = true; try { await confirmationResult.confirm(otpInput.value.trim()); location.href = "customer-account.html"; } catch (error) { message(error.message || "The verification code is invalid or expired.", true); } finally { verifyCode.disabled = false; } });
} else {
  onAuthStateChanged(auth, user => { if (!user) { location.href = "customer-login.html"; return; } if (accountPhone) accountPhone.textContent = `Mobile: ${user.phoneNumber || "Verified account"}`; });
  document.querySelector("#customer-sign-out")?.addEventListener("click", async () => { await signOut(auth); location.href = "customer-login.html"; });
}
