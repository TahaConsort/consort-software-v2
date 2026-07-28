import express from "express";
import {
  listCompanies,
  createCompany,
  getCompany,
  updateCompany,
  addContact,
  updateContact,
  listCustomers,
  getCustomer,
  updateCustomer,
  createPortalUser,
} from "./company.controllers.js";
import { protect } from "../auth/auth.middleware.js";
import { requireSalesSector, requireCustomerAdmin } from "./company.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createCompanySchema,
  updateCompanySchema,
  createContactSchema,
  updateContactSchema,
  updateCustomerSchema,
  portalUserSchema,
} from "./company.validation.js";

/* ── /api/companies ── */
export const companyRouter = express.Router();
companyRouter.use(protect, requireSalesSector);

companyRouter.get("/", listCompanies);
companyRouter.post("/", validate(createCompanySchema), createCompany);

// Static segment before "/:id" so it isn't swallowed.
companyRouter.put("/contacts/:contactId", validate(updateContactSchema), updateContact);

companyRouter.get("/:id", getCompany);
companyRouter.put("/:id", validate(updateCompanySchema), updateCompany);
companyRouter.post("/:id/contacts", validate(createContactSchema), addContact);

/* ── /api/customers ── */
export const customerRouter = express.Router();
customerRouter.use(protect, requireSalesSector);

customerRouter.get("/", listCustomers);
customerRouter.get("/:id", getCustomer);
// Credit terms / BDO assignment / portal access — Management + ASM only.
customerRouter.put("/:id", requireCustomerAdmin, validate(updateCustomerSchema), updateCustomer);
customerRouter.post("/:id/portal-users", requireCustomerAdmin, validate(portalUserSchema), createPortalUser);
