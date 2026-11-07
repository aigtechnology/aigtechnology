const CART_KEY = "aigTechnologyCart";
const MAX_QUANTITY = 10;

export function readCart() {
  const raw = localStorage.getItem(CART_KEY);
  if (!raw) return [];
  const cart = JSON.parse(raw);
  if (!Array.isArray(cart) || cart.some(item =>
    !item || typeof item.sku !== "string" || !Number.isInteger(item.quantity) ||
    item.quantity < 1 || item.quantity > MAX_QUANTITY
  )) {
    throw new Error("Your saved cart is invalid. Remove the affected browser storage entry or add your products again.");
  }
  return cart;
}

function writeCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  window.dispatchEvent(new CustomEvent("aig-cart-updated", { detail: cart }));
}

export function addCartItem(item) {
  if (!item.sku) throw new Error("This item does not have a checkout SKU.");
  const cart = readCart();
  const existing = cart.find(entry => entry.sku === item.sku);
  if (existing) {
    if (existing.quantity >= MAX_QUANTITY) throw new Error(`You can add up to ${MAX_QUANTITY} units of an item.`);
    existing.quantity += 1;
    existing.name = item.name;
    existing.image = item.image || "";
  } else {
    cart.push({ sku: item.sku, name: item.name, image: item.image || "", quantity: 1 });
  }
  writeCart(cart);
  return cart.reduce((total, entry) => total + entry.quantity, 0);
}

export function updateCartItem(sku, quantity) {
  const nextQuantity = Number(quantity);
  if (!Number.isInteger(nextQuantity) || nextQuantity < 1 || nextQuantity > MAX_QUANTITY) {
    throw new Error(`Choose a quantity between 1 and ${MAX_QUANTITY}.`);
  }
  const cart = readCart().map(item => item.sku === sku ? { ...item, quantity: nextQuantity } : item);
  writeCart(cart);
}

export function removeCartItem(sku) {
  writeCart(readCart().filter(item => item.sku !== sku));
}

export function clearCart() {
  writeCart([]);
}

export function cartItemCount() {
  return readCart().reduce((total, item) => total + item.quantity, 0);
}
