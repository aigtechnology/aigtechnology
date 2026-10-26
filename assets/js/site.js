import { getProductById, getProducts, getPublicSettings, submitEnquiry, submitServiceEnquiry } from "./firestore.js?v=20261025-retailer";
import { isFirebaseConfigured } from "./firebase-client.js";
import { businessContactConfig } from "./firebase-config.js";

const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const formatPrice = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value)) : "";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let businessWhatsAppNumber = businessContactConfig.whatsappNumber;
let revealObserver;

const productCategories = [
  "Desktop Computers", "Mini PCs", "Keyboards and Mice",
  "SSDs and Storage", "RAM and Components", "Computer Accessories"
];

function setupAnnouncement() {
  const header = document.querySelector(".site-header");
  if (!header || header.classList.contains("home-header") || document.querySelector(".announcement-banner")) return;
  const banner = document.createElement("div");
  banner.className = "announcement-banner";
  banner.innerHTML = '<span class="announcement-banner__spark" aria-hidden="true">✦</span><p data-announcement-text>Welcome to AIG TECHNOLOGY — Reliable Computers, Refurbished Systems &amp; Quality Accessories.</p><span class="announcement-banner__spark" aria-hidden="true">✦</span>';
  header.before(banner);
}

function setupNavigation() {
  const toggle = byId("menu-toggle");
  const nav = byId("main-nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    nav.classList.toggle("is-open", open);
  });
  const addDropdown = (linkText, className, label, items) => {
    const targetLink = [...nav.querySelectorAll("a")].find(link => link.textContent.trim() === linkText);
    if (!targetLink || nav.querySelector(`.${className}`)) return;
    const group = document.createElement("div");
    group.className = className;
    const categoryButton = document.createElement("button");
    categoryButton.className = "nav-dropdown-toggle";
    categoryButton.type = "button";
    categoryButton.setAttribute("aria-expanded", "false");
    categoryButton.setAttribute("aria-label", label);
    categoryButton.setAttribute("aria-controls", `${className}-menu`);
    categoryButton.textContent = "";
    const menu = document.createElement("div");
    menu.className = "nav-dropdown";
    menu.id = `${className}-menu`;
    menu.hidden = true;
    items.forEach(([title, href]) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = title;
      menu.append(link);
    });
    targetLink.parentNode.insertBefore(group, targetLink);
    group.append(targetLink, categoryButton, menu);
    categoryButton.addEventListener("click", () => {
      const open = categoryButton.getAttribute("aria-expanded") !== "true";
      categoryButton.setAttribute("aria-expanded", String(open));
      menu.hidden = !open;
    });
    group.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      menu.hidden = true;
      categoryButton.setAttribute("aria-expanded", "false");
      categoryButton.focus();
    });
  };
  addDropdown("Products", "nav-products", "Browse product categories", productCategories.map(category => [
    category, `products.html?category=${encodeURIComponent(category)}`
  ]));
  addDropdown("Services", "nav-services", "Browse product guidance and support", [
    ["Computer purchase guidance", "services.html#computer-sales"],
    ["Hardware enquiries", "services.html#hardware-guidance"],
    ["Warranty information", "services.html#warranty-information"]
  ]);
  nav.querySelectorAll(".nav-products, .nav-services").forEach(group => {
    document.addEventListener("click", event => {
      if (group.contains(event.target)) return;
      const menu = group.querySelector(".nav-dropdown");
      const button = group.querySelector(".nav-dropdown-toggle");
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    });
  });
  nav.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation menu");
      nav.classList.remove("is-open");
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    nav.querySelectorAll(".nav-products, .nav-services").forEach(group => {
      const menu = group.querySelector(".nav-dropdown");
      const button = group.querySelector(".nav-dropdown-toggle");
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    });
    if (toggle.getAttribute("aria-expanded") === "true") {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation menu");
      nav.classList.remove("is-open");
      toggle.focus();
    }
  });
  const current = location.pathname.split("/").pop() || "index.html";
  nav.querySelectorAll("a").forEach(link => {
    if (link.getAttribute("href") === current) link.setAttribute("aria-current", "page");
  });
}

function setupHomeHero() {
  const header = document.querySelector(".home-header");
  const video = document.querySelector(".home-hero__video");
  if (header) {
    const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 24);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }
  if (!video || reducedMotion) return;
  fetch(video.dataset.videoSrc, { method: "HEAD" }).then(response => {
    if (!response.ok) {
      video.classList.add("is-unavailable");
      return;
    }
    video.addEventListener("error", () => video.classList.add("is-unavailable"), { once: true });
    video.src = video.dataset.videoSrc;
    return video.play().catch(() => video.classList.add("is-unavailable"));
  }).catch(() => video.classList.add("is-unavailable"));
}

function productWhatsAppUrl(product) {
  const number = String(businessWhatsAppNumber || "").replace(/\D/g, "");
  if (number.length < 8 || number.length > 15) return "";
  const productUrl = new URL(`product.html?id=${encodeURIComponent(product.id)}`, document.baseURI).href;
  const details = [
    `Hello AIG TECHNOLOGY, I am interested in this product: ${product.name}.`,
    product.model ? `Model: ${product.model}` : "",
    product.price !== undefined && product.price !== null && product.price !== "" ? `Listed price: ${formatPrice(product.price)}` : "",
    product.condition ? `Condition: ${product.condition}` : "",
    product.warranty ? `Warranty: ${product.warranty}` : "",
    `Product link: ${productUrl}`,
    "Please confirm current availability and any details not listed."
  ].filter(Boolean);
  return `https://wa.me/${number}?text=${encodeURIComponent(details.join("\n"))}`;
}

function setupWhatsAppContact(number) {
  const digits = String(number || "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15 || !document.querySelector(".site-footer")) return;
  let link = document.querySelector(".floating-whatsapp");
  if (!link) {
    link = document.createElement("a");
    link.className = "floating-whatsapp";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Chat with AIG TECHNOLOGY on WhatsApp (opens in a new tab)");
    link.innerHTML = '<span class="floating-whatsapp__mark" aria-hidden="true"><svg class="whatsapp-icon" viewBox="0 0 24 24"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.2A8 8 0 1 1 20 11.5Z"/><path d="M8.2 7.4c-.4.2-.7.6-.7 1.1 0 4.2 3.4 7.6 7.6 7.6.5 0 .9-.3 1.1-.7l.5-1.2-2.2-1-1 .9a8 8 0 0 1-3.2-3.2l.9-1-1-2.2z"/></svg></span><span>Chat on WhatsApp</span>';
    document.body.append(link);
  }
  link.href = `https://wa.me/${digits}?text=${encodeURIComponent("Hello AIG TECHNOLOGY, I have a product enquiry.")}`;
}

function setupReveals(root = document) {
  if (reducedMotion || !("IntersectionObserver" in window)) return;
  revealObserver ??= new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -32px 0px" });
  root.querySelectorAll(".section-heading, .info-card, .category-card, .cta-panel, .split > *, .product-card").forEach(element => {
    if (element.dataset.revealReady) return;
    element.dataset.revealReady = "true";
    element.classList.add("reveal");
    if (element.matches(".info-card, .category-card, .product-card")) element.classList.add("stagger-item");
    if (element.matches(".split > *")) element.classList.add(element.parentElement.children[1] === element ? "reveal-right" : "reveal-left");
    else element.classList.add("reveal-up");
    revealObserver.observe(element);
  });
  document.documentElement.classList.add("motion-ready");
}

function setupImageFallbacks(root) {
  root.querySelectorAll("img[data-product-image]").forEach(image => {
    image.addEventListener("error", () => {
      const placeholder = document.createElement("span");
      placeholder.className = "product-placeholder";
      placeholder.textContent = "Product image unavailable";
      placeholder.setAttribute("role", "img");
      placeholder.setAttribute("aria-label", `Product image unavailable for ${image.alt}`);
      image.replaceWith(placeholder);
    }, { once: true });
  });
}

function productCard(product) {
  const image = Array.isArray(product.images) ? product.images[0]?.url || product.images[0] : "";
  const imageAlt = Array.isArray(product.images) ? product.images[0]?.alt : "";
  const details = [product.brand, product.model].filter(Boolean).map(escapeHtml).join(" · ");
  const whatsappUrl = productWhatsAppUrl(product);
  return `<article class="product-card">
    <a class="product-image-wrap" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="View ${escapeHtml(product.name)}">
      ${image ? `<img class="product-card__image" data-product-image src="${escapeHtml(image)}" alt="${escapeHtml(imageAlt || product.name)}" loading="lazy">` : `<span class="product-placeholder" role="img" aria-label="Product image not provided for ${escapeHtml(product.name)}">Product image not provided</span>`}
    </a>
    <div class="product-body">
      <div class="product-badges"><span class="badge">${escapeHtml(product.condition || "Condition to be confirmed")}</span>${product.featured ? '<span class="badge badge-featured">Featured</span>' : ""}</div>
      <h3><a href="product.html?id=${encodeURIComponent(product.id)}">${escapeHtml(product.name)}</a></h3>
      <p class="product-meta">${details || "AIG TECHNOLOGY product"}</p>
      <p class="price">${product.price !== undefined && product.price !== null && product.price !== "" ? escapeHtml(formatPrice(product.price)) : '<span class="price-missing">Price on enquiry</span>'}</p>
      <p class="product-availability">${escapeHtml(product.availability || "Availability confirmed by enquiry")}</p>
      <div class="product-actions">
        <a class="button button-small" href="contact.html?product=${encodeURIComponent(product.id)}">Enquire Now <span class="product-card__actions-icon" aria-hidden="true">→</span></a>
        <a class="button button-secondary button-small" href="product.html?id=${encodeURIComponent(product.id)}">View Details</a>
        ${whatsappUrl ? `<a class="button button-whatsapp button-small" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Enquire about ${escapeHtml(product.name)} on WhatsApp"><svg class="whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.2A8 8 0 1 1 20 11.5Z"/><path d="M8.2 7.4c-.4.2-.7.6-.7 1.1 0 4.2 3.4 7.6 7.6 7.6.5 0 .9-.3 1.1-.7l.5-1.2-2.2-1-1 .9a8 8 0 0 1-3.2-3.2l.9-1-1-2.2z"/></svg> Buy on WhatsApp</a>` : ""}
      </div>
    </div>
  </article>`;
}

function showProductLoading(container) {
  container.innerHTML = `<span class="sr-only" role="status">Loading products…</span><div class="product-card" aria-hidden="true"><div class="loading-skeleton"></div></div><div class="product-card" aria-hidden="true"><div class="loading-skeleton"></div></div><div class="product-card" aria-hidden="true"><div class="loading-skeleton"></div></div><div class="product-card" aria-hidden="true"><div class="loading-skeleton"></div></div>`;
}

function showError(container, error) {
  container.innerHTML = `<div class="empty-state" role="status">${escapeHtml(error.message || "Products could not be loaded. Please try again later.")}</div>`;
}

async function loadProductGrid(container, options = {}) {
  if (!isFirebaseConfigured) {
    container.innerHTML = `<div class="empty-state">Product catalogue setup is pending. Please contact AIG TECHNOLOGY for current availability.</div>`;
    return [];
  }
  showProductLoading(container);
  try {
    const products = await getProducts(options);
    container.innerHTML = products.length ? products.map(productCard).join("") : `<div class="empty-state">No published products are available yet. Please check back later or contact us.</div>`;
    setupImageFallbacks(container);
    setupReveals(container);
    return products;
  } catch (error) {
    showError(container, error);
    return [];
  }
}

async function initProducts() {
  const grid = byId("product-grid");
  if (!grid) return;
  const products = await loadProductGrid(grid);
  const search = byId("filter-search");
  const category = byId("filter-category");
  const brand = byId("filter-brand");
  const condition = byId("filter-condition");
  const sort = byId("filter-sort");
  const apply = () => {
    const term = (search?.value || "").trim().toLowerCase();
    const selectedCategory = String(category?.value || "").trim().toLowerCase();
    const list = products.filter(product => {
      const searchable = [product.name, product.brand, product.model, product.category, product.sku].join(" ").toLowerCase();
      return searchable.includes(term) &&
        (!selectedCategory || String(product.category || "").trim().toLowerCase() === selectedCategory) &&
        (!brand?.value || product.brand === brand.value) &&
        (!condition?.value || product.condition === condition.value);
    });
    if (sort?.value === "name") list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (sort?.value === "price-asc") list.sort((a, b) => Number(a.price ?? Infinity) - Number(b.price ?? Infinity));
    if (sort?.value === "price-desc") list.sort((a, b) => Number(b.price ?? -Infinity) - Number(a.price ?? -Infinity));
    grid.innerHTML = list.length ? list.map(productCard).join("") : `<div class="empty-state">No products match these filters.</div>`;
    setupImageFallbacks(grid);
    setupReveals(grid);
  };
  const distinct = key => [...new Set(products.map(item => item[key]).filter(Boolean))].sort();
  const categories = [...new Map(products
    .map(product => String(product.category || "").trim())
    .filter(Boolean)
    .map(value => [value.toLowerCase(), value])).values()].sort((a, b) => a.localeCompare(b));
  for (const [select, values, label] of [[category, categories, "All categories"], [brand, distinct("brand"), "All brands"], [condition, distinct("condition"), "All conditions"]]) {
    if (!select) continue;
    select.innerHTML = `<option value="">${label}</option>` + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  }
  const requestedCategory = new URLSearchParams(location.search).get("category");
  if (requestedCategory && category) {
    const normalizedRequest = requestedCategory.trim().toLowerCase();
    const matchingCategory = categories.find(value => value.toLowerCase() === normalizedRequest);
    if (matchingCategory) {
      category.value = matchingCategory;
    } else {
      const option = document.createElement("option");
      option.value = requestedCategory;
      option.textContent = requestedCategory;
      category.append(option);
      category.value = requestedCategory;
    }
  }
  apply();
  [search, category, brand, condition, sort].forEach(control => control?.addEventListener("input", apply));
  [category, brand, condition, sort].forEach(control => control?.addEventListener("change", apply));
}

async function initProductDetails() {
  const target = byId("product-detail");
  if (!target) return;
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    target.innerHTML = `<div class="empty-state">No product was selected. <a href="products.html">Browse the catalogue</a>.</div>`;
    return;
  }
  if (!isFirebaseConfigured) {
    target.innerHTML = `<div class="empty-state">Product details are unavailable until the catalogue is configured.</div>`;
    return;
  }
  target.innerHTML = `<div class="loading-state">Loading product details…</div>`;
  try {
    const product = await getProductById(id);
    if (!product) {
      target.innerHTML = `<div class="empty-state">This product is no longer available. <a href="products.html">Browse current products</a>.</div>`;
      return;
    }
    const images = Array.isArray(product.images) ? product.images.map(image => {
      if (typeof image === "string") return { url: image, alt: product.name };
      if (!image || typeof image.url !== "string") return null;
      return { url: image.url, alt: image.alt || product.name };
    }).filter(Boolean) : [];
    const specifications = product.specifications && typeof product.specifications === "object" ? Object.entries(product.specifications) : [];
    target.innerHTML = `<div class="detail-layout">
      <div class="detail-gallery">
        <div class="detail-photo">${images.length ? `<img data-product-image data-gallery-main src="${escapeHtml(images[0].url)}" alt="${escapeHtml(images[0].alt)}">` : `<span class="product-placeholder">Product image not provided</span>`}</div>
        ${images.length > 1 ? `<div class="detail-thumbnails" aria-label="More product images">${images.map((image, index) => `<button class="detail-thumbnail${index === 0 ? " is-selected" : ""}" type="button" data-gallery-index="${index}" aria-label="View image ${index + 1} of ${images.length}" aria-pressed="${index === 0}"><img data-product-image src="${escapeHtml(image.url)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div>
        <span class="badge">${escapeHtml(product.condition || "Condition to be confirmed")}</span>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="product-meta">${[product.brand, product.model, product.sku ? `SKU ${product.sku}` : ""].filter(Boolean).map(escapeHtml).join(" · ")}</p>
        <p class="price">${product.price !== undefined && product.price !== null && product.price !== "" ? escapeHtml(formatPrice(product.price)) : '<span class="price-missing">Price on enquiry</span>'}</p>
        ${specifications.length ? `<h2>Specifications</h2><dl class="spec-list">${specifications.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>` : ""}
        <p class="product-description">${escapeHtml(product.description || "Contact us for product details.")}</p>
        <p><strong>Availability:</strong> ${escapeHtml(product.availability || "Please enquire")}</p>
        ${product.warranty ? `<p><strong>Warranty:</strong> ${escapeHtml(product.warranty)}</p>` : ""}
        <a class="button" href="contact.html?product=${encodeURIComponent(product.id)}">Enquire about this product</a>
        ${productWhatsAppUrl(product) ? `<a class="button button-whatsapp" href="${escapeHtml(productWhatsAppUrl(product))}" target="_blank" rel="noopener noreferrer"><svg class="whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.2A8 8 0 1 1 20 11.5Z"/><path d="M8.2 7.4c-.4.2-.7.6-.7 1.1 0 4.2 3.4 7.6 7.6 7.6.5 0 .9-.3 1.1-.7l.5-1.2-2.2-1-1 .9a8 8 0 0 1-3.2-3.2l.9-1-1-2.2z"/></svg> Buy on WhatsApp</a>` : ""}
      </div>
    </div>`;
    const mainImage = target.querySelector("[data-gallery-main]");
    const thumbnails = [...target.querySelectorAll("[data-gallery-index]")];
    let currentImageIndex = 0;
    const showImage = index => {
      const image = images[index];
      if (!image || !mainImage) return;
      const animateChange = index !== currentImageIndex && !reducedMotion && mainImage.src;
      if (animateChange) {
        target.querySelectorAll(".detail-photo__outgoing").forEach(previous => previous.remove());
        const outgoingImage = mainImage.cloneNode();
        outgoingImage.removeAttribute("data-gallery-main");
        outgoingImage.removeAttribute("data-product-image");
        outgoingImage.removeAttribute("id");
        outgoingImage.className = "detail-photo__outgoing";
        outgoingImage.setAttribute("aria-hidden", "true");
        mainImage.parentElement.append(outgoingImage);
        outgoingImage.addEventListener("animationend", () => outgoingImage.remove(), { once: true });
        mainImage.classList.remove("gallery-entering");
      }
      currentImageIndex = index;
      mainImage.src = image.url;
      mainImage.alt = image.alt;
      if (animateChange) {
        void mainImage.offsetWidth;
        mainImage.classList.add("gallery-entering");
        mainImage.addEventListener("animationend", () => mainImage.classList.remove("gallery-entering"), { once: true });
      }
      thumbnails.forEach((thumbnail, thumbnailIndex) => {
        const selected = thumbnailIndex === index;
        thumbnail.classList.toggle("is-selected", selected);
        thumbnail.setAttribute("aria-pressed", String(selected));
      });
    };
    thumbnails.forEach(button => button.addEventListener("click", () => {
      showImage(Number(button.dataset.galleryIndex));
    }));
    if (images.length > 1 && !reducedMotion) {
      const gallery = target.querySelector(".detail-gallery");
      window.setInterval(() => {
        if (document.hidden || gallery.matches(":hover, :focus-within")) return;
        showImage((currentImageIndex + 1) % images.length);
      }, 4000);
    }
    setupImageFallbacks(target);
    setupReveals(target);
  } catch (error) { showError(target, error); }
}

async function initServiceEnquiry() {
  const form = byId("service-enquiry-form");
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const status = byId("service-enquiry-status");
    const button = form.querySelector('[type="submit"]');
    const fields = new FormData(form);
    if (String(fields.get("companyWebsite") || "").trim()) return;
    const data = {
      name: String(fields.get("name") || "").trim(),
      phone: String(fields.get("phone") || "").trim(),
      email: String(fields.get("email") || "").trim(),
      serviceCategory: String(fields.get("serviceCategory") || "").trim(),
      description: String(fields.get("description") || "").trim(),
      brand: String(fields.get("brand") || "").trim(),
      model: String(fields.get("model") || "").trim(),
      preferredContactMethod: String(fields.get("preferredContactMethod") || "").trim()
    };
    if (data.name.length < 2 || data.name.length > 100) {
      status.textContent = "Enter your name (2–100 characters).";
      status.dataset.state = "error";
      form.elements.name.focus();
      return;
    }
    if (data.phone.replace(/\D/g, "").length < 7 || data.phone.length > 25) {
      status.textContent = "Enter a valid phone number.";
      status.dataset.state = "error";
      form.elements.phone.focus();
      return;
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      status.textContent = "Enter a valid email address or leave it blank.";
      status.dataset.state = "error";
      form.elements.email.focus();
      return;
    }
    if (!data.serviceCategory || data.description.length < 10 || data.description.length > 1800 || !fields.has("consent")) {
      status.textContent = "Choose a service enquiry type, describe your needs in at least 10 characters, and provide consent.";
      status.dataset.state = "error";
      return;
    }
    button.disabled = true;
    status.textContent = "Sending your service enquiry…";
    status.dataset.state = "";
    try {
      await submitServiceEnquiry(data);
      form.reset();
      status.textContent = "Thank you. Your service enquiry has been received.";
      status.dataset.state = "success";
    } catch (error) {
      status.textContent = "We could not send your enquiry. Please try again shortly.";
      status.dataset.state = "error";
      console.error("Service enquiry submission failed:", error);
    } finally {
      button.disabled = false;
    }
  });
}

async function initContact() {
  const form = byId("enquiry-form");
  if (!form) return;
  const params = new URLSearchParams(location.search);
  const productId = params.get("product");
  const productField = byId("product-reference");
  if (productField && productId) productField.value = productId;
  const productNameField = byId("product-name");
  if (productId && isFirebaseConfigured) {
    try {
      const product = await getProductById(productId);
      if (product && productNameField) productNameField.value = product.name;
    } catch (error) {
      console.warn("Optional product reference could not be loaded:", error);
    }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const status = byId("enquiry-status");
    const button = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    if (String(data.get("companyWebsite") || "").trim()) return;
    const name = String(data.get("name") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const email = String(data.get("email") || "").trim();
    const message = String(data.get("message") || "").trim();
    const consent = data.get("consent") === "on";
    if (name.length < 2 || name.length > 100 || phone.length < 7 || phone.length > 25 || message.length < 10 || message.length > 2000 || !consent || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      status.textContent = "Please check your details, message, and consent before submitting.";
      status.dataset.state = "error";
      return;
    }
    button.disabled = true;
    status.textContent = "Sending your enquiry…";
    status.dataset.state = "";
    try {
      await submitEnquiry({
        name, phone, email, message,
        productId: String(data.get("productId") || "").slice(0, 100),
        productName: String(data.get("productName") || "").slice(0, 150)
      });
      form.reset();
      status.textContent = "Thank you. Your enquiry has been received.";
      status.dataset.state = "success";
    } catch (error) {
      status.textContent = error.message.includes("Firebase is not configured")
        ? "Enquiry submission is not configured yet. Please use the business contact details once added."
        : "We could not send your enquiry. Please try again shortly.";
      status.dataset.state = "error";
      console.error("Enquiry submission failed:", error);
    } finally { button.disabled = false; }
  });
}

async function initSettings() {
  let settings = {};
  try {
    settings = await getPublicSettings();
  } catch (error) {
    console.warn("Public website settings could not be loaded:", error);
  }
  businessWhatsAppNumber = String(settings.whatsappNumber || businessContactConfig.whatsappNumber || "").replace(/\D/g, "");
  document.querySelectorAll('a[href^="https://wa.me/"]').forEach(link => {
    const url = new URL(link.href);
    url.pathname = `/${businessWhatsAppNumber}`;
    link.href = url.href;
  });
  const banner = document.querySelector(".announcement-banner");
  if (banner) {
    banner.hidden = settings.announcementEnabled === false;
    const text = String(settings.announcementText || "").trim();
    if (text) banner.querySelector("[data-announcement-text]").textContent = text;
  }
  document.querySelectorAll("[data-setting]").forEach(element => {
    const key = element.dataset.setting;
    const value = settings[key];
    if (!value) return;
    if (element.dataset.href === "tel") element.href = `tel:${String(value).replace(/[^\d+]/g, "")}`;
    else if (element.dataset.href === "mailto") element.href = `mailto:${value}`;
    else element.textContent = value;
    element.hidden = false;
  });
  document.querySelectorAll("[data-whatsapp]").forEach(element => {
    const number = businessWhatsAppNumber;
    if (!number) return;
    element.href = `https://wa.me/${number}`;
    element.hidden = false;
  });
  setupWhatsAppContact(businessWhatsAppNumber);
  const footerBrand = document.querySelector(".footer-brand");
  if (footerBrand && (settings.publicEmail || settings.publicPhone) && !footerBrand.querySelector("[data-setting='publicEmail'], [data-setting='publicPhone']")) {
    const contact = document.createElement("p");
    contact.className = "footer-note";
    for (const [key, label, hrefType] of [["publicEmail", "Email AIG TECHNOLOGY", "mailto"], ["publicPhone", "Call AIG TECHNOLOGY", "tel"]]) {
      if (!settings[key]) continue;
      const link = document.createElement("a");
      link.textContent = label;
      link.href = hrefType === "mailto" ? `mailto:${settings[key]}` : `tel:${String(settings[key]).replace(/[^\d+]/g, "")}`;
      contact.append(link, document.createTextNode(" "));
    }
    footerBrand.append(contact);
  }
  document.querySelectorAll("[data-year]").forEach(element => { element.textContent = String(new Date().getFullYear()); });
}

setupAnnouncement();
setupNavigation();
setupHomeHero();
setupReveals();
setupWhatsAppContact(businessWhatsAppNumber);
initSettings().catch(error => console.error("Public settings initialization failed:", error));
initProducts();
initProductDetails();
initContact();
initServiceEnquiry();
const featured = byId("featured-products");
if (featured) loadProductGrid(featured, { featured: true, max: 4 });
