const HEADERS = ["firebase_document_id", "proposed_sku", "current_price", "stock_quantity"];
const SKU_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

function parseCsvRow(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  cells.push(value.trim());
  return cells;
}

export function validateCatalogImport(csv, products) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error("The mapping CSV must include a header and at least one product.");
  if (lines.length > 201) throw new Error("Import is limited to 200 products at a time.");
  const headers = parseCsvRow(lines[0]);
  if (headers.length !== HEADERS.length || headers.some((header, index) => header !== HEADERS[index])) {
    throw new Error(`CSV headers must be exactly: ${HEADERS.join(",")}`);
  }

  const productById = new Map(products.map(product => [product.id, product]));
  const seenIds = new Set();
  const skuOwners = new Map();
  for (const product of products) {
    if (typeof product.sku === "string" && product.sku.trim()) {
      const key = product.sku.trim().toLowerCase();
      if (skuOwners.has(key)) skuOwners.set(key, null);
      else skuOwners.set(key, product.id);
    }
  }

  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvRow(line);
    const errors = [];
    if (cells.length !== HEADERS.length) errors.push("Expected four columns.");
    const [id, sku, priceText, stockText] = cells;
    const product = productById.get(id);
    if (!id || !product) errors.push("Firebase document ID does not match an existing product.");
    if (seenIds.has(id)) errors.push("Duplicate Firebase document ID.");
    seenIds.add(id);
    if (!SKU_PATTERN.test(sku || "")) errors.push("SKU is required and may contain only letters, numbers, dot, underscore, or hyphen.");
    const price = Number(priceText);
    if (!Number.isFinite(price) || price <= 0) errors.push("Current price must be a positive number.");
    else if (product && Number(product.price) !== price) errors.push("Current price does not match Firebase; refresh the report.");
    if (!/^(0|[1-9]\d*)$/.test(stockText || "") || !Number.isSafeInteger(Number(stockText)) || Number(stockText) > 100000) {
      errors.push("Stock quantity must be a verified whole number from 0 to 100000.");
    }
    if (sku && SKU_PATTERN.test(sku)) {
      const owner = skuOwners.get(sku.toLowerCase());
      if (skuOwners.has(sku.toLowerCase()) && owner !== id) errors.push("SKU is already assigned to another product.");
      skuOwners.set(sku.toLowerCase(), id);
    }
    return {
      line: index + 2,
      id,
      sku,
      price: priceText,
      stockQuantity: Number(stockText),
      product,
      errors
    };
  });
  return { rows, valid: rows.every(row => row.errors.length === 0) };
}
