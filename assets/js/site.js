import { getProductById, getProducts, getPublicSettings, submitEnquiry } from "./firestore.js?v=20261025-retailer";
import { backendRequest } from "./backend-api.js?v=20261114-services";
import { uploadProductImage } from "./cloudinary.js";
import { isFirebaseConfigured } from "./firebase-client.js";
import { businessContactConfig } from "./firebase-config.js";
import { addCartItem, cartItemCount } from "./cart-store.js";
import { readVerifiedPurchase } from "./purchase-verification.js?v=20261114-purchase";

const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const formatPrice = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value)) : "";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let businessWhatsAppNumber = businessContactConfig.whatsappNumber;
let revealObserver;

const defaultProductCategories = [
  "Desktop Computers", "Mini PCs", "Keyboards and Mice",
  "SSDs and Storage", "RAM and Components", "Computer Accessories"
];
let productCategories = defaultProductCategories;

function renderMobileCategoryRail() {
  const rail = byId("mobile-category-nav");
  if (!rail) return;
  const selectedCategory = (new URLSearchParams(location.search).get("category") || "").trim().toLowerCase();
  rail.replaceChildren(...productCategories.map((category, index) => {
    const link = document.createElement("a");
    const isActive = selectedCategory ? category.toLowerCase() === selectedCategory : index === 0;
    link.className = `mobile-category${isActive ? " is-active" : ""}`;
    link.href = index === 0 ? "products.html" : `products.html?category=${encodeURIComponent(category)}`;
    const categoryLabel = index === 0 ? "FOR YOU" : category.toUpperCase();
    link.innerHTML = `<span class="mobile-category__icon" aria-hidden="true">${escapeHtml(category.split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase())}</span><span>${escapeHtml(categoryLabel)}</span>`;
    return link;
  }));
}

function renderProductCategories(categories) {
  productCategories = [...new Set(categories
    .map(category => typeof category === "string" ? category.trim() : "")
    .filter(Boolean))];
  const menu = document.querySelector(".nav-products .nav-dropdown");
  if (menu) {
    menu.replaceChildren(...productCategories.map(category => {
      const link = document.createElement("a");
      link.href = `products.html?category=${encodeURIComponent(category)}`;
      link.textContent = category;
      return link;
    }));
  }
  const grid = document.querySelector(".category-grid");
  if (grid) {
    grid.replaceChildren(...productCategories.map(category => {
      const link = document.createElement("a");
      link.className = "category-card";
      link.href = `products.html?category=${encodeURIComponent(category)}`;
      const mark = document.createElement("span");
      mark.className = "category-card__mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = category.split(/\s+/).map(word => word[0]).join("").slice(0, 3).toUpperCase();
      const label = document.createElement("span");
      label.className = "category-card__label";
      label.textContent = category;
      const arrow = document.createElement("span");
      arrow.className = "category-card__arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      link.append(mark, label, arrow);
      return link;
    }));
  }
  renderMobileCategoryRail();
}

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
  if (!nav.querySelector('a[href="cart.html"]')) {
    const cartLink = document.createElement("a");
    cartLink.href = "cart.html";
    cartLink.innerHTML = 'Cart <span class="cart-count" id="cart-count" aria-label="items in cart">0</span>';
    const productsGroup = nav.querySelector(".nav-products");
    (productsGroup || nav.lastElementChild).after(cartLink);
  }
  const refreshCartBadge = () => {
    const badge = byId("cart-count");
    if (!badge) return;
    try {
      badge.textContent = String(cartItemCount());
    } catch (error) {
      badge.textContent = "!";
      badge.title = error.message;
      console.error("Could not read the shopping cart:", error);
    }
  };
  refreshCartBadge();
  window.addEventListener("aig-cart-updated", refreshCartBadge);
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

function setupMobileSearch() {
  let form = byId("mobile-search-form");
  if (!form && document.querySelector(".site-header") && document.querySelector("main")) {
    const tools = document.createElement("section");
    tools.className = "mobile-shopping-tools";
    tools.setAttribute("aria-label", "Shop AIG TECHNOLOGY");
    tools.innerHTML = '<div class="container"><form class="mobile-search" id="mobile-search-form" action="products.html" role="search"><label class="sr-only" for="mobile-search-input">Search for products, brands</label><span class="mobile-search__icon" aria-hidden="true">⌕</span><input id="mobile-search-input" name="q" type="search" placeholder="Search for products, brands..." autocomplete="off"><button class="mobile-search__clear" id="mobile-search-clear" type="button" aria-label="Clear search" hidden>×</button><button class="mobile-search__submit" type="submit" aria-label="Search">Search</button></form><nav class="mobile-category-rail" id="mobile-category-nav" aria-label="Shop by category"></nav></div>';
    document.querySelector(".site-header").after(tools);
    form = tools.querySelector("#mobile-search-form");
  }
  const input = byId("mobile-search-input");
  const clear = byId("mobile-search-clear");
  if (!form || !input) return;
  const updateClear = () => { if (clear) clear.hidden = !input.value; };
  input.addEventListener("input", updateClear);
  clear?.addEventListener("click", () => { input.value = ""; updateClear(); input.focus(); });
  form.addEventListener("submit", () => {
    input.value = input.value.trim();
    if (!input.value) return;
    form.action = "products.html";
  });
  updateClear();
}

function setupMobileBottomNav() {
  if (document.querySelector(".mobile-bottom-nav") || !document.querySelector(".site-footer")) return;
  const nav = document.createElement("nav");
  nav.className = "mobile-bottom-nav";
  nav.setAttribute("aria-label", "Mobile shopping navigation");
  nav.innerHTML = `<a href="index.html" data-mobile-tab="home"><span aria-hidden="true">⌂</span><small>Home</small></a><a href="index.html#mobile-categories" data-mobile-tab="categories"><span aria-hidden="true">▦</span><small>Categories</small></a><a href="products.html#filter-search" data-mobile-tab="search"><span aria-hidden="true">⌕</span><small>Search</small></a><a href="cart.html" data-mobile-tab="cart"><span aria-hidden="true">🛒<b class="mobile-bottom-nav__badge" id="mobile-cart-count">0</b></span><small>Cart</small></a><a href="customer-account.html" data-mobile-tab="account"><span aria-hidden="true">♙</span><small>Account</small></a>`;
  document.body.append(nav);
  const current = location.pathname.split("/").pop() || "index.html";
  const active = current === "index.html" ? "home" : current === "products.html" || current === "product.html" ? "categories" : current === "cart.html" || current === "checkout.html" ? "cart" : current.includes("customer") ? "account" : "";
  nav.querySelector(`[data-mobile-tab="${active}"]`)?.classList.add("is-active");
  const refresh = () => {
    const badge = byId("mobile-cart-count");
    if (badge) badge.textContent = String(cartItemCount());
  };
  try { refresh(); } catch { /* cart store may not be initialized on a non-shopping page */ }
  window.addEventListener("aig-cart-updated", refresh);
  nav.querySelector('[data-mobile-tab="search"]')?.addEventListener("click", event => {
    const search = byId("mobile-search-input") || byId("filter-search");
    if (search && current === "products.html") {
      event.preventDefault();
      search.focus();
      search.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
      return;
    }
    if (!search) return;
    event.preventDefault();
    window.location.href = "products.html#filter-search";
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
  let toggle = document.querySelector("[data-media-toggle]");
  let status = document.querySelector("[data-media-status]");
  if (video && !toggle) {
    const controls = document.createElement("div");
    controls.className = "home-hero__media-controls";
    controls.setAttribute("aria-label", "Video controls");
    controls.innerHTML = '<button class="home-hero__media-button" type="button" data-media-toggle aria-label="Pause introduction video">Pause</button><span class="home-hero__media-status" data-media-status>Introduction</span>';
    video.parentElement.append(controls);
    toggle = controls.querySelector("[data-media-toggle]");
    status = controls.querySelector("[data-media-status]");
  }
  if (toggle && video) {
    toggle.addEventListener("click", () => {
      if (video.paused) {
        video.play().catch(() => {});
        toggle.textContent = "Pause";
        toggle.setAttribute("aria-label", "Pause introduction video");
        if (status) status.textContent = "Playing";
      } else {
        video.pause();
        toggle.textContent = "Play";
        toggle.setAttribute("aria-label", "Play introduction video");
        if (status) status.textContent = "Paused";
      }
    });
  }
  if (!video || reducedMotion) return;
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }), { threshold: 0.2 });
    observer.observe(video);
  }
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

function cartButton(product) {
  if (!product.sku || Number(product.price) <= 0 || Number(product.stockQuantity) <= 0) return "";
  const image = Array.isArray(product.images) ? product.images[0]?.url || product.images[0] : "";
  const attributes = `data-sku="${escapeHtml(product.sku)}" data-name="${escapeHtml(product.name)}"
    data-image="${escapeHtml(typeof image === "string" ? image : "")}"`;
  return `<button class="button button-small" type="button" data-add-cart ${attributes}>Add to cart</button>
    <button class="button button-small button-buy-now" type="button" data-buy-now ${attributes}>Buy now</button>`;
}

function upgradeOptions(product) {
  const source = product.upgradeOptions && typeof product.upgradeOptions === "object" ? product.upgradeOptions : {};
  return Object.fromEntries(["ram", "hdd", "ssd", "combined"].map(type => [type,
    Array.isArray(source[type]) ? source[type].filter(option => option && option.id && option.label && option.available !== false) : []
  ]));
}

function canPurchaseProduct(product) {
  return Boolean(product?.sku && Number(product.price) > 0 && Number(product.stockQuantity) > 0);
}

function productConfigurator(product) {
  const options = upgradeOptions(product);
  if (!canPurchaseProduct(product) || !Object.values(options).some(list => list.length)) return "";
  const select = (type, label) => options[type].length ? `<label class="configurator-field"><span>${label}</span><select data-upgrade-select="${type}"><option value="">Choose ${label.toLowerCase()}</option>${options[type].map(option => `<option value="${escapeHtml(option.id)}" data-price="${escapeHtml(option.price || 0)}">${escapeHtml(option.label)}${Number(option.price || 0) ? ` (+${escapeHtml(formatPrice(option.price))})` : " (Included)"}</option>`).join("")}</select></label>` : "";
  return `<section class="product-configurator" data-product-configurator><h2>Customize Your Configuration</h2><p class="configurator-help">Choose only the upgrades supported by this product. Prices are verified again at checkout.</p><div class="configurator-grid">${select("ram", "RAM")}${select("hdd", "HDD")}${select("ssd", "SSD")}${select("combined", "RAM + SSD package")}</div><div class="configurator-summary" data-configurator-summary>Base price: ${escapeHtml(formatPrice(product.price))}</div><button class="button button-secondary button-small" type="button" data-configurator-reset>Reset to default</button></section>`;
}

function setupProductConfigurator(root, product) {
  const panel = root.querySelector("[data-product-configurator]");
  if (!panel) return;
  const selects = [...panel.querySelectorAll("[data-upgrade-select]")];
  const base = Number(product.price || 0);
  const image = Array.isArray(product.images) ? product.images[0]?.url || product.images[0] : "";
  const update = () => {
    const combined = selects.find(select => select.dataset.upgradeSelect === "combined");
    if (combined?.value) selects.filter(select => select !== combined).forEach(select => { select.value = ""; select.disabled = true; });
    else selects.forEach(select => { if (select !== combined) select.disabled = false; });
    const chosen = selects.filter(select => select.value).map(select => ({ type: select.dataset.upgradeSelect, id: select.value, label: select.selectedOptions[0].textContent.replace(/\s*\([^)]*\)$/, ""), price: Number(select.selectedOptions[0].dataset.price || 0) }));
    const extra = chosen.reduce((sum, option) => sum + option.price, 0);
    const summary = panel.querySelector("[data-configurator-summary]");
    summary.innerHTML = `<strong>Final price: ${escapeHtml(formatPrice(base + extra))}</strong>${chosen.length ? `<span>${chosen.map(option => `${escapeHtml(option.label)} (+${escapeHtml(formatPrice(option.price))})`).join(" · ")}</span>` : "<span>No upgrade selected</span>"}`;
    const configuration = Object.fromEntries(chosen.map(option => [option.type, option.id]));
    panel.dataset.configuration = JSON.stringify(configuration);
  };
  selects.forEach(select => select.addEventListener("change", update));
  panel.querySelector("[data-configurator-reset]")?.addEventListener("click", () => { selects.forEach(select => { select.value = ""; select.disabled = false; }); update(); });
  root.querySelectorAll("[data-configured-add], [data-configured-buy]").forEach(button => button.addEventListener("click", () => {
    try {
      addCartItem({ sku: product.sku, name: product.name, image, configuration: JSON.parse(panel.dataset.configuration || "{}") });
      if (button.hasAttribute("data-configured-buy")) window.location.href = "checkout.html";
      else button.textContent = "Added to cart";
    } catch (error) { button.textContent = error.message; }
  }));
  update();
}

function setupCartActions(root) {
  root.querySelectorAll("[data-add-cart], [data-buy-now]").forEach(button => button.addEventListener("click", () => {
    try {
      addCartItem({
        sku: button.dataset.sku,
        name: button.dataset.name,
        image: button.dataset.image
      });
      if (button.hasAttribute("data-buy-now")) {
        window.location.href = "checkout.html";
      } else {
        button.textContent = "Added to cart";
      }
    } catch (error) {
      button.textContent = error.message;
      button.setAttribute("aria-label", error.message);
    }
  }));
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
        ${cartButton(product)}
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
    setupCartActions(container);
    setupReveals(container);
    return products;
  } catch (error) {
    showError(container, error);
    return [];
  }
}

function renderProductList(container, products, emptyMessage) {
  container.innerHTML = products.length ? products.map(productCard).join("") : `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  setupImageFallbacks(container);
  setupCartActions(container);
  setupReveals(container);
}

async function initMobileCollections(products = null) {
  const collections = document.querySelector(".mobile-collections");
  if (!collections || !isFirebaseConfigured) return;
  try {
    const catalogue = products || await getProducts({ max: 200 });
    const available = catalogue.filter(product => product.sku && Number(product.price) > 0 && Number(product.stockQuantity) > 0);
    const best = [...available].sort((left, right) => Number(right.featured) - Number(left.featured) || String(left.name).localeCompare(String(right.name))).slice(0, 8);
    const accessories = available.filter(product => /accessor|component|keyboard|mouse|storage|ram|ssd|network/i.test(`${product.category || ""} ${product.name || ""}`)).slice(0, 8);
    renderProductList(collections.querySelector('[data-collection-rail="best"]'), best, "No available products are listed yet.");
    renderProductList(collections.querySelector('[data-collection-rail="accessories"]'), accessories, "No accessories are available right now.");
    if (!best.length && !accessories.length) collections.hidden = true;
  } catch (error) {
    collections.hidden = true;
    console.warn("Mobile product collections could not be loaded:", error);
  }
}

function renderPromotions(settings) {
  const banners = Array.isArray(settings.homepageBanners) ? settings.homepageBanners.filter(item => item && item.active !== false && (item.title || item.image)) : [];
  if (!banners.length) return;
  let section = byId("promo-banners");
  if (!section) {
    section = document.createElement("section");
    section.className = "section promo-section";
    section.id = "promo-banners";
    section.setAttribute("aria-labelledby", "promo-title");
    section.innerHTML = '<div class="container"><div class="section-heading"><p class="eyebrow">Offers</p><h2 id="promo-title">Latest from AIG Technology</h2></div><div class="promo-rail" data-promo-rail></div></div>';
    document.querySelector("#featured-products")?.closest("section")?.before(section);
  }
  const rail = section.querySelector("[data-promo-rail]");
  if (!rail) return;
  const cards = banners.map(banner => `<article class="promo-card">${banner.image ? (banner.href ? `<a class="promo-card__media-link" href="${escapeHtml(banner.href)}" aria-label="${escapeHtml(banner.title || "Explore AIG Technology")}"><img src="${escapeHtml(banner.image)}" alt="${escapeHtml(banner.title || "AIG Technology promotion")}" loading="lazy"></a>` : `<img src="${escapeHtml(banner.image)}" alt="${escapeHtml(banner.title || "AIG Technology promotion")}" loading="lazy">`) : ""}<div><p class="eyebrow">AIG TECHNOLOGY</p><h3>${escapeHtml(banner.title || "Explore our catalogue")}</h3>${banner.text ? `<p>${escapeHtml(banner.text)}</p>` : ""}${banner.href ? `<a class="button button-small" href="${escapeHtml(banner.href)}">Explore</a>` : ""}</div></article>`);
  if (rail._promoTimer) window.clearInterval(rail._promoTimer);
  rail.innerHTML = cards.length > 1 ? [cards[cards.length - 1], ...cards, cards[0]].join("") : cards.join("");
  if (cards.length > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const firstCard = rail.querySelector(".promo-card");
    const gap = parseFloat(getComputedStyle(rail).columnGap || "0");
    const cardStep = () => (firstCard?.getBoundingClientRect().width || 0) + gap;
    requestAnimationFrame(() => { rail.scrollLeft = cardStep(); });
    const normalize = () => {
      const step = cardStep();
      if (!step) return;
      if (rail.scrollLeft >= step * (cards.length + 1) - 2) rail.scrollTo({ left: step, behavior: "auto" });
      else if (rail.scrollLeft <= 1) rail.scrollTo({ left: step * cards.length, behavior: "auto" });
    };
    rail.addEventListener("scroll", normalize, { passive: true });
    rail._promoTimer = window.setInterval(() => {
      if (document.hidden || rail.matches(":hover") || rail.matches(":focus-within")) return;
      rail.scrollBy({ left: cardStep(), behavior: "smooth" });
    }, 4200);
  }
  section.hidden = false;
}

function renderHomepageVideos(settings) {
  const videos = Array.isArray(settings.homepageVideos)
    ? settings.homepageVideos.filter(item => item && item.active !== false && /^https:\/\//i.test(String(item.video || "")))
    : [];
  const existing = byId("homepage-videos");
  if (!videos.length) {
    if (existing) existing.remove();
    return;
  }
  let section = existing;
  if (!section) {
    section = document.createElement("section");
    section.className = "section homepage-video-section";
    section.id = "homepage-videos";
    section.setAttribute("aria-labelledby", "homepage-videos-title");
    section.innerHTML = '<div class="container"><div class="section-heading"><p class="eyebrow">AIG TECHNOLOGY</p><h2 id="homepage-videos-title">Explore our latest videos</h2></div><div class="homepage-video-rail" data-homepage-video-rail></div></div>';
    document.querySelector(".home-hero")?.after(section);
  }
  const rail = section.querySelector("[data-homepage-video-rail]");
  if (!rail) return;
  rail.innerHTML = videos.map(video => `<article class="homepage-video-card">${video.href ? `<a class="homepage-video-card__media-link" href="${escapeHtml(video.href)}" aria-label="${escapeHtml(video.title || "Explore AIG Technology")}"><video controls muted playsinline preload="metadata"${video.poster ? ` poster="${escapeHtml(video.poster)}"` : ""}><source src="${escapeHtml(video.video)}"></video></a>` : `<video controls muted playsinline preload="metadata"${video.poster ? ` poster="${escapeHtml(video.poster)}"` : ""}><source src="${escapeHtml(video.video)}"></video>`}${video.title ? `<h3>${escapeHtml(video.title)}</h3>` : ""}${video.href ? `<a class="button button-small" href="${escapeHtml(video.href)}">Explore</a>` : ""}</article>`).join("");
  section.hidden = false;
}

async function initProducts() {
  await settingsInitialization;
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
    setupCartActions(grid);
    setupReveals(grid);
  };
  const distinct = key => [...new Set(products.map(item => item[key]).filter(Boolean))].sort();
  const categories = [...new Map([...productCategories, ...products
    .map(product => String(product.category || "").trim())
  ].filter(Boolean)
    .map(value => [value.toLowerCase(), value])).values()].sort((a, b) => a.localeCompare(b));
  for (const [select, values, label] of [[category, categories, "All categories"], [brand, distinct("brand"), "All brands"], [condition, distinct("condition"), "All conditions"]]) {
    if (!select) continue;
    select.innerHTML = `<option value="">${label}</option>` + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  }
  const requestedCategory = new URLSearchParams(location.search).get("category");
  const requestedSearch = new URLSearchParams(location.search).get("q") || new URLSearchParams(location.search).get("search");
  if (requestedSearch && search) search.value = requestedSearch;
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
  if (location.hash === "#filter-search" && search) {
    window.setTimeout(() => { search.focus(); search.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" }); }, 0);
  }
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
    const specifications = product.specifications && typeof product.specifications === "object"
      ? Object.entries(product.specifications).filter(([key]) => !/upgrade|combined|package/i.test(key))
      : [];
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
        ${productConfigurator(product)}
        <p class="product-description">${escapeHtml(product.description || "Contact us for product details.")}</p>
        <p><strong>Availability:</strong> ${escapeHtml(product.availability || "Please enquire")}</p>
        ${product.warranty ? `<p><strong>Warranty:</strong> ${escapeHtml(product.warranty)}</p>` : ""}
        <div class="product-actions product-detail-actions">
          ${productConfigurator(product) ? `<button class="button button-small" type="button" data-configured-add>Add to cart</button><button class="button button-small button-buy-now" type="button" data-configured-buy>Buy now</button>` : cartButton(product)}
          <a class="button button-secondary" href="contact.html?product=${encodeURIComponent(product.id)}">Enquire about this product</a>
          ${productWhatsAppUrl(product) ? `<a class="button button-whatsapp" href="${escapeHtml(productWhatsAppUrl(product))}" target="_blank" rel="noopener noreferrer"><svg class="whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.2A8 8 0 1 1 20 11.5Z"/><path d="M8.2 7.4c-.4.2-.7.6-.7 1.1 0 4.2 3.4 7.6 7.6 7.6.5 0 .9-.3 1.1-.7l.5-1.2-2.2-1-1 .9a8 8 0 0 1-3.2-3.2l.9-1-1-2.2z"/></svg> Buy on WhatsApp</a>` : ""}
        </div>
      </div>
    </div>`;
    const mainImage = target.querySelector("[data-gallery-main]");
    setupProductConfigurator(target, product);
    setupCartActions(target);
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
  const verifiedPurchase = readVerifiedPurchase();
  if (!verifiedPurchase?.verified) {
    window.location.replace("customer-login.html?return=services.html");
    return;
  }
  const gate = document.createElement("p");
  gate.className = "notice notice-success";
  const verifiedPurchases = Array.isArray(verifiedPurchase.purchases) && verifiedPurchase.purchases.length
    ? verifiedPurchase.purchases
    : [verifiedPurchase];
  let selectedPurchase = verifiedPurchases[0];
  gate.textContent = `${verifiedPurchases.length} purchase record${verifiedPurchases.length === 1 ? "" : "s"} verified. Select the product you need help with below.`;
  form.before(gate);
  if (verifiedPurchases.length > 1) {
    const field = document.createElement("div");
    field.className = "field verified-purchase-picker";
    field.innerHTML = '<label for="verified-purchase">Purchased product *</label><select id="verified-purchase" name="verifiedPurchase" required></select>';
    const select = field.querySelector("select");
    verifiedPurchases.forEach((purchase, index) => {
      (purchase.products?.length ? purchase.products : [{ name: "Purchase" }]).forEach(product => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `${product.name || "Product"} · ${purchase.reference}`;
        select.append(option);
      });
    });
    form.querySelector(".form-grid")?.prepend(field);
    select.addEventListener("change", () => {
      selectedPurchase = verifiedPurchases[Number(select.value)] || verifiedPurchases[0];
    });
  }
  const syncVerifiedFields = () => {
    const referenceField = form.elements.purchaseReference;
    const mobileField = form.elements.purchaseMobile;
    if (referenceField) referenceField.value = selectedPurchase.reference || "";
    if (mobileField) mobileField.value = selectedPurchase.mobile || "";
  };
  syncVerifiedFields();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const status = byId("service-enquiry-status");
    const button = form.querySelector('[type="submit"]');
    const fields = new FormData(form);
    if (String(fields.get("companyWebsite") || "").trim()) return;
    const data = {
      customerName: String(fields.get("name") || "").trim(),
      phone: String(fields.get("phone") || "").trim(),
      email: String(fields.get("email") || "").trim(),
      serviceCategory: String(fields.get("serviceCategory") || "").trim(),
      deviceType: String(fields.get("deviceType") || "").trim(),
      brandModel: String(fields.get("brandModel") || "").trim(),
      description: String(fields.get("description") || "").trim(),
      address: String(fields.get("address") || "").trim(),
      preferredContactTime: String(fields.get("preferredContactTime") || "").trim(),
      purchaseType: selectedPurchase.invoice_type || selectedPurchase.source || "ONLINE",
      purchaseReference: selectedPurchase.reference || String(fields.get("purchaseReference") || "").trim(),
      purchaseMobile: String(selectedPurchase.mobile || fields.get("purchaseMobile") || "").replace(/\D/g, "")
    };
    const contactDigits = data.phone.replace(/\D/g, "");
    if (data.customerName.length < 2 || data.customerName.length > 100) {
      status.textContent = "Enter your name (2–100 characters).";
      status.dataset.state = "error";
      form.elements.name.focus();
      return;
    }
    if (!/^[6-9]\d{9}$/.test(contactDigits)) {
      status.textContent = "Enter a valid 10-digit Indian mobile number for contact.";
      status.dataset.state = "error";
      form.elements.phone.focus();
      return;
    }
    if (!/^[6-9]\d{9}$/.test(data.purchaseMobile)) {
      status.textContent = "Enter the 10-digit mobile number registered with that purchase.";
      status.dataset.state = "error";
      form.elements.purchaseMobile.focus();
      return;
    }
    if (!data.purchaseReference) {
      status.textContent = "Enter the invoice or order number for this purchase.";
      status.dataset.state = "error";
      form.elements.purchaseReference.focus();
      return;
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      status.textContent = "Enter a valid email address or leave it blank.";
      status.dataset.state = "error";
      form.elements.email.focus();
      return;
    }
    if (!data.serviceCategory || !data.deviceType || !data.address || !data.purchaseType || data.description.length < 10 || data.description.length > 1800 || !fields.has("consent")) {
      status.textContent = "Choose a service type and device, provide your address and describe the issue in at least 10 characters, then provide consent.";
      status.dataset.state = "error";
      return;
    }
    button.disabled = true;
    status.textContent = "Sending your service enquiry…";
    status.dataset.state = "";
    try {
      const imageFiles = [...(form.elements.images?.files || [])];
      const imageUrls = imageFiles.length ? (await Promise.all(imageFiles.slice(0, 6).map(file => uploadProductImage(file))).then(items => items.map(item => item.url))) : [];
      const result = await backendRequest("/service-requests", {
        method: "POST",
        body: JSON.stringify({
          customer_name: data.customerName,
          phone: contactDigits,
          email: data.email || null,
          service_category: data.serviceCategory,
          device_type: data.deviceType,
          brand_model: data.brandModel,
          problem_description: data.description,
          address: data.address,
          preferred_contact_time: data.preferredContactTime,
          image_urls: imageUrls,
          purchase_type: data.purchaseType,
          purchase_reference: data.purchaseReference,
          purchase_mobile: data.purchaseMobile
        })
      });
      form.reset();
      status.textContent = `Thank you. Your service request ${result.reference_id} has been received.${result.whatsapp_fallback_url ? " You may also contact the service department on WhatsApp." : ""}`;
      status.dataset.state = "success";
    } catch (error) {
      const detail = String(error?.message || "");
      const isPurchaseFailure = detail.toLowerCase().includes("purchase verification");
      status.textContent = isPurchaseFailure
        ? "We could not verify that purchase. Check the reference number and registered mobile number, then try again."
        : "We could not send your enquiry. Please try again shortly.";
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
  renderProductCategories(Array.isArray(settings.categories) && settings.categories.length
    ? settings.categories
    : defaultProductCategories);
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
  renderHomepageVideos(settings);
  renderPromotions(settings);
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

async function initHomepage() {
  const featured = byId("featured-products");
  if (!featured) return;
  if (!isFirebaseConfigured) {
    await initMobileCollections();
    return;
  }
  showProductLoading(featured);
  let products = [];
  try {
    products = await getProducts({ max: 200 });
    renderProductList(featured, products.filter(product => product.featured === true).slice(0, 4), "No featured products are available yet. Please browse the catalogue.");
  } catch (error) {
    showError(featured, error);
  }
  initMobileCollections(products);
}

setupAnnouncement();
setupNavigation();
setupMobileSearch();
setupMobileBottomNav();
setupHomeHero();
setupReveals();
setupWhatsAppContact(businessWhatsAppNumber);
const settingsInitialization = initSettings().catch(error => {
  renderProductCategories(defaultProductCategories);
  console.error("Public settings initialization failed:", error);
});
initProducts();
initProductDetails();
initContact();
initServiceEnquiry();
initHomepage();
