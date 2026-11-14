import { API_BASE_URL } from "./api-config.js?v=20261114-public-api";

export async function backendRequest(path, { headers = {}, ...options } = {}) {
  if (!API_BASE_URL) throw new Error("The production API URL has not been configured.");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...headers }
  });
  let payload = null;
  if (response.status !== 204) {
    payload = await response.json().catch(() => null);
  }
  if (!response.ok) {
    const detail = payload?.detail;
    throw new Error(typeof detail === "string" ? detail : `Request failed (${response.status})`);
  }
  return payload;
}

export function saveCatalogProduct(catalogId, product, idToken) {
  const firstImage = Array.isArray(product.images) ? product.images[0] : null;
  return backendRequest("/catalog/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      catalog_id: catalogId,
      sku: product.sku || "",
      name: product.name,
      price: product.price,
      stock_quantity: product.stockQuantity,
      published: product.published,
      image_url: typeof firstImage === "string" ? firstImage : firstImage?.url || null
    })
  });
}

export function archiveCatalogProduct(catalogId, idToken) {
  return backendRequest(`/catalog/${encodeURIComponent(catalogId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` }
  });
}
