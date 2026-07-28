import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";

const IS_PROD = process.env.NODE_ENV === "production";
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// Duplicate detection key (EDGE-LD-01): lower-cased, trimmed, single-spaced.
export const normalizeName = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");

/* ─────────────────────────── Companies ─────────────────────────── */

// GET /api/companies?q=
export const listCompanies = catchAsync(async (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  const companies = await prisma.company.findMany({
    where: q ? { normalizedName: { contains: normalizeName(q) } } : undefined,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { contacts: { orderBy: { isPrimary: "desc" } } },
  });
  res.json({ success: true, data: companies });
});

// POST /api/companies — creates, but WARNS about near-duplicates (EDGE-LD-01:
// duplicate detection warns on create; both records may proceed).
export const createCompany = catchAsync(async (req, res) => {
  const normalizedName = normalizeName(req.body.name);

  const duplicates = await prisma.company.findMany({
    where: { normalizedName },
    select: { id: true, name: true, city: true, country: true },
  });

  const company = await prisma.company.create({
    data: { ...req.body, normalizedName },
  });

  res.status(201).json({
    success: true,
    message: "Company created",
    data: company,
    ...(duplicates.length ? { duplicateWarning: duplicates } : {}),
  });
});

// GET /api/companies/:id — company + contacts + customer record if converted
export const getCompany = catchAsync(async (req, res, next) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { contacts: { orderBy: { isPrimary: "desc" } } },
  });
  if (!company) return next(new AppError("Company not found", 404));

  const customer = await prisma.customer.findUnique({ where: { companyId: company.id } });
  res.json({ success: true, data: { ...company, customer } });
});

// PUT /api/companies/:id
export const updateCompany = catchAsync(async (req, res, next) => {
  const existing = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Company not found", 404));

  const data = { ...req.body };
  if (data.name) data.normalizedName = normalizeName(data.name);

  const company = await prisma.company.update({ where: { id: existing.id }, data });
  res.json({ success: true, message: "Company updated", data: company });
});

/* ─────────────────────────── Contacts ─────────────────────────── */

// Set/unset primary inside one transaction so INV-05 (exactly one primary)
// holds even before the partial unique index exists.
const writeContact = async (companyId, contactId, data) => {
  return prisma.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.contact.updateMany({ where: { companyId, isPrimary: true }, data: { isPrimary: false } });
    }
    if (contactId) {
      return tx.contact.update({ where: { id: contactId }, data });
    }
    // First contact of a company is always primary.
    const count = await tx.contact.count({ where: { companyId } });
    return tx.contact.create({
      data: { ...data, companyId, isPrimary: data.isPrimary || count === 0 },
    });
  });
};

// POST /api/companies/:id/contacts
export const addContact = catchAsync(async (req, res, next) => {
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) return next(new AppError("Company not found", 404));

  const contact = await writeContact(company.id, null, req.body);
  res.status(201).json({ success: true, message: "Contact added", data: contact });
});

// PUT /api/companies/contacts/:contactId
export const updateContact = catchAsync(async (req, res, next) => {
  const existing = await prisma.contact.findUnique({ where: { id: req.params.contactId } });
  if (!existing) return next(new AppError("Contact not found", 404));

  const contact = await writeContact(existing.companyId, existing.id, req.body);
  res.json({ success: true, message: "Contact updated", data: contact });
});

/* ─────────────────────────── Customers ─────────────────────────── */

const serializeCustomer = (customer, company, bdoUser, portalUsers = []) => ({
  id: customer.id,
  referenceNo: customer.referenceNo,
  companyId: customer.companyId,
  companyName: company?.name ?? "—",
  source: customer.source,
  assignedBdoId: customer.assignedBdoId,
  assignedBdoName: bdoUser?.employee
    ? `${bdoUser.employee.firstName} ${bdoUser.employee.lastName}`
    : bdoUser?.email ?? null,
  creditLimit: customer.creditLimit,
  creditTermsDays: customer.creditTermsDays,
  isActive: customer.isActive,
  portalUsers: portalUsers.map((u) => ({ id: u.id, email: u.email, activated: !!u.passwordHash })),
  createdAt: customer.createdAt,
});

// GET /api/customers
export const listCustomers = catchAsync(async (req, res) => {
  const customers = await prisma.customer.findMany({ orderBy: { createdAt: "desc" } });

  // Lead/Customer FKs are scalars (DATABASE §4) — join manually.
  const [companies, bdos, portalUsers] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: customers.map((c) => c.companyId) } } }),
    prisma.user.findMany({
      where: { id: { in: customers.map((c) => c.assignedBdoId).filter(Boolean) } },
      select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
    }),
    prisma.user.findMany({
      where: { customerId: { in: customers.map((c) => c.id) } },
      select: { id: true, email: true, passwordHash: true, customerId: true },
    }),
  ]);

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const bdoById = new Map(bdos.map((u) => [u.id, u]));

  res.json({
    success: true,
    data: customers.map((c) =>
      serializeCustomer(
        c,
        companyById.get(c.companyId),
        bdoById.get(c.assignedBdoId),
        portalUsers.filter((u) => u.customerId === c.id),
      ),
    ),
  });
});

// GET /api/customers/:id — customer + company + contacts + origin lead
export const getCustomer = catchAsync(async (req, res, next) => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!customer) return next(new AppError("Customer not found", 404));

  const [company, bdo, portalUsers, originLead] = await Promise.all([
    prisma.company.findUnique({
      where: { id: customer.companyId },
      include: { contacts: { orderBy: { isPrimary: "desc" } } },
    }),
    customer.assignedBdoId
      ? prisma.user.findUnique({
          where: { id: customer.assignedBdoId },
          select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
        })
      : null,
    prisma.user.findMany({
      where: { customerId: customer.id },
      select: { id: true, email: true, passwordHash: true, customerId: true },
    }),
    customer.convertedFromLeadId
      ? prisma.lead.findUnique({
          where: { id: customer.convertedFromLeadId },
          select: { id: true, referenceNo: true, createdAt: true, convertedAt: true },
        })
      : null,
  ]);

  res.json({
    success: true,
    data: {
      ...serializeCustomer(customer, company, bdo, portalUsers),
      company,
      originLead,
    },
  });
});

// PUT /api/customers/:id
export const updateCustomer = catchAsync(async (req, res, next) => {
  const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Customer not found", 404));

  if (req.body.assignedBdoId) {
    const bdo = await prisma.user.findUnique({ where: { id: req.body.assignedBdoId } });
    if (!bdo || !bdo.isActive || bdo.role === "customer") {
      return next(new AppError("Assigned BDO must be an active internal user", 400));
    }
  }

  const customer = await prisma.customer.update({ where: { id: existing.id }, data: req.body });
  res.json({ success: true, message: "Customer updated", data: customer });
});

/* ─────────────────────────── Portal users ─────────────────────────── */

// POST /api/customers/:id/portal-users — provision a portal login
// (WORKFLOW §1 "provision portal user"). Password set via /auth/activate.
export const createPortalUser = catchAsync(async (req, res, next) => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!customer) return next(new AppError("Customer not found", 404));
  if (!customer.isActive) return next(new AppError("Customer is inactive", 400));

  const { email } = req.body;
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return next(new AppError("Email is already in use", 409));

  const rawToken = crypto.randomBytes(32).toString("base64url");

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { email, role: "customer", customerId: customer.id, isActive: true },
    });
    await tx.activationToken.create({
      data: {
        userId: u.id,
        tokenHash: sha256(rawToken),
        purpose: "activation",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return u;
  });

  res.status(201).json({
    success: true,
    message: "Portal user created. Send them the activation link.",
    data: { id: user.id, email: user.email },
    ...(IS_PROD ? {} : { devActivationToken: rawToken }),
  });
});
