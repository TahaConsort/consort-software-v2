/**
 * Package-aware quote templates — the charge lines Ops expects to price for each
 * service package, so a quote starts as a filled-in worksheet rather than a blank one.
 *
 * `chargeCode` must exist in the seeded `charge_types` catalog
 * (erp-backend/prisma/seed.js CHARGE_TYPES), because `resolveCharge`
 * (modules/shipment/shipment.service.js) uses it at approval to place each charge on
 * the right OTD step. A code that isn't seeded silently falls back to the job level.
 */
import { labelForService } from "@/lib/catalog";

const LINE = {
  inland_transport: "Inland Transport / Trucking",
  fuel_surcharge: "Fuel Surcharge",
  loading_labour: "Loading / Unloading Labour",
  lolo: "LOLO (Lift-On/Lift-Off)",
  cro_charges: "CRO / Container Release Charges",
  port_handling: "Port Handling / THC",
  customs_clearance: "Customs Clearance / Agent Fee",
  ocean_freight: "Ocean Freight",
  documentation_fee: "Documentation / BL Fee",
  freight_forwarding_fee: "Freight Forwarding Service Fee",
  detention_demurrage: "Detention / Demurrage",
};

const TEMPLATES = {
  local_transport: ["inland_transport", "fuel_surcharge", "loading_labour"],
  loading_point_to_port: ["inland_transport", "lolo", "cro_charges", "port_handling", "documentation_fee"],
  international: [
    "ocean_freight",
    "cro_charges",
    "customs_clearance",
    "port_handling",
    "inland_transport",
    "documentation_fee",
  ],
  // Import delivery: terminal charges to get the box out, the run to the consignee, the
  // run back with the empty. Detention is priced at zero by default and only bites when
  // the free days run out — but it belongs on the sheet so nobody forgets to quote it.
  port_to_consignee: [
    "port_handling",
    "inland_transport",
    "loading_labour",
    "detention_demurrage",
    "freight_forwarding_fee",
  ],
};

// Which service each charge code belongs to, so the line carries it through to the
// shipment charge ledger.
const SERVICE_OF = {
  inland_transport: "local_transport",
  fuel_surcharge: "local_transport",
  loading_labour: "local_transport",
  lolo: "local_transport",
  cro_charges: "port_handling",
  port_handling: "port_handling",
  customs_clearance: "customs_clearance",
  ocean_freight: "sea_freight",
  documentation_fee: "sea_freight",
  freight_forwarding_fee: undefined,
  // Detention is a consequence of the whole job, not of one service — left unassigned
  // so it never lands on a step's P&L that didn't cause it.
  detention_demurrage: undefined,
};

/**
 * The charge lines to pre-seed for a query.
 *
 * @param servicePackage the query's package (null for a pre-package query)
 * @param croHandledBy   drops the CRO line when the customer supplies their own CRO —
 *                       we aren't buying it, so there is nothing to charge for
 * @param extraServices  service codes beyond the package preset; each gets its own
 *                       line so an Ops fine-tune still produces something to price
 */
export const quoteTemplateFor = ({ servicePackage, croHandledBy, extraServices = [] } = {}) => {
  const codes = [...(TEMPLATES[servicePackage] ?? [])];

  if (croHandledBy === "customer") {
    const i = codes.indexOf("cro_charges");
    if (i >= 0) codes.splice(i, 1);
  }

  const lines = codes.map((chargeCode) => ({
    chargeCode,
    service: SERVICE_OF[chargeCode],
    description: LINE[chargeCode] ?? chargeCode,
    quantity: 1,
    unitPrice: "",
  }));

  // Add-on services the template doesn't already cover get a line each, labelled so
  // it survives the "description required" filter in the quote dialog.
  const covered = new Set(lines.map((l) => l.service).filter(Boolean));
  for (const svc of extraServices) {
    if (!covered.has(svc)) {
      lines.push({ service: svc, description: labelForService(svc), quantity: 1, unitPrice: "" });
      covered.add(svc);
    }
  }

  // A pre-package query has no template; fall back to one line per selected service so
  // the dialog is never empty.
  return lines.length ? lines : [{ description: "", quantity: 1, unitPrice: "" }];
};
