# Firebase Product Mapping Report

This report is based on the last read-only inspection of the public Firebase catalog. It does not update Firebase or establish real inventory. SKU values below are deterministic **proposals**, derived from each document ID; approve or replace them before import. Stock remains unknown and must be counted/verified by the catalog owner.

| Firebase document ID | Product name | Current price (INR) | Proposed SKU (not approved) | Current stock status | Missing fields |
|---|---|---:|---|---|---|
| `CsquduQykJemOzfnfbu4` | ACER AMD A8 6TH GEN DESKTOP | 4,999 | `AIG-CATALOG-CsquduQykJemOzfnfbu4` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `xvG7WdUJn1uXLsHjjTku` | ACER I3 6TH GEN DESKTOP | 8,999 | `AIG-CATALOG-xvG7WdUJn1uXLsHjjTku` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `9yRINZkpwVQ6OyQK2x34` | ACER I3 7TH GEN DESKTOP | 11,999 | `AIG-CATALOG-9yRINZkpwVQ6OyQK2x34` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `mMHXKBVHGr3PJBEgBo3B` | DELL AMD A8 6TH GEN DESKTOP | 5,999 | `AIG-CATALOG-mMHXKBVHGr3PJBEgBo3B` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `fXugqfvXcJTKsTnQePLC` | DELL I5 4TH GEN DESKTOP | 10,999 | `AIG-CATALOG-fXugqfvXcJTKsTnQePLC` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `E6qZ87Ttmgik4UUmAosy` | HP 285 G3 MT DESKTOP RYZEN 3 | 7,999 | `AIG-CATALOG-E6qZ87Ttmgik4UUmAosy` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `b14hNoJYQDAIJsB3SinY` | HP AMD A10 DESKTOP | 6,500 | `AIG-CATALOG-b14hNoJYQDAIJsB3SinY` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `EQPRU82eDtMx1eetstMl` | HP i3 4TH GEN DESKTOP | 6,999 | `AIG-CATALOG-EQPRU82eDtMx1eetstMl` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `rD9AGDpMEZZhV2JHoXo7` | HP I3 6TH GEN DESKTOP | 9,999 | `AIG-CATALOG-rD9AGDpMEZZhV2JHoXo7` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `MZZx8RDak4oN91UJTu19` | HP i5 6TH GEN DESKTOP | 14,999 | `AIG-CATALOG-MZZx8RDak4oN91UJTu19` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |
| `pTHxN0omhtsGXjRK4IkZ` | HP PRO - I5 4TH GEN DESKTOP | 9,999 | `AIG-CATALOG-pTHxN0omhtsGXjRK4IkZ` | Unknown; `stockQuantity` missing | SKU, numeric stock quantity |

All 11 inspected documents were published, had positive prices, and had 1–5 HTTPS Cloudinary images. No stock quantity is inferred from the text availability label. Refresh this report from Firebase before using the import template because IDs, prices, or publication status may have changed.

## Controlled import procedure

1. Verify the current product identity, price, publication decision, and physical stock outside this report.
2. Fill in the template's `proposed_sku` with the approved SKU and `stock_quantity` with the verified non-negative integer. Do not leave stock blank.
3. Sign into Firebase Product & Site Management > Products. Select the CSV and run **Run dry run**. This performs reads only and rejects stale IDs/prices, invalid data, or duplicate IDs/SKUs.
4. Review the dry-run output. Only then choose **Apply reviewed mapping** and confirm the explicit prompt. The importer updates only `sku`, `stockQuantity`, and `updatedAt`; it does not change price, image, or publication status.
5. The importer syncs each successful Firebase update to the backend and provides a downloadable audit log. Review partial failures and retry only after checking both systems.

This workflow does not modify production data until an authenticated administrator explicitly confirms the import. The CSV template itself contains no stock values and cannot pass dry-run until real quantities are supplied.
