**EXPORT SHIPMENT DOCUMENTATION WORKFLOW**

A Vendor & Business-Process Roadmap for CRM / ERP Development

Prepared for: IT Department — Project Head

Subject: End-to-end textile shipment documentation cycle for the Consort one-window-solution project, with full Vendor/Customer register

_Customer: SAS METM Consulting and Trading ("Consort"), France | Vendors: Ahmad Saeed Textiles (Pvt) Ltd & Alisha Fatima Textile_

# 1\. Purpose of This Document

This document breaks down the complete paper trail generated during textile shipments handled under the Consort project, and lists every vendor/party that touches a shipment, with their full contact and banking details as captured on the source documents.

It is built from two real shipments raised by two Vendors — Ahmad Saeed Textiles (Pvt) Ltd and Alisha Fatima Textile — both supplying bedsheet/textile goods that flow through Consort, France, for delivery to Antwerp, Belgium.

**Example 1 — Export shipment, Consort as Manufacturer (Zanitex):** Per the LC document, the Importer of record is Zanitex S.r.l. (Italy). Zanitex is the party that asked Consort (SAS METM Consulting and Trading) to manufacture bedsheets and similar products, and Consort agreed to provide a one-window solution for that requirement. In this relationship, Zanitex S.r.l. is the Customer (Importer), Consort is the Manufacturer coordinating and providing the one-window solution, and Ahmad Saeed Textiles and Alisha Fatima Textile are the Vendors that actually supply/manufacture the goods on Consort's behalf. This is an export shipment (goods moving out of Pakistan to Zanitex in Italy, via Consort). On the underlying shipping and customs paperwork (Bills of Lading, Financial Instruments, Goods Declarations) these companies are still named in the formal trade roles of "Exporter" and "Consignee/Buyer," because that is required regulatory language — but for the purposes of this CRM roadmap and the Vendor/Customer/Manufacturer data model, Ahmad Saeed Textiles and Alisha Fatima Textile are classified as Vendors, Consort is classified as the Manufacturer, and Zanitex S.r.l. is classified as the Customer.

**Example 2 — Import shipment, Consort as Freight Forwarder (Chenab):** Consort does not always act as Manufacturer. In a separate, import-side shipment involving Chenab, Consort acted as the Freight Forwarder instead — booking and coordinating the import transport rather than manufacturing or supplying goods. Unlike Example 1 (an export shipment out of Pakistan), this Chenab shipment is on the import side. (Chenab's full company details were not part of the source documents reviewed for this roadmap and should be confirmed and added by the project team.) This confirms that a party's role in the CRM must not be hard-coded per company, and must also capture whether the shipment is Export or Import — the same party (Consort) can hold different roles (Manufacturer on an export shipment, Freight Forwarder on an import shipment, or others) depending on the project. The Vendor/Party master table in Section 2 should therefore store a company's contact and banking details once, while the Role and the Export/Import direction are captured separately at the shipment/contract level, not fixed on the party record itself.

The goal is to give the IT team:

- A complete Vendor/Party Directory — every company or bank that must exist as a record in the CRM, with the fields the CRM needs to store for each, and each party's correct Vendor/Manufacturer/Customer classification.
- Every document generated in the shipment cycle, in order, with the vendor responsible for each named directly in that step.
- A data model and workflow-state recommendation for the CRM build, built around a Customer–Manufacturer–Vendor relationship rather than a generic Exporter–Buyer trade relationship.
- Confirmation that a party's Role (Manufacturer, Freight Forwarder, Vendor, Customer, etc.) and the shipment's direction (Export vs. Import) are both per-shipment attributes, not fixed properties of the company record — see Example 1 (Export) and Example 2 (Import) above.

Note: one uploaded file (Claude_Setup.exe) was an installer, not a shipment document, and was excluded.

# 2\. Vendor / Party Directory (Master Data)

Every company, bank, and agency named anywhere across the two shipments' paperwork. This is the master "Vendor" or "Party" table the CRM should hold — each shipment then just links to the relevant vendor IDs instead of storing addresses again. Roles below reflect the LC-based relationship (Customer / Manufacturer / Vendor), with the formal shipping-document role noted where it differs.

| **Zanitex S.r.l.** _— Customer — Importer of Record (per LC)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Address:** Viale Caproni 18, 38068 Rovereto (TN), Italy<br><br>**Port of Discharge on record:** Vaprio D Adda<br><br>**Relationship:** Importer named on the LC; asked Consort to manufacture bedsheets and similar products, which Consort agreed to fulfil as a one-window solution<br><br>**Role on shipping documents:** Named as Consignee/Buyer on a Financial Instrument held by Vendor Ahmad Saeed Textiles (BIP-EXP-320492-05012026, EUR 122,919) (required regulatory/trade language — does not change its Customer classification in the CRM) |

| **SAS METM Consulting and Trading ("Consort")** _— Manufacturer — One-Window-Solution Provider to Zanitex S.r.l._                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Address:** 12, allee de l'Hermitage, 45560 Saint-Denis-en-Val, France<br><br>**VAT (TVA) No.:** FR02912450996<br><br>**Relationship:** Agreed to provide Zanitex S.r.l. a one-window solution for bedsheet/textile manufacturing; sources the goods through Vendors Ahmad Saeed Textiles and Alisha Fatima Textile<br><br>**Role on shipping documents:** Named as Consignee on the Financial Instruments and as Notify Party on both Bills of Lading (required regulatory/trade language — does not change its Manufacturer classification in the CRM) |

| **Ahmad Saeed Textiles (Pvt) Ltd** _— Vendor — Bedsheet/Textile Goods Supplier to Consort_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Head Office:** Suite 917, 9th Floor, High Q Tower, Jail Road, Gulberg V, Lahore, Pakistan<br><br>**Factory:** Plot No. 93-94, Allama Iqbal Industrial Estate, Faisalabad, Pakistan<br><br>**Phone:** +92-334-8652288<br><br>**Email:** <mozzam@ahmadsaeedtextiles.com><br><br>**NTN:** 4240145<br><br>**REX Registration No.:** PKREXPK42401453<br><br>**Bank / IBAN:** BankIslami Pakistan Ltd — PK77BKIP0200239493380001<br><br>**Role on shipping documents:** Named as Exporter/Shipper (required regulatory/trade language — does not change its Vendor classification in the CRM) |

| **Alisha Fatima Textile** _— Vendor — Bedsheet/Textile Goods Supplier to Consort_                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Address:** 209-RB Phattak Stop, Jaranwala Road, Faisalabad, Pakistan<br><br>**NTN:** 4097363-8<br><br>**REX Registration No.:** PKREXPK40973638<br><br>**Bank:** BankIslami Pakistan Ltd, Sargodha Road Branch, Faisalabad<br><br>**IBAN:** PK85BKIP0218500031310001<br><br>**SWIFT Code:** BKIPPKKAxxx<br><br>**Role on shipping documents:** Named as Exporter/Shipper (required regulatory/trade language — does not change its Vendor classification in the CRM) |

| **Javed Latif** _— Additional Notify Party (Ahmad Saeed → Consort shipment)_                         |
| ---------------------------------------------------------------------------------------------------- |
| **Address:** 14 Rue Saint-Robert, 63100 Clermont-Ferrand, France<br><br>**VAT (TVA) No.:** 518081757 |

| **BankIslami Pakistan Ltd** _— Vendors' Bank — Financial Instrument / EXP Registration & Collection_                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch (Ahmad Saeed Textiles' account):** Jail Road Branch, Lahore<br><br>**Branch (Alisha Fatima Textile's account):** Sargodha Road Branch, Faisalabad<br><br>**Function:** Registers the Financial Instrument (EXP form / BIP-EXP no.) for each Vendor; handles CAD/DA collection from Consort |

| **HMM (Hyundai Merchant Marine)** _— Ocean Carrier — Ahmad Saeed Textiles (Vendor) → Consort (Manufacturer) shipment_                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vessel / Voyage used:** ONE RECOGNITION V0009W<br><br>**Booking No.:** KHIE28787300<br><br>**Agent for the Carrier:** United Marine Agencies (Pvt) Ltd<br><br>**Function:** Issues the Bill of Lading; carries the container Karachi → Antwerp |

| **Maersk (A.P. Moller-Maersk)** _— Ocean Carrier — Alisha Fatima Textile (Vendor) → Consort (Manufacturer) shipment_                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Issuing office:** Maersk Pakistan Pvt Ltd, Karachi<br><br>**Vessel / Voyage used:** HANSA AFRICA V603S<br><br>**Booking / B/L No.:** 263812461<br><br>**Destination agent:** Antwerp Maersk Belgium NV, Roderveldlaan 2 bus 5, 2600 Berchem, Belgium<br><br>**Destination agent phone:** +32 33768590<br><br>**Destination agent email:** <be.import@maersk.com> |

| **Agilent Freight Services (Pvt) Ltd** _— Freight Forwarder — engaged by Vendor Alisha Fatima Textile_                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Address:** 2nd Floor, 81 Commercial, Umer Block, Sector B, Bahria Town, Lahore, Pakistan<br><br>**Phone:** +92 37815505<br><br>**Email:** <shahzad.khawaja@agilentfreightservices.com><br><br>**Website:** <www.agilentfreightservices.com><br><br>**NTN:** 7289849-2<br><br>**Bank:** Meezan Bank Limited, Khayaban-e-Jinnah Road, Lahore<br><br>**Account Title:** Agilent Freight Services Pvt Ltd<br><br>**Account No.:** 1131-0103878455<br><br>**IBAN:** PK11MEZN0011310103878455<br><br>**SWIFT Code:** MEZNPKKA |

| **Qasim International Container Terminal Pakistan Ltd (QICT)** _— Port / Container Terminal Operator_                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Address:** Berth 5-7, Marginal Wharves, PMBQ, Karachi 75020, Pakistan<br><br>**UAN:** 111-786-888<br><br>**Phone:** 4739100, Ext. 260 / 261<br><br>**Fax:** 4730021<br><br>**Email:** <QICTBilling@dpworld.com><br><br>**NTN:** 0823649-6<br><br>**STRN:** 12-00-9805-878-37<br><br>**Function:** Issues the Sindh Sales Tax Invoice for container handling, examination, and wharfage charges |

| **NTC Logistics Pakistan** _— Customs Clearing Agent_                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Address:** Plot No. 589, Street No. 9, Sector-K, Ahata Changa Manga Road, Korangi Town, Karachi, Pakistan<br><br>**NTN:** 3224545-9<br><br>**STRN:** 17-16-9999-001-55<br><br>**Function:** Named as Clearing Agent on the QICT invoice; handles filing of the Goods Declaration (GD-I) with Pakistan Customs (WeBOC) |

# 3\. Stakeholder Quick Reference

| **Role**                  | **Vendor(s) / Party in the sample shipments**                                                                  | **Generates / Handles**                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Customer                  | SAS METM Consulting and Trading ("Consort"); (secondary customer: Zanitex S.r.l., outside the Consort project) | Contract/BRD/PO; receives goods at Antwerp                      |
| Vendor (Goods Supplier)   | Ahmad Saeed Textiles (Pvt) Ltd; Alisha Fatima Textile                                                          | Commercial Invoice, Packing List, Customs filing data           |
| Vendor's Bank             | BankIslami Pakistan Ltd                                                                                        | Financial Instrument / EXP form registration; CAD/DA collection |
| Ocean Carrier             | HMM (via United Marine Agencies); Maersk                                                                       | Bill of Lading, ocean transport                                 |
| Freight Forwarder         | Agilent Freight Services (Pvt) Ltd                                                                             | Booking, clearance coordination, freight invoicing              |
| Port / Container Terminal | Qasim International Container Terminal (QICT)                                                                  | Terminal handling, Sindh Sales Tax invoice                      |
| Customs Clearing Agent    | NTC Logistics Pakistan                                                                                         | Goods Declaration (GD-I) filing with Pakistan Customs           |

# 4\. Document Register — What Each Paper Is, Who Issues It, and What Data It Holds

## 4.1 Sales Contract / Proforma Invoice (BRD / Purchase Order from Consort)

**Issued by:** Vendor (Ahmad Saeed Textiles / Alisha Fatima Textile) to Customer Consort (SAS METM Consulting and Trading), against Consort's BRD/PO

Referenced on the Commercial Invoice as "Proforma/Contract #" (e.g., AST/09/25/002, dated 5-Sep-25 for Ahmad Saeed Textiles; contract dated 29-Dec-25 for Alisha Fatima Textile). Not present as a standalone scanned file here, but every downstream document quotes its number and date — so it is the root record.

- Key fields: Contract/Proforma No., Date, Customer, Product description, Agreed Incoterm, Price per unit, Payment terms.

## 4.2 Financial Instrument (Bank EXP Registration)

**Issued by:** BankIslami Pakistan Ltd, against the Vendor's account, per State Bank of Pakistan export regulations

| **Field**          | **Ahmad Saeed Textiles → Consort**        | **Alisha Fatima Textile → Consort**       |
| ------------------ | ----------------------------------------- | ----------------------------------------- |
| FI Unique No.      | BIP-EXP-296937-14112025                   | BIP-EXP-320372-05012026                   |
| Vendor NTN         | 4240145                                   | 4097363                                   |
| Customer / Country | SAS METM Consulting and Trading / Belgium | SAS METM Consulting and Trading / Belgium |
| Delivery Term      | Cost And Freight (CFR)                    | Cost And Freight (CFR)                    |
| Port of Discharge  | Antwerpen                                 | Antwerpen                                 |
| Value / Currency   | EUR 42,260                                | EUR 20,208                                |
| Payment structure  | 60% CAD / 40% DA 75 days from B/L date    | Document Against Acceptance 100%, 75 days |
| Expiry Date        | 28-01-2026                                | 20-03-2026                                |
| Status             | Active                                    | Active                                    |

Note: Ahmad Saeed Textiles also holds a second, separate Financial Instrument (BIP-EXP-320492-05012026) against Zanitex S.r.l. (Italy), EUR 122,919 — a Customer outside the Consort project, confirming a Vendor can supply multiple Customers concurrently. The CRM must support one Vendor → many Financial Instruments → many Shipments → linked to potentially different Customers.

## 4.3 Packing List

**Issued by:** Vendor's factory (Ahmad Saeed Textiles / Alisha Fatima Textile)

| **Field**          | **Ahmad Saeed Textiles**                                                                               | **Alisha Fatima Textile**                       |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Customer           | SAS METM Consulting and Trading ("Consort")                                                            | SAS METM Consulting and Trading ("Consort")     |
| Container No.      | KOCU-517938-5                                                                                          | MRKU-763364-2                                   |
| Total Cartons      | 841                                                                                                    | 469                                             |
| Total Pieces       | 16,390                                                                                                 | 13,594                                          |
| Total Net Weight   | 8,648.30 kg                                                                                            | 5,152.60 kg                                     |
| Total Gross Weight | 9,268.00 kg                                                                                            | 5,408.90 kg                                     |
| Line-item detail   | 22 SKU rows: fitted sheets, pillow covers, mattress protectors, bedspreads, comforters, filled pillows | 15 SKU rows: fitted sheets, pillowcases, quilts |

## 4.4 Commercial Invoice

**Issued by:** Vendor to Customer Consort (SAS METM Consulting and Trading)

| **Field**                | **Ahmad Saeed Textiles**                   | **Alisha Fatima Textile**                     |
| ------------------------ | ------------------------------------------ | --------------------------------------------- |
| Invoice No. / Date       | AST/11/25/003, 13-Nov-25                   | AFT/012/25/009, 29-Dec-25                     |
| Shipment Terms           | CFR Antwerp                                | CFR Antwerp Port, Belgium                     |
| REX Registration No.     | PKREXPK42401453                            | PKREXPK40973638                               |
| HS Codes used            | 6302.3110, 6302.3150, 6304.1900, 9404.9000 | 6302.1010, 6302.1090, 6302.3150, 6301.3000    |
| Total Invoice Value      | EUR 42,260.00                              | EUR 20,208.00                                 |
| Vendor's bank on invoice | BankIslami Pakistan Ltd                    | BankIslami Pakistan Ltd, Sargodha Road Branch |

## 4.5 Bill of Lading (B/L)

**Issued by:** The Ocean Carrier — HMM (Ahmad Saeed Textiles shipment) / Maersk (Alisha Fatima Textile shipment)

| **Field**                   | **Ahmad Saeed Textiles shipment — Carrier: HMM**                   | **Alisha Fatima Textile shipment — Carrier: Maersk** |
| --------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| B/L No. / Booking No.       | Booking KHIE28787300                                               | B/L 263812461                                        |
| Carrier's Agent             | United Marine Agencies (Pvt) Ltd                                   | Maersk Pakistan Pvt Ltd                              |
| Consignee on B/L            | To the order of BankIslami Pakistan Limited                        | To Order Bank Islami Pakistan Ltd                    |
| Notify Party                | Consort (SAS METM Consulting and Trading); also notify Javed Latif | Consort (SAS METM Consulting and Trading)            |
| Vessel / Voyage             | ONE RECOGNITION V0009W                                             | HANSA AFRICA V603S                                   |
| Port of Loading → Discharge | Karachi → Antwerp, Belgium                                         | Port Qasim → Antwerp                                 |
| Container / Seal No.        | KCU5179385 / 24H1277873                                            | MRKU7633642 / Seal 0010                              |
| Shipped on Board / Issued   | 21-Nov-2025                                                        | 14-Jan-2026 / issued 20-Jan-2026                     |

## 4.6 Customs Goods Declaration (GD-I / Bill of Export)

**Filed by:** NTC Logistics Pakistan (Customs Clearing Agent), through Pakistan Customs' WeBOC system

- Vendor / Customer names, Port of shipment (Port Qasim) and discharge (Antwerp).
- Financial Instrument No. referenced directly on the declaration (e.g., BIP-EXP-320372-05012026).
- Per-item HS Code, quantity, unit value, declared vs. assessed value (PKR), SRO/exemption code.
- FOB Value, Freight, CFR Value, Insurance, Assessed Customs Value, all in PKR at the applicable exchange rate.
- Customs sign-off: Appraiser and Examiner named on the form; "Out of Charge" signature/stamp is the release point.

## 4.7 Port / Terminal Handling Invoice

**Issued by:** Qasim International Container Terminal Pakistan Ltd (QICT), billed via Clearing Agent NTC Logistics Pakistan

- Container No., vessel/voyage, receiving date, CBM, storage days.
- Itemised charges: bank service, seal breaking/affixing, customs seal, data processing, document copying, export examination, examination survey, fuel adjustment, general cargo, PQA wharfage, container weighment — each carrying 15% Sindh Sales Tax.
- Example: Alisha Fatima Textile shipment — Invoice Total PKR 39,360 (Invoice No. QITE0003007240).

## 4.8 Freight Forwarder's Invoice

**Issued by:** Agilent Freight Services (Pvt) Ltd, to the Vendor

- References: MBL/HBL No. (263812461), Vessel/Voyage, Form-E/FI No., Shipping Bill No.
- Line items: Ocean Freight, Bill of Lading fee, CRO (Container Release Order), Seal, LOLO (Lift On/Lift Off), Customs Clearance (passes through the QICT charges above).
- Example: Alisha Fatima Textile shipment — Invoice SE/LHE/25262/2526 — Total PKR 557,205, payable to Agilent's Meezan Bank account (IBAN PK11MEZN0011310103878455).

# 5\. End-to-End Workflow — Vendor-by-Vendor

Each stage below names the exact vendor responsible, using the Vendor/Party Directory in Section 2, so the CRM's workflow engine can assign the correct party record automatically at each step.

### Step 1 — BRD / Contract & Financial Instrument Registration

Customer Consort (SAS METM Consulting and Trading) issues the project BRD / Purchase Order to the Vendor (Ahmad Saeed Textiles or Alisha Fatima Textile) under the one-window-solution engagement. The Vendor then approaches its bank to register a Financial Instrument (EXP form) against that order.

**Vendors involved in this step:**

- Vendor: Ahmad Saeed Textiles (Pvt) Ltd / Alisha Fatima Textile — see Section 2 for NTN, REX No., IBAN.
- Customer: Consort — SAS METM Consulting and Trading, 12 allee de l'Hermitage, 45560 Saint-Denis-en-Val, France (TVA FR02912450996).
- Vendor's Bank: BankIslami Pakistan Ltd — Jail Road Branch, Lahore (Ahmad Saeed Textiles) / Sargodha Road Branch, Faisalabad (Alisha Fatima Textile).

### Step 2 — Production & Packing

Goods are manufactured and packed into cartons per SKU at the Vendor's factory. The factory issues the Packing List with carton-level and SKU-level breakdown.

**Vendors involved in this step:**

- Vendor's factory: Ahmad Saeed Textiles — Plot No. 93-94, Allama Iqbal Industrial Estate, Faisalabad / Alisha Fatima Textile — 209-RB Phattak Stop, Jaranwala Road, Faisalabad.

### Step 3 — Invoicing

The Vendor raises the Commercial Invoice referencing the Contract/Financial Instrument numbers, its REX registration, and the Packing List totals, addressed to Customer Consort.

**Vendors involved in this step:**

- Vendor: same as Step 1.
- Customer: Consort (SAS METM Consulting and Trading).

### Step 4 — Booking & Customs Filing

The Freight Forwarder books space with an Ocean Carrier. The Customs Clearing Agent files the Goods Declaration (GD-I) using the invoice and packing list data. The Port Terminal assesses handling charges once the container arrives at the terminal.

**Vendors involved in this step:**

- Freight Forwarder: Agilent Freight Services (Pvt) Ltd — Bahria Town, Lahore.
- Customs Clearing Agent: NTC Logistics Pakistan — Korangi Town, Karachi.
- Port Terminal: Qasim International Container Terminal Pakistan Ltd (QICT) — Karachi.

### Step 5 — Loading & Bill of Lading

The container is loaded on the vessel. The Ocean Carrier (through its agent) issues the Bill of Lading naming the consignee (usually the Vendor's bank, "to the order of"), the notify party (Consort), vessel/voyage and route.

**Vendors involved in this step:**

- Carrier: HMM, agent United Marine Agencies (Pvt) Ltd (Ahmad Saeed Textiles shipment).
- Carrier: Maersk, issuing office Maersk Pakistan Pvt Ltd; destination agent Antwerp Maersk Belgium NV (Alisha Fatima Textile shipment).

### Step 6 — Forwarder & Terminal Settlement

The Freight Forwarder invoices the Vendor for the total logistics cost actually incurred: ocean freight, port/terminal handling, and customs clearance charges.

**Vendors involved in this step:**

- Freight Forwarder: Agilent Freight Services (Pvt) Ltd — invoice paid into its Meezan Bank account (IBAN PK11MEZN0011310103878455).
- Port Terminal: Qasim International Container Terminal Pakistan Ltd (QICT) — Sindh Sales Tax invoice, billed via NTC Logistics Pakistan.

### Step 7 — Collection / Settlement

Shipping documents are routed through the Vendor's bank per the Financial Instrument's payment terms (e.g., CAD portion collected on presentation; DA portion collected on the agreed usance date). The Financial Instrument balance is drawn down as proceeds are realised from Customer Consort.

**Vendors involved in this step:**

- Vendor's Bank: BankIslami Pakistan Ltd (both Vendors).
- Customer: Consort (SAS METM Consulting and Trading), remitting payment per the CAD/DA terms.

### Step 8 — Closure

Once full payment is received and documents are settled, the Financial Instrument is closed by the bank and the shipment record is archived.

**Vendors involved in this step:**

- Vendor's Bank: BankIslami Pakistan Ltd.
- Vendor: Ahmad Saeed Textiles / Alisha Fatima Textile.

# 6\. Document Dependency Map (Which Document Feeds Which)

Shows which fields are authoritative (created once) versus copied/referenced downstream — these should be foreign keys in the CRM, not re-entered values.

| **Source Document**                         | **Field Reused Downstream**                                  | **Appears Again In**                                                         |
| ------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Financial Instrument (BankIslami)           | FI No., Customer, Incoterm, Value ceiling, Expiry            | Commercial Invoice, Goods Declaration, Freight Invoice                       |
| Packing List (Vendor)                       | Carton count, Piece count, Net/Gross weight, SKU description | Commercial Invoice, Bill of Lading, Goods Declaration                        |
| Commercial Invoice (Vendor)                 | Invoice No./Date, Total value, HS Codes, REX No.             | Goods Declaration, Bill of Lading cargo description, Bank collection docs    |
| Bill of Lading (Carrier: HMM/Maersk)        | B/L No., Container/Seal No., Vessel/Voyage, Port pair        | Port/Terminal Invoice, Freight Forwarder Invoice, Bank collection docs       |
| Goods Declaration (NTC Logistics / Customs) | GD No., Assessed value (PKR), HS Code assessment             | Freight Forwarder Invoice (clearance line), Bank export-proceeds realisation |

# 7\. Implications for CRM Data Model

| **Entity**                           | **Key Fields**                                                                                                             | **Relationship**                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Vendor / Party (master table)        | Name, Type (Vendor/Customer/Bank/Carrier/Forwarder/Terminal/Clearing Agent), Address, Phone, Email, NTN/STRN, Bank details | 1 Vendor/Party → many roles across many Shipments                                        |
| Vendor (Company)                     | Name, NTN, Bank name, IBAN, Address, REX Registration No.                                                                  | 1 Vendor → many Financial Instruments, many Shipments; supplies 1 or more Customers      |
| Customer                             | Name, Address, Country, VAT No.                                                                                            | 1 Customer (e.g., Consort) → many BRDs/Contracts, many Shipments, many Vendors           |
| Financial Instrument                 | FI No., Vendor, Customer, Incoterm, Currency, Value, Payment terms, Expiry date, Status, Balance                           | 1 FI → 1 Shipment; belongs to 1 Vendor + 1 Customer                                      |
| Shipment / Container                 | Container No., Seal No., Vessel, Voyage, Port pair, Gross/Net Weight, Status                                               | 1 Shipment → 1 Packing List, 1 Commercial Invoice, 1 Bill of Lading, 1 Goods Declaration |
| Packing List Item                    | SKU/Reference, Description, HS Code, Qty/box, Boxes, Pieces, Net/Gross weight                                              | Many Items → 1 Shipment                                                                  |
| Commercial Invoice                   | Invoice No., Date, Total value, Payment terms, HS Codes, Origin statement                                                  | 1 Invoice → 1 Shipment, 1 Financial Instrument                                           |
| Bill of Lading                       | B/L No., Carrier, Consignee (bank), Notify Party, Freight terms, Dates                                                     | 1 B/L → 1 Shipment; belongs to 1 Carrier vendor                                          |
| Goods Declaration                    | GD No., HS Code lines, Declared/Assessed values, Exchange rate, Officer sign-off                                           | 1 GD → 1 Shipment, 1 Commercial Invoice; filed by 1 Clearing Agent vendor                |
| Logistics Invoice (Port + Forwarder) | Invoice No., Issuing vendor, Line items, Currency, Total                                                                   | Many Logistics Invoices → 1 Shipment; each belongs to 1 Vendor                           |

## 7.1 Suggested Shipment Status / Workflow States

- BRD/Contract Registered → Financial Instrument Active
- Packing List Confirmed
- Commercial Invoice Raised
- Booking Confirmed / Customs Declaration Filed
- Shipped on Board (Bill of Lading Issued)
- Logistics Invoices Settled
- Payment Realised (CAD/DA per terms)
- Financial Instrument Closed

## 7.2 Fields Worth Flagging Automatically

- Financial Instrument expiry date approaching (both sample FIs carry hard expiry dates).
- DA (Document against Acceptance) due date — "75 days from B/L date" must be auto-calculated from the actual Bill of Lading date.
- Mismatch checks: Packing List totals vs. Commercial Invoice totals vs. Bill of Lading weights (small variances appeared between documents in the sample set).
- Currency/exchange-rate capture on the Goods Declaration, since customs values are calculated in PKR off the invoice's foreign-currency value.
- Vendor and Customer bank/contact details should be stored once per party and reused on every invoice/payment record referencing that party.

# 8\. Summary for the Roadmap

One shipment = one Financial Instrument + one Packing List + one Commercial Invoice + one Bill of Lading + one Customs Declaration + a handful of logistics invoices — raised by a Vendor (Ahmad Saeed Textiles or Alisha Fatima Textile) against Customer Consort's project, and behind every one of those documents sits a specific party from the directory in Section 2. A CRM built around "Shipment" as the central object, linked to a proper Vendor/Customer master table and to these documents as child records sharing the same reference numbers, removes both the duplicate data entry and the manual detail retyping currently happening across these paper forms.