import prisma from "../../config/prisma.js";

/**
 * Load board (CRM_MASTER §5.20). Shared read/serialise logic used by both the
 * PUBLIC storefront (active `open` postings only) and the INTERNAL management
 * routes. This is a lead-gen shopfront — NOT the Phase-2 TMS carrier board.
 */

export const serializePosting = (p) => ({
  id: p.id,
  referenceNo: p.referenceNo,
  mode: p.mode,
  originPort: p.originPort,
  destinationPort: p.destinationPort,
  containerTypeCode: p.containerTypeCode,
  equipment: p.equipment,
  capacity: p.capacity,
  departureDate: p.departureDate,
  validUntil: p.validUntil,
  transitDays: p.transitDays,
  indicativeRate: p.indicativeRate != null ? Number(p.indicativeRate) : null,
  currency: p.currency,
  services: p.services,
  notes: p.notes,
  status: p.status,
  isActive: p.isActive,
  createdAt: p.createdAt,
});

// Public board — only active, open postings, newest sailing first.
export const listPublicPostings = async ({ mode, originPort, destinationPort, service } = {}) => {
  const where = {
    isActive: true,
    status: "open",
    ...(mode ? { mode } : {}),
    ...(originPort ? { originPort } : {}),
    ...(destinationPort ? { destinationPort } : {}),
    ...(service ? { services: { has: service } } : {}),
  };
  const postings = await prisma.loadBoardPosting.findMany({
    where,
    orderBy: [{ departureDate: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return postings.map(serializePosting);
};
