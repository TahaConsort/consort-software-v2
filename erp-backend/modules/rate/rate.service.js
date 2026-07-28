import prisma from "../../config/prisma.js";

/**
 * Rate calculator (CRM_MASTER §5.20). Produces an INDICATIVE, non-binding
 * price breakdown for the public storefront. For each selected service it picks
 * the most specific active `rate_cards` row (exact lane+container > lane >
 * container > service-only) and computes a line; a hard-coded fallback keeps the
 * calculator working before any card is seeded. The authoritative price is
 * always the issued quotation (§5.7) — nothing here is persisted.
 */

// Fallback base rates (USD) per service — used when no rate card matches.
const DEFAULT_BASE = {
  local_transport: 350,
  customs_clearance: 200,
  sea_freight: 1200,
  port_handling: 300,
  lc_finance: 450,
  destination_services: 400,
};

// Fallback per-kg surcharge (USD) per service.
const DEFAULT_PER_KG = {
  local_transport: 0.02,
  sea_freight: 0.01,
};

// Container multiplier applied to the base component.
const CONTAINER_MULTIPLIER = {
  "20GP": 1,
  "40GP": 1.6,
  "40HC": 1.8,
  REEFER20: 2.1,
  REEFER40: 2.6,
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const SERVICE_LABEL = {
  local_transport: "Local Transport / Inland",
  customs_clearance: "Customs Clearance",
  sea_freight: "Sea Freight (Ocean)",
  port_handling: "Port Handling / Terminal",
  lc_finance: "LC / Trade Finance",
  destination_services: "Destination Services / Agent",
};

// Score a card against the request; -1 means a hard mismatch (a set field differs).
const scoreCard = (card, { originPort, destinationPort, containerTypeCode }) => {
  let score = 0;
  if (card.originPort) {
    if (card.originPort !== originPort) return -1;
    score += 2;
  }
  if (card.destinationPort) {
    if (card.destinationPort !== destinationPort) return -1;
    score += 2;
  }
  if (card.containerTypeCode) {
    if (card.containerTypeCode !== containerTypeCode) return -1;
    score += 1;
  }
  return score;
};

export const computeRateQuote = async ({
  services,
  originPort,
  destinationPort,
  containerTypeCode,
  weightKg,
}) => {
  const cards = await prisma.rateCard.findMany({
    where: { service: { in: services }, isActive: true },
  });

  const containerMult = CONTAINER_MULTIPLIER[containerTypeCode] ?? 1;
  const weight = Number(weightKg ?? 0);
  const lines = [];

  for (const service of services) {
    const candidates = cards
      .filter((c) => c.service === service)
      .map((c) => ({ card: c, score: scoreCard(c, { originPort, destinationPort, containerTypeCode }) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score);

    const card = candidates[0]?.card ?? null;
    const base = card ? Number(card.baseAmount) : DEFAULT_BASE[service] ?? 0;
    const perKg = card?.perKgAmount != null ? Number(card.perKgAmount) : DEFAULT_PER_KG[service] ?? 0;

    let amount = base * containerMult + perKg * weight;
    if (card?.minAmount != null) amount = Math.max(amount, Number(card.minAmount));

    lines.push({
      service,
      label: SERVICE_LABEL[service] ?? service,
      amount: round2(amount),
      estimated: !card, // true when the fallback was used
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));

  return {
    currency: "USD",
    lane: originPort && destinationPort ? `${originPort} → ${destinationPort}` : null,
    containerTypeCode: containerTypeCode ?? null,
    weightKg: weight || null,
    lines,
    subtotal,
    total: subtotal, // no taxes/margin in the indicative estimate
    disclaimer:
      "Indicative estimate only — not a binding quote. Consort will confirm pricing on a formal quotation.",
  };
};
