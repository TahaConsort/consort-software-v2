import * as vendorService from "@/services/vendorService";
import * as shipmentService from "@/services/shipmentService";
import * as queryService from "@/services/queryService";
import * as leadService from "@/services/leadService";
import * as employeeService from "@/services/employeeService";
import * as chargeService from "@/services/chargeService";
import * as serviceCatalogService from "@/services/serviceCatalogService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Reference data for dialog pickers — vendors, shipments, open queries, open leads,
 * departments, charge types and the service catalog.
 *
 * These lists were previously fetched once per dialog mount with `useEffect(…, [])` and
 * no invalidation path anywhere, in six different places. A vendor or shipment created
 * minutes earlier was simply not selectable until the tab was reloaded.
 *
 * It exists separately from the domain list stores for a specific reason. Dialogs used to
 * reach for `useLeadStore.fetchLeads()`, which applies the LEADS PAGE's filters — so
 * setting that page's filter to "lost" and then opening Plan Visit produced an empty Lead
 * dropdown with no explanation, and no amount of reloading fixed it because the filter was
 * the cause. A picker needs the unfiltered set, which is what this provides.
 *
 * Everything is best-effort and permission-gated: a user without `invoice.create` has no
 * business fetching vendors, and one failing list must not empty the others.
 */
export const useReferenceStore = createResourceStore({
  name: "reference",
  // Owns every topic whose collection feeds a picker, so a newly created row shows up.
  topics: [
    TOPICS.VENDORS, TOPICS.SHIPMENTS, TOPICS.QUERIES,
    TOPICS.LEADS, TOPICS.EMPLOYEES, TOPICS.WORKFLOW,
  ],

  state: {
    vendors: [],
    shipments: [],
    queries: [],
    leads: [],
    departments: [],
    chargeTypes: [],
    catalogReference: null,
  },

  /**
   * `fetch("vendors", "shipments", …)` loads only what the caller needs. The set is part
   * of the read identity so two dialogs asking for different slices don't fight, and
   * `ifAbsent` can skip a slice that is already in hand.
   */
  keyOf: (args) => {
    const wanted = args.filter((a) => typeof a === "string");
    return wanted.length ? wanted.slice().sort().join("+") : "none";
  },

  load: async ({ args }) => {
    const wanted = new Set(args.filter((a) => typeof a === "string"));
    const jobs = [];
    const add = (key, fn) => { if (wanted.has(key)) jobs.push([key, fn()]); };

    add("vendors", () => vendorService.listVendors({ isActive: true }).then((r) => ({ vendors: r.data ?? [] })));
    add("shipments", () => shipmentService.listShipments().then((r) => ({ shipments: r.data ?? [] })));
    add("queries", () => queryService.listQueries().then((r) => ({ queries: r.data ?? [] })));
    add("leads", () => leadService.listLeads().then((r) => ({ leads: r.data ?? [] })));
    add("departments", () => employeeService.listDepartments().then((r) => ({ departments: r.data ?? [] })));
    add("chargeTypes", () => chargeService.listChargeTypes().then((r) => ({ chargeTypes: r.data ?? [] })));
    add("catalog", () => serviceCatalogService.getReference().then((r) => ({ catalogReference: r.data ?? null })));

    const settled = await Promise.allSettled(jobs.map(([, p]) => p));
    // One slice failing (usually a permission the user doesn't hold) must not blank the
    // others — a half-populated dialog beats an empty one.
    return settled.reduce((patch, r) => (r.status === "fulfilled" ? { ...patch, ...r.value } : patch), {});
  },
});
