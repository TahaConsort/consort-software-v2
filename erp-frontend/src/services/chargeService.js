/**
 * chargeService.js — the charge-type catalog only. The shipment charge *ledger*
 * was removed; invoices are the single money record on a shipment. What survives
 * is the seeded catalog of charge codes the quote builder prices against
 * (QuotationChargeLine.chargeCode), served from the quotation module.
 */
import api from "@/lib/axios";

export const listChargeTypes = async () => (await api.get("/quotations/charge-types")).data;
