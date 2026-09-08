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

export const rfqMessageFor = ({ rfq, query, vendor }) => {
  const q = query ?? rfq?.query ?? {};
  const lines = [];

  lines.push(vendor?.contactName ? `Assalam o Alaikum ${vendor.contactName},` : "Assalam o Alaikum,");
  lines.push("");
  lines.push(`Consort Group — rate request ${rfq?.referenceNo ?? ""}`.trim());
  lines.push(`Service required: ${labelForService(rfq?.service)}`);
  if (rfq?.leg) lines.push(`Leg: ${RFQ_LEG_LABELS[rfq.leg] ?? rfq.leg}`);
  lines.push("");

  // Route. A query records the two doors; a legged ask names the end it touches so the
  // vendor prices what they actually drive rather than the whole journey.
  const pickup = q.pickupAddress;
  const delivery = q.destinationAddress;
  if (rfq?.leg === "first_mile") {
    if (pickup) lines.push(`Pickup: ${pickup}`);
  } else if (rfq?.leg === "last_mile") {
    if (delivery) lines.push(`Delivery: ${delivery}`);
  } else {
    if (pickup) lines.push(`Pickup: ${pickup}`);
    if (delivery) lines.push(`Delivery: ${delivery}`);
  }

  // The one contact the query carries, where this ask touches a door.
  if (q.customerName || q.customerPhone) {
    lines.push(`Site contact: ${[q.customerName, q.customerPhone].filter(Boolean).join(" · ")}`);
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
