import crypto from "crypto";
import { allocateRef } from "../../utils/referenceNumber.js";

/**
 * Shared intake materialisation (CRM_MASTER §5.21). Given a triaged intake record
 * it creates — in ONE transaction — a company + contact + customer (respecting
 * INV-06) + a converted lead + a query carrying the selected services.
 *
 * The *bank_lc* (Bank LC Referral) channel is the only caller left; the shape is
 * still channel-agnostic (the `source` is passed in) so a second intake channel
 * can reuse it without rework.
 *
 * Call INSIDE a prisma.$transaction; returns the created rows and event payloads
 * so the caller can attach channel-specific outbox events + back-links.
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// Company dedupe key. Exported so every path that can mint a company — intake
// conversion and the inline "new customer" on a query — folds the same way; two
// normalizers that drift produce duplicate companies for the same name.
export const normalizeName = (s) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Keep only reference codes that actually exist; silently drop unknowns so a
// triage convert never hard-fails on a stale port/container code.
const sanitizeRefs = async (tx, { originPort, destinationPort, containerTypeCode }) => {
  const ports = [originPort, destinationPort].filter(Boolean);
  let validPorts = new Set();
  if (ports.length) {
    const found = await tx.port.findMany({ where: { code: { in: ports } }, select: { code: true } });
    validPorts = new Set(found.map((p) => p.code));
  }
  let container = null;
  if (containerTypeCode) {
    const ct = await tx.containerType.findUnique({ where: { code: containerTypeCode } });
    if (ct) container = containerTypeCode;
  }
  return {
    originPort: originPort && validPorts.has(originPort) ? originPort : null,
    destinationPort: destinationPort && validPorts.has(destinationPort) ? destinationPort : null,
    containerTypeCode: container,
  };
};

export const materializeCustomerAndQuery = async (
  tx,
  {
    source, // 'direct' | 'bank_lc'
    ownerId, // owning user (converting salesperson / ops_exec)
    createdById,
    companyName,
    contactName,
    contactEmail,
    contactPhone,
    country,
    services,
    pickupAddress,
    destinationAddress,
    originPort,
    destinationPort,
    containerTypeCode,
    note,
  },
) => {
  // 1. Company (dedupe by normalized name).
  const displayName = companyName?.trim() || `${contactName} (intake)`;
  const normalizedName = normalizeName(displayName);
  let company = await tx.company.findFirst({ where: { normalizedName } });
  if (!company) {
    company = await tx.company.create({
      data: { name: displayName, normalizedName, country: country ?? null },
    });
  }

  // 2. Customer (INV-06 — one per company; reuse if it already exists).
  let customer = await tx.customer.findUnique({ where: { companyId: company.id } });
  let customerCreated = false;
  if (!customer) {
    const referenceNo = await allocateRef(tx, "customer");
    customer = await tx.customer.create({
      data: {
        referenceNo,
        companyId: company.id,
        source,
        assignedBdoId: ownerId,
      },
    });
    customerCreated = true;
  }

  // 3. Contact (first on the company becomes primary).
  const contactCount = await tx.contact.count({ where: { companyId: company.id } });
  const contact = await tx.contact.create({
    data: {
      companyId: company.id,
      name: contactName,
      email: contactEmail ?? null,
      phone: contactPhone ?? null,
      isPrimary: contactCount === 0,
    },
  });

  // 4. Lead — recorded as already converted, for source/history tracking.
  //
  // A customer originates from exactly ONE lead (convertedToCustomerId is unique), and
  // the customer above is reused whenever the company already exists (INV-06). So the
  // SECOND intake from a company we already serve — a repeat LC from the same importer
  // — must attach to that customer's existing lead. Creating one
  // unconditionally, as this did, made every such conversion die on a unique-constraint
  // 500 with nothing saved and no usable message.
  let lead = await tx.lead.findFirst({ where: { convertedToCustomerId: customer.id } });
  const leadIsNew = !lead;
  if (!lead) {
    const leadRef = await allocateRef(tx, "lead");
    lead = await tx.lead.create({
      data: {
        referenceNo: leadRef,
        companyId: company.id,
        contactId: contact.id,
        source,
        status: "converted",
        ownerId,
        createdById,
        convertedAt: new Date(),
        convertedToCustomerId: customer.id,
      },
    });
  }
  await tx.leadStatusHistory.create({
    data: {
      leadId: lead.id,
      fromStatus: null,
      toStatus: "converted",
      actorId: createdById,
      notes: note ?? "Created from intake channel",
    },
  });
  // The history entry is written either way — it is the record of THIS intake landing
  // on the lead — but `lead.created` only fires for a lead that was actually created.
  if (leadIsNew) {
    await emitEvent(tx, "lead.created", { leadId: lead.id, referenceNo: lead.referenceNo, source });
  }

  // 5. Query — a plain enquiry now. The intake channel carries the services verbatim.
  //    Addresses are required on a query, so an intake that only knew the ports falls
  //    back to the port codes rather than refusing to convert.
  const finalServices = services ?? [];
  const refs = await sanitizeRefs(tx, { originPort, destinationPort, containerTypeCode });
  const queryRef = await allocateRef(tx, "query");
  const query = await tx.query.create({
    data: {
      referenceNo: queryRef,
      customerId: customer.id,
      raisedById: ownerId,
      // The intake channel IS the query's channel: a bank-LC referral lands in the
      // Bank LC bucket on the Queries screen, not in BDO's (channel tabs).
      raisedVia: source === "bank_lc" ? "bank_lc" : "bdo",
      customerName: contactName,
      customerEmail: contactEmail ?? "",
      customerPhone: contactPhone ?? "",
      pickupAddress: pickupAddress ?? refs.originPort ?? "Not specified",
      destinationAddress: destinationAddress ?? refs.destinationPort ?? "Not specified",
      services: finalServices,
    },
  });
  await emitEvent(tx, "query.created", { queryId: query.id, referenceNo: queryRef, services: finalServices });

  // 6. Portal login (CRM_MASTER §5.16). A converted customer must be able to act
  //    on their OWN quotes — approve/reject in the portal (§5.7) — instead of the
  //    decision being made internally on their behalf. So provision a portal user
  //    and an activation invite, the same single-use hashed-token flow employees
  //    use (RULE-EMP-01): the password is null until they follow the link.
  //    Guarded — only for a brand-new customer with a usable email that isn't
  //    already a login, so a reused customer (INV-06) or a shared email never
  //    gets a second account. No email on the intake → no invite is possible;
  //    the internal-approval fallback still stands for that customer.
  let portalInviteToken = null;
  if (customerCreated && contactEmail) {
    const emailTaken = await tx.user.findFirst({
      where: { email: { equals: contactEmail, mode: "insensitive" } },
      select: { id: true },
    });
    if (!emailTaken) {
      const raw = crypto.randomBytes(32).toString("base64url");
      const portalUser = await tx.user.create({
        data: { email: contactEmail, role: "customer", customerId: customer.id }, // passwordHash null until activation
      });
      await tx.activationToken.create({
        data: {
          userId: portalUser.id,
          tokenHash: sha256(raw),
          purpose: "activation",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      portalInviteToken = raw; // surfaced to the caller for non-prod delivery; never stored raw
      await emitEvent(tx, "customer.invited", {
        customerId: customer.id,
        customerRef: customer.referenceNo,
        userId: portalUser.id,
        email: contactEmail,
        ownerId,
      });
    }
  }

  return { company, customer, customerCreated, contact, lead, query, portalInviteToken };
};
