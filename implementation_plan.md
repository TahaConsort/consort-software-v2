# Full Implementation Plan: Aligning Consort CRM with Document Requirements

## Background

Two specification documents were analyzed:

1. **`Export_Shipment_Workflow_CRM_Roadmap.docx`** — Full export shipment workflow with 8-step lifecycle, vendor directory, document dependency map, and CRM data model requirements.
2. **`Shipment detail end to end.docx`** — Detailed breakdown of every physical document in an export shipment: Financial Instrument, Packing List, Commercial Invoice, Bill of Lading, Goods Declaration (GD-I), Port/Terminal Invoice, Freight Forwarder Invoice.

Both documents agree on the same model. The core ask is: **Shipment as the central object**, linked to a **Vendor master** (Exporter, Buyer, Bank, Carrier, Freight Forwarder, Customs Agent, Port Terminal) and **trade documents** (Financial Instrument, Packing List, Commercial Invoice, Bill of Lading, Goods Declaration, Logistics Invoices) as child records sharing reference numbers — eliminating duplicate data entry.

---

## Gap Analysis: What's Correct vs. What's Missing

### What's Already Correct

| Area | Status |
|------|--------|
| **Vendor master table** (`vendors`) | Complete — all fields from docs present: `name`, `type`, `taxId` (NTN), `strn`, `rexNo`, `vatNo`, `bankName`, `bankBranch`, `iban`, `swiftCode`, `accountTitle`, `currency`, `paymentTermsDays`, `isActive` |
| **VendorType enum** | Correct — includes `exporter`, `buyer`, `bank`, `freight_forwarder`, `ocean_carrier`, `customs_agent`, `port_terminal` (all 8-step vendor roles) |
| **Vendor CRUD backend** | Full CRUD: `listVendors`, `getVendor`, `createVendor`, `updateVendor`, `deactivateVendor`, `deleteVendor` with proper permissions |
| **Vendor frontend** (`VendorsListPage.jsx`) | Full form with all fields, type filter, search, documents dialog |
| **Shipment model** | Core structure correct; `customerId`, `quotationId`, `services`, `status`, `exceptionState`, ETD/ETA, ports, addresses |
| **Shipment status lifecycle** | `booking → order_confirmed → ... → settled → closed` — maps to doc's 8-step workflow |
| **Invoice model** | `receivable` (customer) and `payable` (vendor) kinds |
| **VendorRfq + VendorQuote** | Buy-side rate request system |
| **Document model** | Polymorphic, supports `shipment`, `vendor` owner types |
| **OTC milestones** | `invoice_issued → payment_received → ... → settlement_complete` — maps to doc's collection/settlement phase |
| **8-step OTD stepper** | Frontend stepper with checklist, documents check, `Complete`/`Force`/`Reopen` |

---

### What's Missing (Gaps)

#### GAP-1: Financial Instrument (FI) Module — CRITICAL
The documents define the **Financial Instrument (EXP/FI)** as the founding document of every shipment. The current system has **no dedicated FI model** — only `lcNumber`/`bankRef`/`escrowRef` stub fields on the `Shipment` model. Needs:
- FI Number (e.g. `BIP-EXP-320372-05012026`)
- Exporter (Vendor, type=`exporter`), Buyer (Vendor, type=`buyer`), Bank (Vendor, type=`bank`)
- Incoterm, currency, value ceiling, payment terms (CAD%, DA days), expiry date
- Status: `active` → `closed`, Balance tracking

#### GAP-2: Packing List Module — CRITICAL
The **Packing List** is the authoritative source for carton/piece/weight data. No model exists. Needs:
- Header: shipmentId, date, exporter, consignee/buyer
- Line items: SKU/Reference, description, HS Code, qty/box, boxes, pieces, net/gross weight

#### GAP-3: Commercial Invoice (Trade) Module — CRITICAL
The **Commercial Invoice** (exporter's invoice to buyer) is the central trade document. Currently only logistics `Invoice` rows exist. Needs:
- Invoice No./Date, Exporter (Vendor FK), Buyer (Vendor FK)
- Financial Instrument FK, Packing List FK
- Line items with HS Codes, REX statement, origin declaration, total value, incoterm

#### GAP-4: Bill of Lading (BOL) Module — CRITICAL
BOL is tracked via OTD steps but **no dedicated model** stores the data:
- B/L Number, Ocean Carrier (Vendor FK), Consignee (bank Vendor FK), Notify Party (buyer Vendor FK)
- Container No., Seal No., Vessel, Voyage, Port pair
- Freight terms, Shipped on Board date, Net/Gross weight

#### GAP-5: Goods Declaration (GD-I) Module — CRITICAL
No model exists for the customs declaration filed via WeBOC:
- GD Number, Customs Clearing Agent (Vendor FK), FI FK, Commercial Invoice FK
- Per-item HS Code lines, declared vs. assessed value (PKR), exchange rate
- FOB/CFR/Insurance values in PKR, appraiser/examiner sign-off

#### GAP-6: Logistics Invoice Cross-References — HIGH
Payable invoices (Freight Forwarder, Port Terminal) currently use freeform `counterparty` strings. They should reference BOL No., FI No., Container No. as FKs.

#### GAP-7: Vendor-to-Shipment Role Assignment — HIGH
No `ShipmentVendorRole` junction exists. Need a way to track which Exporter, Buyer, Bank, Freight Forwarder, Customs Agent, Ocean Carrier, Port Terminal is on each shipment.

#### GAP-8: Automatic Flag/Alert System — MEDIUM
Docs require automatic alerts for:
- FI expiry date approaching (14-day warning)
- DA due date = B/L shipped-on-board date + daDays (auto-calculated)
- Weight mismatch: Packing List totals != BOL weights

#### GAP-9: Trade Workflow States on UI — LOW
Doc specifies 8 named states (Contract Registered, Packing List Confirmed, ... FI Closed). These should surface as a visual progress indicator alongside the OTD stepper.

#### GAP-10: Frontend Trade Documents Section — HIGH
`ShipmentDetailPage.jsx` shows the OTD stepper and invoices, but **no section exists** for FI, Packing List, Commercial Invoice, BOL, or GD data entry/view.

#### GAP-11: Vendor Detail/Profile Page — MEDIUM
`VendorsListPage.jsx` is list+modal only. No `/vendors/:id` detail page showing the vendor's shipment history, invoice history, and documents.

---

## Open Questions

> [!IMPORTANT]
> **Q1: Financial Instrument scope** — Standalone module with its own CRUD (registered before shipment), or a child record created in the context of a shipment? Doc says "1 FI → 1 Shipment" but FI is registered *before* the shipment exists.

> [!IMPORTANT]
> **Q2: Data entry depth** — Are Packing List / Commercial Invoice / BOL / GD full data-entry forms (every line item, every HS code) or reference-only records (just store key numbers for cross-referencing)?

> [!IMPORTANT]
> **Q3: Vendor role storage** — Explicit FK columns on `Shipment` (`exporterVendorId`, `buyerVendorId`, etc.) OR a junction table `ShipmentVendorRole(shipmentId, vendorId, role)`?

> [!WARNING]
> **Q4: Migration risk** — All schema changes require Prisma migrations on the production database. Roll out in one migration, or feature-by-feature?

---

## Proposed Changes

### Phase 1 — Backend Schema and APIs

---

#### Component 1: Financial Instrument Module

**[NEW] `FinancialInstrument` model in `schema.prisma`:**
```prisma
model FinancialInstrument {
  id               String   @id @default(uuid())
  referenceNo      String   @unique @map("reference_no") // FI-YYYY-NNNNN
  fiNumber         String   @map("fi_number")            // e.g. BIP-EXP-320372-05012026
  exporterVendorId String   @map("exporter_vendor_id")
  buyerVendorId    String   @map("buyer_vendor_id")
  bankVendorId     String   @map("bank_vendor_id")
  incoterm         String?
  currency         String   @db.Char(3)
  valueCeiling     Decimal  @map("value_ceiling") @db.Decimal(14,2)
  balanceDrawn     Decimal  @default(0) @map("balance_drawn") @db.Decimal(14,2)
  paymentTerms     Json?    @map("payment_terms") // { cadPercent, daDays }
  expiryDate       DateTime @map("expiry_date")
  status           String   @default("active") // active | closed
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@map("financial_instruments")
}
```
Add `financialInstrumentId String?` FK to `Shipment` model.

**[NEW] files:**
- `erp-backend/modules/fi/fi.controllers.js`
- `erp-backend/modules/fi/fi.routes.js`
- `erp-backend/modules/fi/fi.validation.js`

---

#### Component 2: Packing List Module

**[NEW] `PackingList` + `PackingListItem` models in `schema.prisma`:**
```prisma
model PackingList {
  id               String            @id @default(uuid())
  shipmentId       String            @unique @map("shipment_id")
  date             DateTime?
  totalCartons     Int?
  totalPieces      Int?
  totalNetWeight   Decimal?
  totalGrossWeight Decimal?
  notes            String?
  items            PackingListItem[]
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  @@map("packing_lists")
}

model PackingListItem {
  id            String      @id @default(uuid())
  packingListId String      @map("packing_list_id")
  skuRef        String?     @map("sku_ref")
  description   String
  hsCode        String?     @map("hs_code")
  qtyPerBox     Int?        @map("qty_per_box")
  boxes         Int?
  pieces        Int?
  netWeightKg   Decimal?    @map("net_weight_kg") @db.Decimal(12,3)
  grossWeightKg Decimal?    @map("gross_weight_kg") @db.Decimal(12,3)
  sortOrder     Int         @default(0)
  @@map("packing_list_items")
}
```
**[NEW] files:** `erp-backend/modules/packinglist/` (controllers, routes, validation)

---

#### Component 3: Trade Invoice (Commercial Invoice) Module

> [!NOTE]
> This is the exporter's invoice to the buyer — distinct from the logistics payable/receivable `Invoice` model.

**[NEW] `TradeInvoice` + `TradeInvoiceLine` models in `schema.prisma`**

**[NEW] files:** `erp-backend/modules/tradeinvoice/` (controllers, routes, validation)

---

#### Component 4: Bill of Lading Module

**[NEW] `BillOfLading` model in `schema.prisma`:**
```prisma
model BillOfLading {
  id                String    @id @default(uuid())
  shipmentId        String    @unique @map("shipment_id")
  blNumber          String    @map("bl_number")
  carrierVendorId   String    @map("carrier_vendor_id")   // ocean_carrier
  consigneeVendorId String?   @map("consignee_vendor_id") // bank
  notifyVendorId    String?   @map("notify_vendor_id")    // buyer
  containerNo       String?   @map("container_no")
  sealNo            String?   @map("seal_no")
  vessel            String?
  voyage            String?
  portOfLoading     String?   @map("port_of_loading")
  portOfDischarge   String?   @map("port_of_discharge")
  freightTerms      String?   @map("freight_terms")       // freight_prepaid | freight_collect
  shippedOnBoard    DateTime? @map("shipped_on_board")
  issueDate         DateTime? @map("issue_date")
  netWeightKg       Decimal?  @map("net_weight_kg") @db.Decimal(12,3)
  grossWeightKg     Decimal?  @map("gross_weight_kg") @db.Decimal(12,3)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  @@map("bills_of_lading")
}
```
**[NEW] files:** `erp-backend/modules/bol/` (controllers, routes, validation)

---

#### Component 5: Goods Declaration Module

**[NEW] `GoodsDeclaration` + `GoodsDeclarationLine` models in `schema.prisma`**

Key fields: `gdNumber`, `clearingAgentVendorId`, `financialInstrumentId`, `tradeInvoiceId`, `exchangeRate`, `fobValuePkr`, `cfrValuePkr`, `assessedValuePkr`, appraiser/examiner/out-of-charge sign-off.

**[NEW] files:** `erp-backend/modules/gd/` (controllers, routes, validation)

---

#### Component 6: Shipment Vendor Roles (Junction Table)

**[NEW] `ShipmentVendorRole` model in `schema.prisma`:**
```prisma
model ShipmentVendorRole {
  id         String   @id @default(uuid())
  shipmentId String   @map("shipment_id")
  vendorId   String   @map("vendor_id")
  role       String   // exporter|buyer|bank|freight_forwarder|customs_agent|ocean_carrier|port_terminal
  notes      String?
  createdAt  DateTime @default(now())
  @@unique([shipmentId, vendorId, role])
  @@map("shipment_vendor_roles")
}
```

**[NEW] API endpoints on shipment routes:**
- `GET /api/shipments/:id/vendors`
- `POST /api/shipments/:id/vendors`
- `DELETE /api/shipments/:id/vendors/:roleId`

---

#### Component 7: Trade Alerts Background Job

**[NEW] `erp-backend/jobs/tradeAlerts.js`** — nightly cron:
1. FI expiry within 14 days → notification for `accounts` role
2. DA due date (BOL `shippedOnBoard` + `paymentTerms.daDays`) approaching → notification
3. Weight mismatch (PackingList totals vs BOL weights > 1%) → shipment alert flag

**[NEW]** `GET /api/shipments/:id/trade-alerts` endpoint

---

### Phase 2 — Frontend Implementation

---

#### Component 8: Trade Documents Tab on Shipment Detail

**[MODIFY]** [`ShipmentDetailPage.jsx`](file:///c:/Users/LT%2004/Desktop/consort-software/erp-frontend/src/pages/ShipmentsPages/ShipmentDetailPage.jsx)

Add a new collapsible **"Trade Documents"** section below the OTD stepper with 5 sub-tabs:

| Tab | Content |
|-----|---------|
| Financial Instrument | FI No., Exporter, Buyer, Bank, Incoterm, Value ceiling, Payment terms, Expiry |
| Packing List | Editable SKU table with carton/piece/weight totals |
| Commercial Invoice | Invoice header + HS code line items |
| Bill of Lading | B/L fields, carrier, consignee, container/seal/vessel/voyage |
| Goods Declaration | GD No., clearing agent, exchange rate, assessed values, per-HS-code lines |

Each tab: "Not yet recorded" empty state → Create button → view/edit modes. Mismatch warnings shown inline.

**[NEW] Frontend services:**
- `src/services/financialInstrumentService.js`
- `src/services/packingListService.js`
- `src/services/tradeInvoiceService.js`
- `src/services/billOfLadingService.js`
- `src/services/goodsDeclarationService.js`
- `src/services/shipmentVendorService.js`

**[NEW] Frontend components:**
- `src/components/shipment/FinancialInstrumentPanel.jsx`
- `src/components/shipment/PackingListPanel.jsx`
- `src/components/shipment/TradeInvoicePanel.jsx`
- `src/components/shipment/BillOfLadingPanel.jsx`
- `src/components/shipment/GoodsDeclarationPanel.jsx`
- `src/components/shipment/ShipmentVendorsPanel.jsx`

---

#### Component 9: Parties Panel on Shipment Detail

Add a **"Parties"** card to the right sidebar on `ShipmentDetailPage.jsx` showing:
- Exporter (NTN, REX No., IBAN inline)
- Buyer/Consignee (country, VAT No.)
- Bank (branch)
- Freight Forwarder, Customs Agent, Ocean Carrier, Port Terminal

Each entry links to vendor record. Ops can add/remove via the `ShipmentVendorRole` API.

---

#### Component 10: Vendor Detail Page

**[NEW]** `src/pages/VendorsPages/VendorDetailPage.jsx` (route: `/admin/vendors/:id`)

Sections:
- Profile header (name, type badge, referenceNo, active status)
- Contact, location, banking details (read/edit)
- **Shipments** tab: shipments where this vendor played a role (via `ShipmentVendorRole`)
- **Invoices** tab: payable invoices linked to this vendor
- **Documents** tab: tax certificates, agreements

**[MODIFY]** `src/App.jsx` — add route `<Route path="/admin/vendors/:id" element={<VendorDetailPage />} />`

---

#### Component 11: catalog.js — Trade Workflow Labels

**[MODIFY]** [`catalog.js`](file:///c:/Users/LT%2004/Desktop/consort-software/erp-frontend/src/lib/catalog.js):
```js
export const TRADE_WORKFLOW_STAGES = {
  fi_active: "Contract Registered / FI Active",
  packing_list_confirmed: "Packing List Confirmed",
  commercial_invoice_raised: "Commercial Invoice Raised",
  booking_confirmed: "Booking Confirmed / GD Filed",
  shipped_on_board: "Shipped on Board (BOL Issued)",
  logistics_settled: "Logistics Invoices Settled",
  payment_realised: "Payment Realised (CAD/DA)",
  fi_closed: "Financial Instrument Closed",
};

export const SHIPMENT_VENDOR_ROLES = {
  exporter: "Exporter",
  buyer: "Buyer / Consignee",
  bank: "Bank (FI)",
  freight_forwarder: "Freight Forwarder",
  customs_agent: "Customs Clearing Agent",
  ocean_carrier: "Ocean Carrier",
  port_terminal: "Port Terminal",
};
```

---

## Implementation Priority Order

| Priority | Gap | Component | Effort |
|----------|-----|-----------|--------|
| Critical | GAP-1 | Financial Instrument schema + API + frontend panel | Large |
| Critical | GAP-2 | Packing List schema + API + frontend panel | Medium |
| Critical | GAP-3 | Commercial Invoice (Trade) schema + API + frontend panel | Large |
| Critical | GAP-4 | Bill of Lading schema + API + frontend panel | Medium |
| Critical | GAP-5 | Goods Declaration schema + API + frontend panel | Medium |
| High | GAP-7 | Shipment Vendor Roles junction + Parties panel | Medium |
| High | GAP-10 | Trade Documents tab on ShipmentDetailPage | Large |
| Medium | GAP-11 | Vendor Detail Page | Small |
| Medium | GAP-8 | Automatic flag/alert system | Medium |
| Low | GAP-9 | Trade workflow stage labels on UI | Small |

---

## Document Cross-Reference Integrity

Per Doc 2's dependency map — these FK links must be enforced once all modules exist:

| Source Document | Fields Used Downstream | FK in |
|----------------|----------------------|-------|
| Financial Instrument | FI No., Buyer, Incoterm, Value, Expiry | `TradeInvoice`, `GoodsDeclaration`, payable `Invoice` |
| Packing List | Carton/piece/weight, SKU desc | `TradeInvoice` (totals validation), `BillOfLading` (weight check) |
| Commercial Invoice | Invoice No./Date, Total, HS Codes, REX No. | `GoodsDeclaration`, `BillOfLading` cargo desc |
| Bill of Lading | B/L No., Container/Seal, Vessel/Voyage, Port pair | Payable invoices (Forwarder, Terminal) |
| Goods Declaration | GD No., Assessed PKR value, HS assessment | Forwarder payable invoice (clearance line) |

---

## Verification Plan

### Automated
```bash
cd erp-backend && npx prisma validate
cd erp-backend && node prisma/seed.js
```

### Manual
1. Create vendors of type `exporter`, `buyer`, `bank` — verify all fields save
2. Open a shipment → new Trade Documents tab → create a Financial Instrument
3. Add Packing List items → verify weight totals compute
4. Add BOL → verify weight mismatch warning appears when BOL weight differs from Packing List
5. Set FI expiry 5 days away → verify alert notification fires
6. Navigate to `/admin/vendors/:id` → verify Shipments and Invoices tabs load
