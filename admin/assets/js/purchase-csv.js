const REQUIRED_COLUMNS = ["invoice_type", "invoice_number", "customer_name", "mobile", "product_name", "purchase_date"];

const COLUMN_ALIASES = {
  invoice_type: ["invoice_type", "type", "purchase_type", "invoice type"],
  invoice_number: ["invoice_number", "invoice_no", "invoice", "invoice number", "bill_number"],
  customer_name: ["customer_name", "name", "customer", "customer name"],
  mobile: ["mobile", "phone", "mobile_number", "registered_mobile"],
  email: ["email", "customer_email"],
  product_name: ["product_name", "product", "item", "product name"],
  product_model: ["product_model", "model", "product model"],
  serial_number: ["serial_number", "serial", "serial number"],
  purchase_date: ["purchase_date", "date", "invoice_date", "purchase date"],
  warranty_months: ["warranty_months", "warranty", "warranty months"],
  invoice_amount: ["invoice_amount", "amount", "total", "invoice amount"]
};

const INVOICE_TYPE_ALIASES = {
  GST: "GST",
  "GST INVOICE": "GST",
  NON_GST: "NON_GST",
  NON_GST_INVOICE: "NON_GST",
  "NON GST": "NON_GST",
  "NON-GST": "NON_GST",
  NONGST: "NON_GST",
  "WITHOUT GST": "NON_GST"
};

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        current += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
}

export function parseCsv(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(line => line.trim() !== "")
    .map(splitCsvLine);
}

function columnIndex(header) {
  const normalized = header.map(cell => cell.trim().toLowerCase());
  const indexes = {};
  for (const [column, aliases] of Object.entries(COLUMN_ALIASES)) {
    const position = normalized.findIndex(cell => aliases.includes(cell));
    if (position >= 0) indexes[column] = position;
  }
  return indexes;
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const dayFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    return new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function cell(row, indexes, column) {
  const position = indexes[column];
  return position === undefined ? "" : String(row[position] ?? "").trim();
}

export function csvRowsToPurchases(rows) {
  if (!rows.length) return { purchases: [], errors: [{ row: 0, reason: "The CSV file is empty." }] };
  const indexes = columnIndex(rows[0]);
  const missing = REQUIRED_COLUMNS.filter(column => indexes[column] === undefined);
  if (missing.length) {
    return { purchases: [], errors: [{ row: 1, reason: `Missing required column(s): ${missing.join(", ")}` }] };
  }

  const purchases = [];
  const errors = [];
  rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    const invoiceType = INVOICE_TYPE_ALIASES[cell(row, indexes, "invoice_type").toUpperCase()] || "";
    const payload = {
      invoice_type: invoiceType,
      invoice_number: cell(row, indexes, "invoice_number"),
      customer_name: cell(row, indexes, "customer_name"),
      mobile: cell(row, indexes, "mobile").replace(/\D/g, "").slice(-10),
      email: cell(row, indexes, "email") || null,
      product_name: cell(row, indexes, "product_name"),
      product_model: cell(row, indexes, "product_model"),
      serial_number: cell(row, indexes, "serial_number"),
      purchase_date: normalizeDate(cell(row, indexes, "purchase_date")),
      warranty_months: Number(cell(row, indexes, "warranty_months") || 0),
      invoice_amount: Number(cell(row, indexes, "invoice_amount") || 0)
    };

    if (!invoiceType) {
      errors.push({ row: rowNumber, reason: "Invoice type must be GST or NON_GST." });
      return;
    }
    if (!payload.invoice_number || !payload.customer_name || !payload.product_name) {
      errors.push({ row: rowNumber, reason: "Invoice number, customer name, and product name are required." });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(payload.mobile)) {
      errors.push({ row: rowNumber, reason: "Mobile must be a 10-digit Indian number starting with 6-9." });
      return;
    }
    if (!payload.purchase_date) {
      errors.push({ row: rowNumber, reason: "Purchase date could not be read. Use YYYY-MM-DD or DD/MM/YYYY." });
      return;
    }
    if (!Number.isFinite(payload.warranty_months) || payload.warranty_months < 0) {
      errors.push({ row: rowNumber, reason: "Warranty months must be a positive number." });
      return;
    }
    if (!Number.isFinite(payload.invoice_amount) || payload.invoice_amount < 0) {
      errors.push({ row: rowNumber, reason: "Invoice amount must be a positive number." });
      return;
    }
    purchases.push(payload);
  });

  return { purchases, errors };
}

export const CSV_TEMPLATE = [
  "invoice_type,invoice_number,customer_name,mobile,product_name,product_model,serial_number,purchase_date,warranty_months,invoice_amount",
  "GST,INV-1001,Dhruvil Barot,8511693405,Dell Desktop,OptiPlex 7040,SN12345,2026-11-14,3,25000"
].join("\n");
