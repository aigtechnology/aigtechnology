import { login, logout, watchAdmin } from "./auth.js";
import {
  adminListEnquiries, adminListProducts, readAdminSettings, removeEnquiry,
  removeProduct, saveProduct, savePublicSettings, updateEnquiry
} from "./firestore.js";
import { uploadProductImage } from "./cloudinary.js";

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const dateText = value => value?.toDate ? value.toDate().toLocaleString() : "—";
const statusMessage = (node, text, error = false) => { node.textContent = text; node.dataset.state = error ? "error" : "success"; };
const show = (node, text) => { node.textContent = text; };

function goLogin() { location.href = "login.html"; }

function loginPage() {
  const form = $("#login-form");
  if (!form) return;
  const status = $("#login-status");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    status.textContent = "Signing in…";
    try {
      await login(form.elements.email.value.trim(), form.elements.password.value);
      location.href = "index.html";
    } catch (error) {
      statusMessage(status, `Sign-in failed: ${error.message}`, true);
    } finally { button.disabled = false; }
  });
  watchAdmin(({ user, isAdmin, error }) => {
    if (error) statusMessage(status, error, true);
    else if (user && isAdmin) location.href = "index.html";
    else if (user) statusMessage(status, "This account does not have administrator access.", true);
  });
}

function requireAdmin() {
  const app = $("#admin-app");
  const status = $("#admin-auth-status");
  watchAdmin(({ user, isAdmin, error }) => {
    if (error) { show(status, error); return; }
    if (!user) { goLogin(); return; }
    if (!isAdmin) { show(status, "This account does not have administrator access. Sign out and use an authorized administrator account."); return; }
    status.hidden = true;
    app.hidden = false;
    document.querySelectorAll("[data-admin-email]").forEach(el => { el.textContent = user.email || "Administrator"; });
    const signout = $("#sign-out");
    signout?.addEventListener("click", async () => { await logout(); goLogin(); });
    loadAdminPage().catch(error => {
      console.error("Admin page failed to load:", error);
      const message = $("#admin-message");
      if (message) statusMessage(message, error.message || "Could not load admin data.", true);
    });
  });
}

function navActive() {
  const current = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".admin-nav a").forEach(link => {
    if (link.getAttribute("href") === current) link.setAttribute("aria-current", "page");
  });
}

async function loadAdminPage() {
  navActive();
  const app = $("#admin-app");
  const message = $("#admin-message");
  app.setAttribute("aria-busy", "true");
  if (message) {
    message.textContent = "Loading admin data…";
    message.dataset.state = "";
  }
  try {
    if (document.body.dataset.adminPage === "dashboard") await loadDashboard();
    if (document.body.dataset.adminPage === "products") await loadProducts();
    if (document.body.dataset.adminPage === "enquiries") await loadEnquiries();
    if (document.body.dataset.adminPage === "settings") await loadSettings();
    if (message) message.textContent = "";
  } finally {
    app.setAttribute("aria-busy", "false");
  }
}

async function loadDashboard() {
  const [products, enquiries] = await Promise.all([adminListProducts(), adminListEnquiries()]);
  $("#product-count").textContent = String(products.length);
  $("#enquiry-count").textContent = String(enquiries.length);
  $("#new-enquiry-count").textContent = String(enquiries.filter(item => item.status === "New").length);
  const recent = $("#recent-enquiries");
  recent.innerHTML = enquiries.slice(0, 5).map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.productName || "General enquiry")}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(dateText(item.createdAt))}</td></tr>`).join("") || `<tr><td colspan="4">No enquiries have been received.</td></tr>`;
}

function productFormData(form) {
  const value = name => form.elements[name].value.trim();
  const parseSpecs = raw => {
    const result = {};
    for (const line of raw.split("\n").filter(Boolean)) {
      const split = line.indexOf(":");
      if (split < 1) throw new Error("Enter specifications one per line as Label: Value.");
      result[line.slice(0, split).trim()] = line.slice(split + 1).trim();
    }
    return result;
  };
  const images = value("images").split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const [url, alt = "", publicId = ""] = line.split("|").map(part => part.trim());
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { throw new Error("Enter a valid HTTPS product image URL."); }
    if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname) throw new Error("Product image URLs must use HTTPS.");
    if (alt.length > 120 || publicId.length > 255) throw new Error("Image alt text or public ID is too long.");
    return { url: parsedUrl.href, alt: (alt || value("name")).slice(0, 120), ...(publicId ? { publicId } : {}) };
  });
  const price = value("price");
  return {
    name: value("name"), slug: value("slug"), brand: value("brand"), model: value("model"),
    category: value("category"), sku: value("sku"), description: value("description"),
    specifications: parseSpecs(value("specifications")), condition: value("condition"),
    price: price ? Number(price) : null, availability: value("availability"),
    stockQuantity: value("stockQuantity") ? Number(value("stockQuantity")) : null,
    warranty: value("warranty"), images, featured: form.elements.featured.checked,
    published: form.elements.published.checked,
    searchKeywords: [value("name"), value("brand"), value("model"), value("category"), value("sku")].join(" ").toLowerCase()
  };
}

async function loadProducts() {
  const form = $("#product-form");
  const status = $("#admin-message");
  const list = $("#product-list");
  const products = await adminListProducts();
  list.innerHTML = products.map(product => `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.category)}</td><td>${escapeHtml(product.price ?? "On enquiry")}</td><td>${product.published ? "Published" : "Draft"}</td><td><div class="admin-actions"><button class="button button-secondary button-small" type="button" data-edit="${escapeHtml(product.id)}">Edit</button><button class="button button-small" type="button" data-delete="${escapeHtml(product.id)}">Delete</button></div></td></tr>`).join("") || `<tr><td colspan="5">No products yet. Add a product using the form.</td></tr>`;
  list.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => {
    const product = products.find(item => item.id === button.dataset.edit);
    if (!product) return;
    for (const key of ["name", "slug", "brand", "model", "category", "sku", "description", "condition", "price", "availability", "stockQuantity", "warranty"]) form.elements[key].value = product[key] ?? "";
    form.elements.specifications.value = Object.entries(product.specifications || {}).map(([key, value]) => `${key}: ${value}`).join("\n");
    form.elements.images.value = (product.images || []).map(image => `${image.url || image}${image.alt ? ` | ${image.alt}` : ""}${image.publicId ? ` | ${image.publicId}` : ""}`).join("\n");
    form.elements.featured.checked = Boolean(product.featured);
    form.elements.published.checked = Boolean(product.published);
    form.elements.productId.value = product.id;
    $("#product-form-title").textContent = "Edit product";
    form.scrollIntoView({ behavior: "smooth" });
  }));
  list.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Delete this product? This cannot be undone.")) return;
    button.disabled = true;
    try { await removeProduct(button.dataset.delete); await loadProducts(); }
    catch (error) { statusMessage(status, `Could not delete product: ${error.message}`, true); }
  }));
  if (form.dataset.bound !== "true") {
    form.dataset.bound = "true";
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const data = productFormData(form);
        if (!data.name || !data.slug || !data.category || !data.condition) throw new Error("Name, slug, category, and condition are required.");
        if (data.price !== null && (!Number.isFinite(data.price) || data.price < 0)) throw new Error("Enter a valid non-negative price.");
        const id = form.elements.productId.value;
        await saveProduct(id, data);
        statusMessage(status, "Product saved.");
        form.reset();
        form.elements.productId.value = "";
        $("#product-form-title").textContent = "Add product";
        await loadProducts();
      } catch (error) { statusMessage(status, error.message, true); }
      finally { button.disabled = false; }
    });
    $("#clear-product-form").addEventListener("click", () => { form.reset(); form.elements.productId.value = ""; $("#product-form-title").textContent = "Add product"; });
    $("#upload-image").addEventListener("click", async () => {
      const file = $("#product-image-file").files[0];
      if (!file) return statusMessage(status, "Choose an image first.", true);
      const button = $("#upload-image");
      button.disabled = true;
      button.textContent = "Uploading…";
      status.textContent = "Preparing Cloudinary upload…";
      status.dataset.state = "";
      try {
        const image = await uploadProductImage(file, progress => {
          status.textContent = `Uploading image… ${progress}%`;
          status.dataset.state = "";
        });
        form.elements.images.value += `${form.elements.images.value ? "\n" : ""}${image.url} | ${image.alt} | ${image.publicId}`;
        statusMessage(status, "Image uploaded. Save the product to store its image reference.");
      } catch (error) {
        statusMessage(status, `Image upload failed: ${error.message}`, true);
      } finally {
        button.disabled = false;
        button.textContent = "Upload to Cloudinary";
      }
    });
  }
}

async function loadEnquiries() {
  const table = $("#enquiry-list");
  const status = $("#admin-message");
  async function render() {
    const records = await adminListEnquiries($("#status-filter").value);
    table.innerHTML = records.map(item => {
      const phone = String(item.phone || "").replace(/[^\d+]/g, "");
      const whatsapp = phone.replace(/\D/g, "");
      const contactLinks = `<div class="admin-contact-actions">${phone ? `<a class="button button-secondary button-small" href="tel:${escapeHtml(phone)}">Call</a>` : ""}${item.email ? `<a class="button button-secondary button-small" href="mailto:${encodeURIComponent(item.email)}">Email</a>` : ""}${whatsapp.length >= 8 && whatsapp.length <= 15 ? `<a class="button button-secondary button-small" href="https://wa.me/${whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}</div>`;
      const enquiryType = item.serviceCategory ? `Service: ${item.serviceCategory}` : item.productName || "General enquiry";
      return `<tr><td>${escapeHtml(item.name)}<br><small>${escapeHtml(item.phone)} ${escapeHtml(item.email)}</small>${contactLinks}</td><td>${escapeHtml(enquiryType)}<br><small>${escapeHtml(item.productId || "")}</small></td><td><select data-status="${escapeHtml(item.id)}" aria-label="Status for ${escapeHtml(item.name)}">${["New","Contacted","In Progress","Resolved"].map(value => `<option ${item.status === value ? "selected" : ""}>${value}</option>`).join("")}</select><textarea data-notes="${escapeHtml(item.id)}" aria-label="Internal notes for ${escapeHtml(item.name)}" placeholder="Private internal notes">${escapeHtml(item.internalNotes || "")}</textarea></td><td><div class="admin-enquiry-message">${escapeHtml(item.message)}</div></td><td>${escapeHtml(dateText(item.createdAt))}</td><td><button class="button button-small" data-save-enquiry="${escapeHtml(item.id)}" type="button">Save</button> <button class="button button-secondary button-small" data-delete-enquiry="${escapeHtml(item.id)}" type="button">Delete</button></td></tr>`;
    }).join("") || `<tr><td colspan="6">No enquiries in this view.</td></tr>`;
    table.querySelectorAll("[data-save-enquiry]").forEach(button => button.addEventListener("click", async () => {
      const id = button.dataset.saveEnquiry;
      button.disabled = true;
      try {
        await updateEnquiry(id, {
          status: table.querySelector(`[data-status="${CSS.escape(id)}"]`).value,
          internalNotes: table.querySelector(`[data-notes="${CSS.escape(id)}"]`).value.slice(0, 3000)
        });
        statusMessage(status, "Enquiry updated.");
      } catch (error) { statusMessage(status, `Could not update enquiry: ${error.message}`, true); }
      finally { button.disabled = false; }
    }));
    table.querySelectorAll("[data-delete-enquiry]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("Delete this enquiry? This cannot be undone.")) return;
      try { await removeEnquiry(button.dataset.deleteEnquiry); await render(); }
      catch (error) { statusMessage(status, `Could not delete enquiry: ${error.message}`, true); }
    }));
  }
  $("#status-filter").addEventListener("change", render);
  await render();
}

async function loadSettings() {
  const form = $("#settings-form");
  const status = $("#admin-message");
  const data = await readAdminSettings();
  for (const key of ["publicPhone", "publicEmail", "whatsappNumber", "address", "businessHours", "footerText", "homepageHeadline", "announcementText"]) {
    form.elements[key].value = data[key] || "";
  }
  form.elements.announcementEnabled.checked = data.announcementEnabled !== false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    values.publicEmail = String(values.publicEmail || "").trim();
    values.publicPhone = String(values.publicPhone || "").trim();
    values.whatsappNumber = String(values.whatsappNumber || "").replace(/[^\d]/g, "");
    values.announcementEnabled = form.elements.announcementEnabled.checked;
    if (values.publicEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.publicEmail)) return statusMessage(status, "Enter a valid public email address.", true);
    if (values.whatsappNumber && (values.whatsappNumber.length < 8 || values.whatsappNumber.length > 15)) return statusMessage(status, "Enter a valid WhatsApp number including country code.", true);
    if (String(values.announcementText || "").length > 240) return statusMessage(status, "Announcement text must be 240 characters or fewer.", true);
    for (const key of Object.keys(values)) {
      if (typeof values[key] === "string") values[key] = values[key].trim().slice(0, 500);
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try { await savePublicSettings(values); statusMessage(status, "Public settings saved."); }
    catch (error) { statusMessage(status, `Could not save settings: ${error.message}`, true); }
    finally { button.disabled = false; }
  });
}

if (document.body.dataset.adminPage === "login") loginPage();
else requireAdmin();
