import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { composeOtdPath, composeStepActions, departmentsOnPath } from "../../utils/composition.js";
import {
  allowedCroModes,
  CRO_HANDLING_LABELS,
  inferPackageFromServices,
  PACKAGE_SERVICES,
  packageUsesDeliveryAddress,
  packageUsesDestinationPort,
  packageUsesImportTerms,
  packageUsesPickupAddress,
  packageUsesPorts,
  resolveCroMode,
  resolveServices,
  SERVICE_PACKAGE_DESCRIPTIONS,
  SERVICE_PACKAGE_LABELS,
  SERVICE_PACKAGES,
} from "../../utils/servicePackage.js";

/**
 * Service Selection — the service-driven core (CRM_MASTER §5.6a, ADR-040/041).
 *
 * Read-only: it exposes the closed service catalog and PREVIEWS the composed
 * OTD path for a chosen service set — the same composition the shipment gets at
 * quote approval (RULE-SVC-01). The frontend uses this to show "a local order
 * runs 4 short steps; sea-freight + customs + LC runs the full 14".
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

/* ── GET /api/services/reference ── ports + container types (query form data) */
export const getReference = catchAsync(async (req, res) => {
  const [ports, containerTypes] = await Promise.all([
    prisma.port.findMany({ orderBy: { name: "asc" } }),
    prisma.containerType.findMany({ orderBy: { code: "asc" } }),
  ]);
  res.json({ success: true, data: { ports, containerTypes } });
});

/* ── POST /api/services/compose  { servicePackage, croHandledBy?, services? } ── */
// Previews the OTD path a shipment with this package would run — the same composition
// it gets at quote approval. Powers the "your shipment will run N steps" preview on the
// enquiry form, so the customer sees what they are buying before they commit.
export const composePreview = catchAsync(async (req, res, next) => {
  const templates = await prisma.otdStepTemplate.findMany();
  if (templates.length === 0) {
    return next(new AppError("OTD step templates are not seeded — run `node prisma/seed.js`", 503));
  }

  // Accepts a package (the modern shape) or a bare service list (older callers), for
  // which a package is inferred rather than composing a half-path.
  const servicePackage = req.body.servicePackage ?? inferPackageFromServices(req.body.services ?? []);
  const croHandledBy = resolveCroMode({ servicePackage, croHandledBy: req.body.croHandledBy });
  const services = resolveServices({ servicePackage, services: req.body.services });

  const path = composeOtdPath(templates, { services, servicePackage, croHandledBy });

  // Fold each step's checklist into the preview. Without this the preview would
  // under-report badly: `order_confirmed` keeps its document pack in sub-actions, so its
  // template `requiredDocTypes` is empty and the customer would be shown no paperwork at
  // all for the step that asks for the most (ADR-048).
  const actionTemplates = await prisma.otdStepActionTemplate.findMany();
  const steps = path.map((s) => {
    const actions = composeStepActions(actionTemplates, s.stepCode, { services, servicePackage, croHandledBy });
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
      servicePackage,
      servicePackageLabel: SERVICE_PACKAGE_LABELS[servicePackage],
      croHandledBy,
      services,
      steps,
      stepCount: steps.length,
      departments: departmentsOnPath(path), // departments with a role on this shipment (RULE-SVC-02)
      // Everything the customer will be asked to upload across the whole path.
      requiredDocTypes: [...new Set(steps.flatMap((s) => s.requiredDocTypes))],
    },
  });
});

/* ── GET /api/services/packages ── the offerings + their CRO options and route shape */
export const getPackages = catchAsync(async (req, res) => {
  res.json({
    success: true,
    data: SERVICE_PACKAGES.map((code) => ({
      code,
      label: SERVICE_PACKAGE_LABELS[code],
      description: SERVICE_PACKAGE_DESCRIPTIONS[code],
      services: PACKAGE_SERVICES[code],
      croModes: allowedCroModes(code).map((m) => ({ code: m, label: CRO_HANDLING_LABELS[m] })),
      usesPorts: packageUsesPorts(code),
      usesDestinationPort: packageUsesDestinationPort(code),
      // Which door fields the intake form should ask for. port_to_consignee is the
      // first package to want a port AND an address, so a client cannot infer these
      // from usesPorts alone any more.
      usesPickupAddress: packageUsesPickupAddress(code),
      usesDeliveryAddress: packageUsesDeliveryAddress(code),
      usesImportTerms: packageUsesImportTerms(code),
    })),
  });
});
