import { login, logout, watchAdmin } from "./auth.js";
import { auth } from "./firebase-client.js";
import { archiveCatalogProduct, saveCatalogProduct } from "./backend-api.js?v=20261107-safe-catalog";
import { validateCatalogImport } from "./catalog-import.js?v=20261107-safe-catalog";
import {
  adminListCatalogProductsForImport, adminListEnquiries, adminListProducts, readAdminSettings, removeEnquiry,
  removeProduct, saveProduct, savePublicSettings, updateEnquiry, updateProductCheckoutFields
} from "./firestore.js?v=20261107-safe-catalog";
import { uploadProductImage } from "./cloudinary.js";

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const dateText = value => value?.toDate ? value.toDate().toLocaleString() : "—";
const statusMessage = (node, text, error = false) => { node.textContent = text; node.dataset.state = error ? "error" : "success"; };
const show = (node, text) => { node.textContent = text; };
const defaultProductCategories = [
  "Desktop Computers", "Mini PCs", "Keyboards and Mice",
  "SSDs and Storage", "RAM and Components", "Computer Accessories"
];
let pendingCatalogImport = null;

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
    if (link.getAttribute("href") === "operations.html") link.textContent = "Flipkart & Website Orders";
  });
  document.querySelectorAll(".admin-nav").forEach(nav => {
    if (![...nav.querySelectorAll("a")].some(link => link.getAttribute("href") === "operations.html")) {
      const link = document.createElement("a");
      link.href = "operations.html";
      link.textContent = "Flipkart & Website Orders";
      nav.append(link);
    }
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

function attachCatalogImport() {
  let fileInput = $("#catalog-mapping-file");
  if (!fileInput && $("#sync-catalog")) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.innerHTML = `<h2 style="font-size:1.35rem">Controlled Firebase catalog import</h2><p>Download the mapping template, enter an approved SKU and actual numeric stock for each product, then run a read-only dry run. Existing prices and publish status are never changed by this import.</p><p><a href="../FIREBASE_PRODUCT_MAPPING_REPORT.md">View the product mapping report</a> · <a href="../FIREBASE_PRODUCT_MAPPING_IMPORT_TEMPLATE.csv" download>Download the CSV template</a></p><div class="field"><label for="catalog-mapping-file">Completed mapping CSV</label><input id="catalog-mapping-file" type="file" accept=".csv,text/csv"></div><button id="catalog-import-dry-run" class="button button-secondary" type="button">Run dry run</button> <button id="catalog-import-apply" class="button" type="button" disabled>Apply reviewed mapping</button><a id="catalog-import-audit" hidden>Download import audit log</a><pre id="catalog-import-preview" role="status" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>`;
    $("#sync-catalog").closest(".panel").insertAdjacentElement("afterend", panel);
    fileInput = $("#catalog-mapping-file");
  }
  const dryRunButton = $("#catalog-import-dry-run");
  const applyButton = $("#catalog-import-apply");
  const output = $("#catalog-import-preview");
  if (!fileInput || !dryRunButton || !applyButton || dryRunButton.dataset.bound === "true") return;
  dryRunButton.dataset.bound = "true";
  fileInput.addEventListener("change", () => {
    pendingCatalogImport = null;
    applyButton.disabled = true;
    output.textContent = "";
  });
  dryRunButton.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) return statusMessage($("#admin-message"), "Choose the completed catalog mapping CSV first.", true);
    dryRunButton.disabled = true;
    applyButton.disabled = true;
    fileInput.disabled = true;
    output.textContent = "Validating the mapping against the current Firebase catalog…";
    try {
      const products = await adminListCatalogProductsForImport();
      if (products.length === 1000) throw new Error("The catalog reached the 1,000-product safety limit. No import was run.");
      const result = validateCatalogImport(await file.text(), products);
      pendingCatalogImport = result.valid ? result.rows : null;
      output.textContent = result.rows.map(row =>
        `Line ${row.line}: ${row.id || "(missing ID)"} — ${row.product?.name || "unknown product"}; SKU ${row.sku || "(missing)"}; stock ${row.stockQuantity}${row.errors.length ? `; INVALID: ${row.errors.join(" ")}` : "; valid"}`
      ).join("\n");
      if (result.valid) {
        applyButton.disabled = false;
        statusMessage($("#admin-message"), `Dry run passed for ${result.rows.length} products. No data has been changed.`);
      } else {
        statusMessage($("#admin-message"), "Dry run failed. Correct every reported issue; no data has been changed.", true);
      }
    } catch (error) {
      pendingCatalogImport = null;
      output.textContent = error.message;
      statusMessage($("#admin-message"), `Catalog dry run failed: ${error.message}`, true);
    } finally {
      dryRunButton.disabled = false;
      fileInput.disabled = false;
    }
  });
  applyButton.addEventListener("click", async () => {
    if (!pendingCatalogImport?.length) return;
    const rows = pendingCatalogImport;
    if (!confirm(`Apply the reviewed SKU and numeric stock values to ${rows.length} Firebase products, then sync them to the checkout backend? This will not change prices, images, or publish status.`)) return;
    applyButton.disabled = true;
    fileInput.disabled = true;
    const audit = [];
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Sign in again before applying catalog mappings.");
      for (const row of rows) {
        const record = {
          firebase_document_id: row.id,
          product_name: row.product.name,
          previous_sku: row.product.sku || "",
          proposed_sku: row.sku,
          previous_stock: row.product.stockQuantity ?? "",
          stock_quantity: row.stockQuantity,
          firebase_status: "not written",
          backend_status: "not attempted"
        };
        try {
          await updateProductCheckoutFields(row.id, { sku: row.sku, stockQuantity: row.stockQuantity });
          record.firebase_status = "written";
          try {
            const synced = await saveCatalogProduct(row.id, {
              ...row.product,
              sku: row.sku,
              stockQuantity: row.stockQuantity
            }, idToken);
            record.backend_status = synced.synced ? "synced" : `skipped: ${synced.reason || "backend rejected product"}`;
          } catch (error) {
            record.backend_status = `failed: ${error.message}`;
          }
        } catch (error) {
          record.firebase_status = `failed: ${error.message}`;
        }
        audit.push(record);
      }
      const completed = audit.filter(row => row.firebase_status === "written" && row.backend_status === "synced").length;
      output.textContent = JSON.stringify({ completed_at: new Date().toISOString(), results: audit }, null, 2);
      const failures = audit.length - completed;
      statusMessage($("#admin-message"), `Catalog mapping completed: ${completed}/${audit.length} written to Firebase and synced to backend; ${failures} need review. Download the audit log below.`, failures > 0);
      const blob = new Blob([JSON.stringify({ completed_at: new Date().toISOString(), results: audit }, null, 2)], { type: "application/json" });
      const download = $("#catalog-import-audit");
      download.href = URL.createObjectURL(blob);
      download.hidden = false;
      download.download = `catalog-sync-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      pendingCatalogImport = null;
      await loadProducts();
    } catch (error) {
      statusMessage($("#admin-message"), `Catalog import stopped: ${error.message}`, true);
    } finally {
      applyButton.disabled = true;
      fileInput.disabled = false;
    }
  });
}

async function loadProducts() {
  const form = $("#product-form");
  const status = $("#admin-message");
  const list = $("#product-list");
  const [products, settings] = await Promise.all([adminListProducts(), readAdminSettings()]);
  const hasConfiguredCategories = Array.isArray(settings.categories) && settings.categories.length > 0;
  const configuredCategories = hasConfiguredCategories ? settings.categories : defaultProductCategories;
  const categories = [...new Map([...configuredCategories, ...products.map(product => product.category)]
    .map(category => String(category || "").trim())
    .filter(Boolean)
    .map(category => [category.toLowerCase(), category])).values()].sort((a, b) => a.localeCompare(b));
  const categorySelect = form.elements.category;
  const selectedCategory = categorySelect.value;
  categorySelect.innerHTML = `<option value="">Select category</option>${categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  if (categories.includes(selectedCategory)) categorySelect.value = selectedCategory;
  list.innerHTML = products.map(product => `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.category)}</td><td>${escapeHtml(product.price ?? "On enquiry")}</td><td>${product.published ? "Published" : "Draft"}</td><td><div class="admin-actions"><button class="button button-secondary button-small" type="button" data-edit="${escapeHtml(product.id)}">Edit</button><button class="button button-small" type="button" data-delete="${escapeHtml(product.id)}">Delete</button></div></td></tr>`).join("") || `<tr><td colspan="5">No products yet. Add a product using the form.</td></tr>`;
  const syncCatalogButton = $("#sync-catalog");
  if (syncCatalogButton && syncCatalogButton.dataset.bound !== "true") {
    syncCatalogButton.dataset.bound = "true";
    syncCatalogButton.addEventListener("click", async () => {
      if (!confirm("Sync the current Firebase catalog to the checkout backend? This does not change Firebase data.")) return;
      syncCatalogButton.disabled = true;
      const failures = [];
      let synced = 0;
      let checkoutEnabled = 0;
      try {
        const currentProducts = await adminListProducts();
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error("Sign in again before syncing the catalog.");
        for (const product of currentProducts) {
          try {
            const result = await saveCatalogProduct(product.id, product, idToken);
            if (result.synced) synced += 1;
            if (result.checkout_enabled) checkoutEnabled += 1;
            else if (!result.synced) failures.push(`${product.name}: ${result.reason}`);
          } catch (error) {
            failures.push(`${product.name}: ${error.message}`);
          }
          attachCatalogImport();
        }
        statusMessage(status, `Catalog sync finished: ${synced} synced, ${checkoutEnabled} ready for online checkout, ${failures.length} skipped or failed.${failures.length ? ` ${failures.join(" | ")}` : ""}`, failures.length > 0);
      } catch (error) {
        statusMessage(status, `Catalog sync failed: ${error.message}`, true);
      } finally {
        syncCatalogButton.disabled = false;
      }
    });
  }
  list.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => {
    const product = products.find(item => item.id === button.dataset.edit);
    if (!product) return;
    for (const key of ["name", "slug", "brand", "model", "sku", "description", "condition", "price", "availability", "stockQuantity", "warranty"]) form.elements[key].value = product[key] ?? "";
    categorySelect.value = categories.find(category => category.toLowerCase() === String(product.category || "").trim().toLowerCase()) || "";
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
    try {
      const idToken = await auth.currentUser.getIdToken();
      await archiveCatalogProduct(button.dataset.delete, idToken);
      await removeProduct(button.dataset.delete);
      await loadProducts();
    }
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
        if (![...categorySelect.options].some(option => option.value.toLowerCase() === data.category.toLowerCase())) throw new Error("Choose a category from the category list.");
        if (data.price !== null && (!Number.isFinite(data.price) || data.price < 0)) throw new Error("Enter a valid non-negative price.");
        if (data.stockQuantity !== null && (!Number.isInteger(data.stockQuantity) || data.stockQuantity < 0)) throw new Error("Stock quantity must be a non-negative whole number.");
        const id = form.elements.productId.value;
        const saved = await saveProduct(id, data);
        const catalogId = id || saved.id;
        try {
          const idToken = await auth.currentUser.getIdToken();
          const result = await saveCatalogProduct(catalogId, data, idToken);
          statusMessage(status, !result.synced
            ? `Product saved, but it could not be synced: ${result.reason}.`
            : result.checkout_enabled
            ? "Product saved and synced. It is available for online checkout."
            : "Product saved and synced. Online checkout needs a published product with a SKU and price; stock may also be required.");
        } catch (syncError) {
          statusMessage(status, `Product was saved to Firebase, but checkout catalog sync failed: ${syncError.message}. Save again after the backend is available.`, true);
          await loadProducts();
          return;
        }
        form.reset();
        form.elements.productId.value = "";
        $("#product-form-title").textContent = "Add product";
        await loadProducts();
      } catch (error) { statusMessage(status, error.message, true); }
      finally { button.disabled = false; }
    });
    $("#clear-product-form").addEventListener("click", () => { form.reset(); form.elements.productId.value = ""; $("#product-form-title").textContent = "Add product"; });
    $("#add-category").addEventListener("click", async () => {
      const input = $("#new-category");
      const category = input.value.trim();
      if (!category) return statusMessage(status, "Enter a category name.", true);
      if (category.length > 80) return statusMessage(status, "Category names must be 80 characters or fewer.", true);
      const existing = [...categorySelect.options].map(option => option.value).filter(Boolean);
      if (existing.some(item => item.toLowerCase() === category.toLowerCase())) {
        categorySelect.value = existing.find(item => item.toLowerCase() === category.toLowerCase());
        return statusMessage(status, "That category already exists.");
      }
      if (existing.length >= 30) return statusMessage(status, "You can add up to 30 product categories.", true);
      const button = $("#add-category");
      button.disabled = true;
      try {
        await savePublicSettings({ categories: [...existing, category] });
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        categorySelect.append(option);
        categorySelect.value = category;
        input.value = "";
        statusMessage(status, "Category added. It is now available in the website navigation and catalogue filters.");
      } catch (error) {
        statusMessage(status, `Could not add category: ${error.message}`, true);
      } finally {
        button.disabled = false;
      }
    });
    $("#upload-image").addEventListener("click", async () => {
      const input = $("#product-image-file");
      const files = Array.from(input.files);
      if (!files.length) return statusMessage(status, "Choose at least one image first.", true);
      const button = $("#upload-image");
      button.disabled = true;
      button.textContent = "Uploading…";
      status.textContent = `Preparing to upload ${files.length} image${files.length === 1 ? "" : "s"}…`;
      status.dataset.state = "";
      let uploaded = 0;
      try {
        for (const file of files) {
          const image = await uploadProductImage(file, progress => {
            status.textContent = `Uploading ${uploaded + 1} of ${files.length}: ${file.name} (${progress}%)`;
            status.dataset.state = "";
          });
          form.elements.images.value += `${form.elements.images.value ? "\n" : ""}${image.url} | ${image.alt} | ${image.publicId}`;
          uploaded += 1;
        }
        input.value = "";
        statusMessage(status, `${uploaded} image${uploaded === 1 ? "" : "s"} uploaded. Save the product to store the image references.`);
      } catch (error) {
        statusMessage(status, `Uploaded ${uploaded} of ${files.length} images. Upload failed for ${files[uploaded].name}: ${error.message}`, true);
      } finally {
        button.disabled = false;
        button.textContent = "Upload selected images";
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
