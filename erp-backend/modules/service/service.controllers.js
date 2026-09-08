import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { composeOtdPath, composeStepActions, departmentsOnPath } from "../../utils/composition.js";

/**
 * Service Selection — the service-driven core (CRM_MASTER §5.6a, ADR-040/041).
 *
 * Read-only: it exposes the closed service catalog and PREVIEWS the composed OTD path —
 * the same composition the shipment gets at quote approval (RULE-SVC-01).
 *
 * Since the service-package / CRO / LC dimension was removed there is only ONE path:
 * every active step template, in canonical order. The preview therefore takes no
 * inputs, and `GET /api/services/packages` is gone with the packages it described.
 */

// Human metadata for the services (mirrors CRM_MASTER §5.6a table).
const CATALOG = [
  { code: "local_transport",  label: "Local Transport / Inland",  ownerDepartment: "transport",           adds: "Empty-container pickup (LOLO), stuffing, inland transit to port" },
  { code: "customs_clearance", label: "Customs Clearance",         ownerDepartment: "compliance",          adds: "GD/customs declaration, inspection & container sealing" },
  { code: "sea_freight",       label: "Sea Freight (Ocean)",       ownerDepartment: "operations",          adds: "Vessel booking, CRO, BOL issuance, telex release" },
  { code: "port_handling",     label: "Port Handling / Terminal",  ownerDepartment: "operations",          adds: "Container release order (CRO), port gate-in / terminal handover" },
  { code: "lc_finance",        label: "LC / Trade Finance",        ownerDepartment: "finance",             adds: "SWIFT/LC advice, document submission to bank, escrow settlement" },
  { code: "destination_services", label: "Destination Services / Agent", ownerDepartment: "operations",     adds: "Delivery order & gate pass, destination pickup, final delivery, empty return" },
];

/* ── GET /api/services/catalog ── */
export const getCatalog = catchAsync(async (req, res) => {
  res.json({ success: true, data: CATALOG });
});

/* ── GET /api/services/reference ── ports + container types (shipment/trade form data) */
export const getReference = catchAsync(async (req, res) => {
  const [ports, containerTypes] = await Promise.all([
    prisma.port.findMany({ orderBy: { name: "asc" } }),
    prisma.containerType.findMany({ orderBy: { code: "asc" } }),
  ]);
  res.json({ success: true, data: { ports, containerTypes } });
});

/* ── POST /api/services/compose ── */
// Previews the OTD path every shipment runs. Powers the "your shipment will run N steps"
// preview so the customer sees what they are buying before they commit.
export const composePreview = catchAsync(async (req, res, next) => {
  const templates = await prisma.otdStepTemplate.findMany();
  if (templates.length === 0) {
    return next(new AppError("OTD step templates are not seeded — run `node prisma/seed.js`", 503));
  }

  const path = composeOtdPath(templates);

  // Fold each step's checklist into the preview. Without this the preview would
  // under-report badly: `order_confirmed` keeps its document pack in sub-actions, so its
  // template `requiredDocTypes` is empty and the customer would be shown no paperwork at
  // all for the step that asks for the most (ADR-048).
  const actionTemplates = await prisma.otdStepActionTemplate.findMany();
  const steps = path.map((s) => {
    const actions = composeStepActions(actionTemplates, s.stepCode);
    return {
      ...s,
      actions,
      requiredDocTypes: [
        ...new Set([...s.requiredDocTypes, ...actions.filter((a) => a.kind === "document" && a.required).map((a) => a.docType)]),
      ],
    };
  });

  res.json({
    success: true,
    data: {
      steps,
      stepCount: steps.length,
      departments: departmentsOnPath(path), // departments with a role on this shipment (RULE-SVC-02)
      // Everything the customer will be asked to upload across the whole path.
      requiredDocTypes: [...new Set(steps.flatMap((s) => s.requiredDocTypes))],
    },
  });
});
