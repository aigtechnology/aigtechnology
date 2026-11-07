export const icons = {
  grid: "▦", orders: "▤", returns: "↩", inventory: "▥", finance: "₹", analytics: "◔", bell: "●", settings: "⚙"
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

export function navigation(active = "dashboard") {
  const item = (key, label, icon, href) => `<a href="${href}" ${active === key ? 'aria-current="page"' : ""}><span aria-hidden="true">${icon}</span>${label}</a>`;
  return `<nav class="admin-nav" aria-label="Administration">
    ${item("dashboard", "Dashboard", icons.grid, "operations.html")}
    <div class="admin-nav-section">Flipkart</div>
    ${item("orders", "Orders", icons.orders, "orders.html")}
    ${item("returns", "Returns", icons.returns, "returns.html")}
    ${item("inventory", "Inventory", icons.inventory, "inventory.html")}
    ${item("settlements", "Settlements", icons.finance, "settlements.html")}
    <div class="admin-nav-section">Management</div>
    ${item("analytics", "Business Analytics", icons.analytics, "analytics.html")}
    ${item("notifications", "Notifications", icons.bell, "notifications.html")}
    ${item("settings", "Settings", icons.settings, "settings.html")}
    <div class="admin-nav-section">Website</div>
    ${item("site-admin", "Product & Site Management", icons.settings, "index.html")}
  </nav>`;
}

export function shell({ active, title, content }) {
  return `<div class="admin-layout"><aside class="admin-sidebar"><a class="admin-brand" href="operations.html"><img src="../assets/images/aig-technology-logo.jpeg" alt=""> AIG TECHNOLOGY</a>${navigation(active)}</aside><div class="admin-content"><header class="admin-topbar"><h1>${title}</h1><div class="admin-user">Administrator <button class="button ghost" id="logout-button" type="button">Logout</button></div></header><main class="admin-main">${content}</main></div></div>`;
}

export function stat(label, value, change = "") { return `<article class="stat-card"><span class="stat-card__label">${label}</span><strong class="stat-card__value">${value}</strong>${change ? `<span class="stat-card__change">${change}</span>` : ""}</article>`; }
