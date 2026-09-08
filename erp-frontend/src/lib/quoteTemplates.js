/**
 * Service-aware quote templates — the charge lines Ops expects to price for each
 * service, so a quote starts as a filled-in worksheet rather than a blank one.
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

// The charge lines each SERVICE brings to the sheet. Keyed on service code now that the
// package layer is gone; a query selecting several services unions their lines, in this
// declaration order, without repeating a code.
const TEMPLATES = {
  local_transport: ["inland_transport", "fuel_surcharge", "loading_labour"],
  port_handling: ["lolo", "cro_charges", "port_handling"],
  customs_clearance: ["customs_clearance"],
  sea_freight: ["ocean_freight", "documentation_fee"],
  lc_finance: ["freight_forwarding_fee"],
  // Destination delivery: the run to the consignee and the run back with the empty.
  // Detention is priced at zero by default and only bites when the free days run out —
  // but it belongs on the sheet so nobody forgets to quote it.
  destination_services: ["inland_transport", "detention_demurrage"],
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
 * @param services      the query's selected services. Free text, so anything without a
 *                      template contributes nothing but still gets its own line below.
 * @param extraServices services with no template of their own; each gets a bare line so
 *                      an Ops fine-tune still produces something to price
 */
export const quoteTemplateFor = ({ services = [], extraServices = [] } = {}) => {
  const codes = [];
  for (const svc of services) {
    for (const code of TEMPLATES[svc] ?? []) {
      if (!codes.includes(code)) codes.push(code);
    }
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
