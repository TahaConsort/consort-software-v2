import { labelForService, RFQ_LEG_LABELS } from "@/lib/catalog";

/**
 * The rate request as a vendor actually receives it — plain text, pasted into
 * WhatsApp or read down the phone.
 *
 * There is no mail transport and no vendor portal in this system, and that matches
 * how the trade works here: a transporter quotes off a WhatsApp message in minutes
 * and would never log into a portal. So the system's job is not to send anything —
 * it is to compose the exact message so ops never retypes shipment facts, and to
 * hold the replies in one comparable place.
 *
 * Deliberately excludes anything commercial: no customer name, no sell price, no
 * other vendor's number. A vendor sees the cargo, not the deal.
 */

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

const fmtWeight = (kg) => (kg == null || kg === "" ? null : `${Number(kg).toLocaleString()} kg`);

export const rfqMessageFor = ({ rfq, query, vendor }) => {
  const q = query ?? rfq?.query ?? {};
  const lines = [];

  lines.push(vendor?.contactName ? `Assalam o Alaikum ${vendor.contactName},` : "Assalam o Alaikum,");
  lines.push("");
  lines.push(`Consort Group — rate request ${rfq?.referenceNo ?? ""}`.trim());
  lines.push(`Service required: ${labelForService(rfq?.service)}`);
  if (rfq?.leg) lines.push(`Leg: ${RFQ_LEG_LABELS[rfq.leg] ?? rfq.leg}`);
  lines.push("");

  // Route. A rail leg names only ITS stretch — the vendor prices what they drive
  // (or rail), not the whole journey. Otherwise: ports for a sea/port job, door
  // addresses for inland work.
  const pickup = q.pickupAddress || q.senderAddress;
  const delivery = q.deliveryAddress || q.receiverAddress;
  if (rfq?.leg === "first_mile") {
    if (pickup) lines.push(`Pickup: ${pickup}`);
    if (q.originRailTerminal) lines.push(`Deliver to rail terminal: ${q.originRailTerminal}`);
  } else if (rfq?.leg === "middle_mile") {
    lines.push(`Rail: ${q.originRailTerminal ?? "—"} → ${q.destinationRailTerminal ?? "—"}`);
  } else if (rfq?.leg === "last_mile") {
    if (q.destinationRailTerminal) lines.push(`Pickup from rail terminal: ${q.destinationRailTerminal}`);
    if (delivery) lines.push(`Delivery: ${delivery}`);
  } else {
    if (q.originPort || q.destinationPort) {
      lines.push(`Route: ${q.originPort ?? "—"} → ${q.destinationPort ?? "—"}`);
    }
    if (q.pickupAddress) lines.push(`Pickup: ${q.pickupAddress}`);
    if (q.deliveryAddress) lines.push(`Delivery: ${q.deliveryAddress}`);
  }

  // Door contacts where this ask touches a door — operational people, never the
  // paying customer.
  const touchesPickup = !rfq?.leg || rfq.leg === "first_mile";
  const touchesDelivery = !rfq?.leg || rfq.leg === "last_mile";
  if (touchesPickup && (q.senderName || q.senderPhone)) {
    lines.push(`Pickup contact: ${[q.senderName, q.senderPhone].filter(Boolean).join(" · ")}`);
  }
  if (touchesDelivery && (q.receiverName || q.receiverPhone)) {
    lines.push(`Delivery contact: ${[q.receiverName, q.receiverPhone].filter(Boolean).join(" · ")}`);
  }

  if (q.containerTypeCode) lines.push(`Container: ${q.containerTypeCode}`);
  if (q.cargoDescription) lines.push(`Cargo: ${q.cargoDescription}`);
  const weight = fmtWeight(q.weightKg);
  if (weight) lines.push(`Weight: ${weight}`);
  if (q.incoterm) lines.push(`Incoterm: ${q.incoterm}`);

  // Handling flags change the price and the equipment, so they lead rather than hide.
  const flags = [q.isHazardous && "HAZARDOUS / DG cargo", q.isReefer && "REEFER — temperature controlled"].filter(
    Boolean,
  );
  if (flags.length) {
    lines.push("");
    lines.push(`⚠ ${flags.join(" · ")}`);
  }

  if (rfq?.notes) {
    lines.push("");
    lines.push(rfq.notes);
  }

  lines.push("");
  const by = fmtDate(rfq?.neededBy);
  lines.push(by ? `Please share your best all-in rate by ${by}.` : "Please share your best all-in rate.");
  lines.push("Kindly confirm validity and any charges not included.");
  lines.push("");
  lines.push("Thank you,");
  lines.push("Consort Group");

  return lines.join("\n");
};
