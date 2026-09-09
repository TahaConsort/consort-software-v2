/**
 * The party directory — Export Shipment Workflow roadmap §2, as `vendors` rows.
 *
 * Every company, bank and agency the two sample shipments name, with the contact, tax
 * and banking details captured on the source documents, so each roadmap step can name
 * its party (carrier, forwarder, terminal, clearing agent, bank) from master data instead
 * of retyping an address. `Vendor.type` is only the default hint for the role picker —
 * the ROLE a party plays is per shipment (utils/partyRoles.js).
 *
 * Identity is `normalizedName`: the seed and scripts/applyRoadmapWorkflow.js both
 * insert-if-absent on it, so re-running never duplicates a row and an admin's later
 * edits to one of these records are left alone.
 */

export const normalizeVendorName = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");

export const ROADMAP_PARTIES = [
  {
    name: "Ahmad Saeed Textiles (Pvt) Ltd",
    type: "exporter",
    contactName: "Mozzam",
    email: "mozzam@ahmadsaeedtextiles.com",
    phone: "+92-334-8652288",
    address: "Head office: Suite 917, 9th Floor, High Q Tower, Jail Road, Gulberg V, Lahore · Factory: Plot No. 93-94, Allama Iqbal Industrial Estate, Faisalabad",
    city: "Lahore",
    country: "PK",
    currency: "EUR",
    taxId: "4240145",
    rexNo: "PKREXPK42401453",
    bankName: "BankIslami Pakistan Ltd",
    bankBranch: "Jail Road Branch, Lahore",
    iban: "PK77BKIP0200239493380001",
    accountTitle: "Ahmad Saeed Textiles (Pvt) Ltd",
    notes: "Vendor — bedsheet/textile goods supplier to Consort. Named as Exporter/Shipper on shipping documents (roadmap §2).",
  },
  {
    name: "Alisha Fatima Textile",
    type: "exporter",
    address: "209-RB Phattak Stop, Jaranwala Road, Faisalabad, Pakistan",
    city: "Faisalabad",
    country: "PK",
    currency: "EUR",
    taxId: "4097363-8",
    rexNo: "PKREXPK40973638",
    bankName: "BankIslami Pakistan Ltd",
    bankBranch: "Sargodha Road Branch, Faisalabad",
    iban: "PK85BKIP0218500031310001",
    swiftCode: "BKIPPKKAXXX",
    accountTitle: "Alisha Fatima Textile",
    notes: "Vendor — bedsheet/textile goods supplier to Consort. Named as Exporter/Shipper on shipping documents (roadmap §2).",
  },
  {
    name: "BankIslami Pakistan Ltd",
    type: "bank",
    country: "PK",
    swiftCode: "BKIPPKKA",
    notes: "Vendors' bank — registers the Financial Instrument (EXP form / BIP-EXP no.) for each vendor and handles CAD/DA collection from Consort. Branches: Jail Road, Lahore (Ahmad Saeed Textiles); Sargodha Road, Faisalabad (Alisha Fatima Textile).",
  },
  {
    name: "HMM (Hyundai Merchant Marine)",
    type: "ocean_carrier",
    country: "KR",
    notes: "Ocean carrier on the Ahmad Saeed Textiles → Consort shipment (vessel ONE RECOGNITION V0009W, booking KHIE28787300). Agent for the carrier in Pakistan: United Marine Agencies (Pvt) Ltd. Issues the Bill of Lading; carries Karachi → Antwerp.",
  },
  {
    name: "United Marine Agencies (Pvt) Ltd",
    type: "shipping_line",
    country: "PK",
    city: "Karachi",
    notes: "Agent for the carrier HMM in Pakistan — the carrier's agent named on the Ahmad Saeed Textiles Bill of Lading.",
  },
  {
    name: "Maersk (A.P. Moller-Maersk)",
    type: "ocean_carrier",
    country: "DK",
    notes: "Ocean carrier on the Alisha Fatima Textile → Consort shipment (vessel HANSA AFRICA V603S, B/L 263812461). Issuing office: Maersk Pakistan Pvt Ltd, Karachi. Destination agent: Antwerp Maersk Belgium NV.",
  },
  {
    name: "Antwerp Maersk Belgium NV",
    type: "destination_agent",
    email: "be.import@maersk.com",
    phone: "+32 33768590",
    address: "Roderveldlaan 2 bus 5, 2600 Berchem, Belgium",
    city: "Berchem",
    country: "BE",
    notes: "Maersk's destination agent at Antwerp for the Alisha Fatima Textile shipment.",
  },
  {
    name: "Agilent Freight Services (Pvt) Ltd",
    type: "freight_forwarder",
    contactName: "Shahzad Khawaja",
    email: "shahzad.khawaja@agilentfreightservices.com",
    phone: "+92 37815505",
    website: "www.agilentfreightservices.com",
    address: "2nd Floor, 81 Commercial, Umer Block, Sector B, Bahria Town, Lahore, Pakistan",
    city: "Lahore",
    country: "PK",
    currency: "PKR",
    taxId: "7289849-2",
    bankName: "Meezan Bank Limited",
    bankBranch: "Khayaban-e-Jinnah Road, Lahore",
    iban: "PK11MEZN0011310103878455",
    swiftCode: "MEZNPKKA",
    accountTitle: "Agilent Freight Services Pvt Ltd",
    notes: "Freight forwarder engaged by vendor Alisha Fatima Textile — booking, clearance coordination, freight invoicing (invoice SE/LHE/25262/2526). Account no. 1131-0103878455.",
  },
  {
    name: "Qasim International Container Terminal Pakistan Ltd (QICT)",
    type: "port_terminal",
    email: "QICTBilling@dpworld.com",
    phone: "UAN 111-786-888 · 4739100 ext. 260/261 · fax 4730021",
    address: "Berth 5-7, Marginal Wharves, PMBQ, Karachi 75020, Pakistan",
    city: "Karachi",
    country: "PK",
    currency: "PKR",
    taxId: "0823649-6",
    strn: "12-00-9805-878-37",
    notes: "Port / container terminal operator — issues the Sindh Sales Tax invoice for container handling, examination and wharfage charges, billed via the clearing agent.",
  },
  {
    name: "NTC Logistics Pakistan",
    type: "customs_agent",
    address: "Plot No. 589, Street No. 9, Sector-K, Ahata Changa Manga Road, Korangi Town, Karachi, Pakistan",
    city: "Karachi",
    country: "PK",
    currency: "PKR",
    taxId: "3224545-9",
    strn: "17-16-9999-001-55",
    notes: "Customs clearing agent — named on the QICT invoice; files the Goods Declaration (GD-I) with Pakistan Customs (WeBOC).",
  },
  {
    name: "Zanitex S.r.l.",
    type: "buyer",
    address: "Viale Caproni 18, 38068 Rovereto (TN), Italy",
    city: "Rovereto",
    country: "IT",
    currency: "EUR",
    notes: "Customer — importer of record per the LC; asked Consort to manufacture bedsheets under the one-window solution. Named as Consignee/Buyer on Ahmad Saeed Textiles' instrument BIP-EXP-320492-05012026 (EUR 122,919). Port of discharge on record: Vaprio D Adda.",
  },
  {
    name: "Javed Latif",
    type: "other",
    address: "14 Rue Saint-Robert, 63100 Clermont-Ferrand, France",
    city: "Clermont-Ferrand",
    country: "FR",
    vatNo: "518081757",
    notes: "Additional notify party on the Ahmad Saeed Textiles → Consort Bill of Lading.",
  },
  {
    name: "SAS METM Consulting and Trading (Consort)",
    type: "other",
    address: "12, allee de l'Hermitage, 45560 Saint-Denis-en-Val, France",
    city: "Saint-Denis-en-Val",
    country: "FR",
    currency: "EUR",
    vatNo: "FR02912450996",
    notes: "Consort's own French entity — the Manufacturer / one-window-solution provider to Zanitex. Named as Consignee on the Financial Instruments and Notify Party on both Bills of Lading, so it has to exist as a party to be put in those roles.",
  },
];
