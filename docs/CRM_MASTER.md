# CRM_MASTER.md
# Consort Group — CRM Master Specification
**Scope:** Phase 1 — CRM. TMS deferred to Phase 2, Banking/Escrow to Phase 3.
**Authority:** `DECISIONS.md` outranks this document. Everything else is subordinate to it.
*Document history lives in git — this file carries no manual version bookkeeping.*

---

## 1. Vision

Consort Group's CRM is the **control tower** for customer-facing and internal operations — Phase 1 of a One-Window Financial-Logistics Ecosystem that will later absorb TMS, Finance, Customer Portal and Banking.

Five things it must do extremely well:

1. **Employee and access management** — Management and HR control who logs in, what they see, and what they may do. Adding, editing and offboarding an employee (with role and department) is a first-class workflow.
2. **Lead-to-customer pipeline** — customers arrive through **three acquisition channels** (BDO outreach, Bank LC referral, or a direct client), and the pipeline runs from first contact to signed customer. BDOs and ASMs also plan and log **field visits** (Visit Plans) to win and retain clients.
3. **Service-driven query-to-shipment execution** — Operations converts approved quotes into live shipments, and **the shipment's steps, the departments involved and the tasks auto-assigned are all composed from the services the customer selected**. A local-transport-only order runs a short standard path with no Compliance/Customs; a full sea-freight-with-LC order runs the complete 14-step path. Every assigned employee must **submit/confirm their task** to advance the shipment.
4. **End-to-end visibility** — every role sees exactly the slice of reality it owns, in real time. Changing an employee's role changes their dashboard and the shipments/tasks they see. Customers track only their own shipments, in plain language, across the stages their order actually has.
5. **Automatic work distribution** — state changes distribute tasks to the responsible field employee with no manual coordination, scoped to the services in play.

---

## 2. Guiding Principles

- **Role-first design.** Every screen, field and endpoint is designed for a specific role. No generic admin panels.
- **One source of truth per concept.** A fact is modelled once. `shipments.status` is derived from OTD steps rather than maintained beside them; permissions live in one package; audit is written in one place. Duplicated truth is the defect that produced most of v1's contradictions.
- **Automated action engine.** State changes distribute work automatically. No manual coordination, and no silently dropped work — unroutable actions escalate.
- **Reliability over cleverness.** Business state, audit and event emission commit together or not at all (transactional outbox). At-least-once delivery is made safe with idempotency keys.
- **Default deny.** Documents are internal until published. Scope is applied in the repository, not remembered by a controller. Out-of-scope reads return 404, not 403.
- **Reality has exceptions.** Shipments get held, cancelled and reopened; leads come back from the dead; employees resign mid-shipment. The model represents all of it.
- **Audit everything.** Every state change, action and login is recorded with actor, timestamp, correlation id and a field-level diff.
- **Future-proof schema.** Columns for TMS, GPS and banking exist now and stay null until Phase 2/3.

---

## 3. User Roles

| Role | Code | Department | Primary responsibility |
|---|---|---|---|
| CEO | `ceo` | Management | Full visibility, no data entry required |
| Project Director | `project_director` | Management | Full visibility, strategic oversight |
| Director | `director` | Management | Full visibility, operational oversight |
| CFO | `cfo` | Management | Full visibility, finance oversight, employee management |
| General Manager | `gm` | Management | Employee management, KPI review |
| HR Manager | `hr` | HR | Employee records, onboarding, offboarding |
| Area Sales Manager | `asm` | Sales | BDO oversight, quote approval on behalf of customers |
| Business Development Officer | `bdo` | Sales | Leads, outreach, queries, customer relationship |
| Operations Manager | `ops_manager` | Operations | Quote issuance, shipment oversight, exceptions |
| Operations Executive | `ops_exec` | Operations | Quote drafting, OTD execution |
| Compliance Manager | `compliance_manager` | Compliance | Compliance oversight, customs escalation |
| Compliance Executive | `compliance_exec` | Compliance | GD filing, inspection, sealing, LC documentation |
| Transport Manager | `transport_manager` | Transport | Fleet and container coordination |
| Transport Executive | `transport_exec` | Transport | Transporter booking, dispatch, loading, inland transit, POD |
| Accounts | `accounts` | Finance | Invoicing, payments, OTC milestones |
| Customer | `customer` | External | Own shipments, quote decisions, queries |

The five Management roles (`ceo`, `project_director`, `director`, `cfo`, `gm`) hold **identical** permissions — full visibility and employee management. There is no partial-management tier — v1's inconsistent treatment of `gm` and `project_director` came from pretending otherwise. `cfo` sits in the Management tier for access purposes and additionally heads the Finance department (§4); the finance-oversight duty is a reporting emphasis, not a separate permission set.

The **admin/management sector** — Management (`ceo`, `project_director`, `director`, `cfo`, `gm`) plus `hr` — is who manages employees: create an employee with a role and department, edit their details, and remove them. Removal is **deactivate-and-reassign**, never a raw delete: an employee who owns open work cannot be removed until that work is reassigned (RULE-EMP-02, §5.2). This protects shipment and task ownership history.

`hr` and `transport_manager` are **live Phase 1 roles** with dashboards, permissions and scope, not stubs. v1 left both unable to reach any working screen.

`transport_exec` exists because the Local Transport package (ADR-046) puts five of its six steps on the Transport department. With `transport_manager` as the department's only member, `resolveAssignee` (RULE-AE-03) routed every one of those tasks to one person. It mirrors `compliance_exec`: step completion for its own department, its own tasks and the department queue, no oversight permissions.

### 3.1 Hierarchy

```
Management ── ceo · project_director · director · cfo · gm
    ├── Department heads ── asm · ops_manager · compliance_manager · transport_manager
    │       └── Executives ── bdo · ops_exec · compliance_exec · transport_exec · accounts
    ├── HR ── hr  (people, not deals)
    └── Customer (external, portal, read-mostly)
```

`cfo` is the Finance department head; `accounts` executes under it.

### 3.2 Permissions

The complete permission vocabulary, the role matrix and the row-level scope table are in **`BUSINESS_RULES.md` §2**. They are generated from `packages/contracts`, which is the single authority for both apps (ADR-005).

---

## 4. Departments

Sales · Operations · Compliance · Finance · HR · Management · Transport.

Each has a head (`departments.head_user_id`). Employees belong to one department. Department membership drives task queues, chat channels, OTD step ownership and the `department` access scope.

---

## 5. Modules

### 5.1 Authentication & Access
JWT access tokens (15 min, memory-only) with rotating `HttpOnly` refresh tokens and reuse detection. Permission-based route guards on both tiers. Password reset and account activation by hashed single-use token. Multi-device sessions with per-session revocation. Account lockout and a complete login-activity log. Global invalidation through `token_version`. See ADR-009, ADR-033.

### 5.2 Employee Management
Owned by the **admin/management sector** — Management (`ceo`, `project_director`, `director`, `cfo`, `gm`) and `hr`. Create, edit and deactivate employees, with or without a login, each carrying a **role and a department**. Role, department and reporting manager with cycle detection. Editing an employee's role re-scopes their dashboard and the shipments/tasks they can see (§5.17). **Removal is deactivate-and-reassign, not a raw delete:** deactivation is blocked while the employee owns open work and drives a reassignment wizard (RULE-EMP-02) before the account is switched off — the offboarding case that corrupts ownership data in most CRMs. Ownership and audit history are retained after deactivation.

### 5.3 Company, Contact & Customer
Companies with duplicate detection; contacts with exactly one primary; customers 1:1 with a company, carrying a customer code, assigned BDO, credit terms and portal users. A unified customer timeline aggregates outreach, queries, quotes, shipment milestones, invoices and documents.

### 5.4 Lead Management
Customers — and the queries they raise — enter through **three acquisition channels**, recorded on the lead/customer as `source`. Each channel has a concrete **intake mechanism**:

1. **BDO** (`source = bdo`) — a Business Development Officer generates the lead through outreach and raises queries on the customer's behalf from inside the CRM. This is the manual, relationship-led channel.
2. **Direct client** (`source = direct`) — the customer approaches Consort directly. The concrete front door is the **public storefront** (§5.20): a visitor browses the load board and prices a shipment freely, but requesting a formal quote requires **self-registration** (§5.16a), which provisions their company, customer record and portal login and submits their selection as a query. Existing portal customers raise further queries the same way (§5.16).
3. **Bank LC** (`source = bank_lc`) — the customer is referred via a bank Letter of Credit arrangement. The concrete intake is the **Bank LC webhook** (§5.21): the bank posts the LC to Consort automatically, it lands as a **Bank LC Referral** in the Operations inbox, and `ops_exec` converts it straight into a customer + query and prices it. These shipments are LC-backed and carry the LC/trade-finance steps (`lc_finance` is implied, §5.6a/RULE-SVC-04).

All three converge on the same object: a **Query** carrying selected services (§5.6). The channel only differs in *how the query is born*; everything downstream (quote → shipment → OTD/OTC) is identical.

Reference-numbered leads run `new → contacted → qualified → converted`, with `lost` reachable from anywhere and reversible by reopen. Loss reasons are mandatory and are what the conversion report is built on. Full status history; company and contact created once, at lead creation.

### 5.5 Outreach
Call, email, meeting, WhatsApp, LinkedIn and site visit, with outcome, duration and follow-up scheduling. Drives lead auto-advance and the follow-ups-due dashboard. **Planned, scheduled client visits are managed as Visit Plans (§5.5a), not ad-hoc outreach.**

### 5.5a Visit Plans
A **Visit Plan** is a scheduled field visit by a BDO or ASM to meet and convince a prospect or existing client. It carries the target company/contact, purpose, planned date/time and location, the assigned salesperson, and a status (`planned → completed | cancelled | no_show`). On completion it captures a visit outcome and next-step follow-up, and links back to the lead or customer timeline. Visit Plans surface on the Sales dashboard as an upcoming-visits calendar and feed the same follow-ups-due view as outreach. ASMs see their team's plans; BDOs see their own; Management sees all.

### 5.6 Query Management
A shipping request from a customer that carries the selected services. A query is **born through one of three intake paths**, matching the acquisition channels (§5.4): (a) a **BDO/ASM raises it** directly for their customer; (b) a **Public Inquiry** submitted on the anonymous storefront (§5.20) is triaged by Sales into a customer + query; (c) a **Bank LC Referral** received on the webhook (§5.21) is converted by `ops_exec` into a customer + query. Whatever the path, the resulting row is one canonical `Query`. Validated ports, container types and Incoterms; hazardous and reefer cargo auto-create a Compliance pre-check. Cancellation reasons feed an unserved-demand report.

**The query captures the services the customer wants** (see §5.6a). The selected services are carried through the quotation onto the resulting shipment, where they determine the shipment's step template, the departments involved and the tasks the Action Engine creates.

### 5.6a Service Selection (the service-driven core)
Consort is an à-la-carte logistics partner. Every query/quote records a **set of selected services** drawn from the service catalog:

| Service | Code | Owning department | Adds |
|---|---|---|---|
| Local Transport / Inland | `local_transport` | Transport | Vehicle/container allocation, cargo pickup, delivery & POD |
| Customs Clearance | `customs_clearance` | Compliance | GD/customs declaration, inspection & container sealing |
| Sea Freight (Ocean) | `sea_freight` | Operations | Booking confirmation, pre-arrival docs, BOL issuance, telex release |
| Port Handling / Terminal | `port_handling` | Operations / Transport | Container release order (CRO), terminal handover, vessel loading position |
| LC / Trade Finance | `lc_finance` | Finance | SWIFT/LC advice, document submission to bank, escrow-backed final settlement |

`lc_finance` is implied for any shipment whose acquisition channel is **Bank LC** (§5.4) and may also be added explicitly. **The selected services compose the shipment's OTD step template (§5.9).** A local-transport-only order therefore has no Compliance or Customs role, no bank/BOL steps, and runs the short standard-local path; adding sea freight, customs and LC extends it up to the full 14-step international path. The catalog is enum-based in Phase 1; adding a service is a schema + template change, not runtime configuration.

### 5.7 Quotation
Itemised charge lines with server-computed totals. `ops_exec` drafts, `ops_manager` sends — four-eyes on outbound pricing. Revisions are new versions linked to their parent. Expiry is automatic. Approval by customer, ASM or Management, never by the owning BDO.

### 5.8 Shipment
Created only as a consequence of quote approval, **carrying the services selected on the approved quotation**. Progress is written through OTD steps; status is derived. The set of OTD steps is not fixed — it is the **template composed from the shipment's services** (§5.9). Exceptions (hold, resume, cancel) are orthogonal to progress and stop SLA clocks. Tabs: Overview, OTD, OTC, Documents, Invoices, Timeline, Chat.

### 5.9 OTD — Order to Delivery (service-driven template)
The **canonical 14 steps (ADR-003) are the full superset** — the path for a sea-freight, customs-cleared, LC-backed international shipment. **Each shipment runs only the subset its selected services require** (§5.6a), always in canonical order. Steps 1 (Order Lock) and the final delivery/settlement step are present on every shipment; the rest are switched on by service:

- **Local Transport / Inland** → vehicle-or-container allocation, cargo pickup, delivery & POD.
- **Sea Freight** → booking confirmation, pre-arrival documentation, BOL issuance, telex release.
- **Port Handling** → container release order (CRO), terminal handover, vessel loading position.
- **Customs Clearance** → customs declaration (GD), inspection & container sealing.
- **LC / Trade Finance** → SWIFT/LC advice, document submission to bank, escrow-backed settlement & title transfer.

So a **local-transport-only** shipment runs a four-stage standard path — Order Lock → Allocation → Cargo Pickup → Delivery & POD — with **no Compliance/Customs step and no owning role for those departments**. A shipment that also buys sea freight, customs and LC grows toward the full 14. The composition rules and per-service step tables are in `WORKFLOW.md §4a`.

Each step has an **owning department** that governs who may complete it, and completion is an explicit act: the assigned field employee must **submit/confirm the step's task** for the shipment to advance. Sequence is enforced with the documented out-of-order exception; forced overrides require authority and a justification; reopening cascades forward.

### 5.10 OTC — Order to Cash
Five financial milestones. The first two are completed automatically by invoice issuance and payment; the rest by Accounts. All five complete → the shipment derives to `settled`.

### 5.11 Finance
Invoices auto-drafted from the approved quotation, issued by Accounts, paid in full or part, voidable only when unpaid. Payments recorded with method and reference. FX captured at commit. This is the revenue model v1 reported on but never built (ADR-006).

### 5.12 Action Engine
Domain events — not statuses — trigger templated tasks. **Only the templates for steps present on the shipment's service-composed OTD path fire** — a local-only shipment never generates a customs or LC task because those steps do not exist on it. Assignment follows a deterministic four-step chain ending in a department queue, and lands on the field employee who owns the step; that employee must submit/confirm the task to advance the shipment. Idempotency keys make replay safe; unroutable actions escalate to Management. Suppressed for held, cancelled and closed shipments.

### 5.13 Documents
Polymorphic ownership across shipments, quotations, queries, leads, customers, tasks and chat. **Internal by default**; publishing to the portal is an explicit audited act. Size and type validated, magic bytes sniffed, checksums deduplicated, virus-scanned, downloads presigned and audited.

### 5.14 Internal Chat
Shipment, department, general and direct channels. Per-member read markers drive unread counts. Idempotent sends, replies, edit window, soft delete, attachments. Customers are never members.

### 5.15 Notifications
In-app and email in Phase 1, WhatsApp in Phase 1.5. Per-user, per-type, per-channel preferences with two operationally mandatory exceptions. Grouping, priority, action links, quiet hours, and per-channel delivery tracking so "I never received it" is answerable.

### 5.16 Customer Portal
Separate layout, same API. Own shipments in plain language, quote decisions, new queries, published documents, invoices, notification preferences. Never internal notes, chat, margin or other customers.

### 5.17 Dashboards
One role-aware endpoint; a defined payload for every role. **The role determines the view** — changing an employee's role changes what their dashboard shows:

- **Sales (`bdo`, `asm`)** — their leads, queries, Visit Plans and the shipments they originated; ASMs additionally see their team.
- **Operations / Compliance / Transport / Finance** — the active, confirmed and placed shipments whose steps their department owns, plus their auto-assigned task queue; they work and confirm those tasks to advance shipment status. A role's queue only contains tasks for services actually on each shipment.
- **Management (`ceo`, `project_director`, `director`, `cfo`, `gm`) and `hr`** — cross-cutting KPIs, employee management, escalations and audit.
- **Customer** — only their own placed/confirmed/approved shipments, tracked across the stages their order actually has.

### 5.18 Reports
Leads (with loss reasons), shipments (step durations, exception frequency), revenue (ageing), tasks, outreach, unserved demand. CSV, XLSX and PDF, asynchronous above 5000 rows.

### 5.19 Audit
Every mutation, written once by the global interceptor, with actor, field-level diff, IP and correlation id. Management-only, filterable, with per-resource history.

### 5.20 Public Storefront — Load Board & Rate Calculator
The **anonymous front door** (no login), modelled on SeaRates: how the *direct* channel (§5.4) actually acquires demand. Three capabilities, all public and read-mostly:

- **Load Board** — a browsable list of **indicative available capacity/lanes** (`load_board_postings`): mode, origin → destination, equipment/container, sailing/departure window, transit days, an indicative rate and the services on offer. Filterable by lane, mode and service. Postings are created and curated by Operations/Transport internally; the public sees only active, open ones. This is a **lead-generation shopfront**, deliberately distinct from the Phase-2 TMS carrier load-matching board (§10).
- **Rate Calculator** — the visitor picks services (§5.6a), a lane, a container type and optional weight, and gets an **indicative, non-binding price breakdown** computed from seeded rate cards (`rate_cards`). Pure computation — nothing is persisted and no PII is taken. The breakdown mirrors the eventual quotation's per-service charge lines so the numbers feel continuous.
- **Request a Quote — signup-gated.** Browsing and pricing are free; receiving a *formal* quotation requires an account. Clicking "Get a quote" parks the visitor's selection and sends them to **self-registration** (§5.16a). The moment their portal exists, the parked selection is submitted as a real **Query** carrying their services — no re-typing, no human triage step. Signup is rate-limited (5/hour/IP), honeypot-guarded and validated.

  The legacy anonymous **Public Inquiry** (`public_inquiries`) remains as a triage inbox for demand captured outside this flow; it still converts to a lead + query exactly as before (§WORKFLOW 2b).

### 5.16a Customer Self-Registration
The storefront's signup gate, and the concrete provisioning path for the **direct** channel. One transaction creates the **company**, its **primary contact** (name, work email, phone, job title), the **customer** record (`CST-…`, `source = direct`) and the **portal login** (password set by the user — no activation round-trip), then signs the user straight in.

**A self-signup never attaches to an existing customer**, even when the company name matches — that would hand a stranger another company's shipments and invoices. A name clash creates a separate record and raises `customer.registered` carrying `possibleDuplicate`, so Sales verifies and merges deliberately. The new customer starts with **no assigned BDO**; Sales is notified to claim it. Operations can quote it immediately regardless, because Ops/Compliance read every query (§2.3 scope D).

Indicative pricing is explicitly non-binding — the authoritative price is always the issued quotation (§5.7).

### 5.21 Bank LC Intake (webhook)
The concrete intake for the **Bank LC** channel (§5.4). A partner bank posts a customer's Letter of Credit to Consort over an **authenticated webhook** (shared-secret header, idempotent by the bank's LC/message reference so replays never duplicate). Each post lands as a **Bank LC Referral** (`bank_lc_referrals`) — applicant/beneficiary, amount, lane, commodity, incoterm, LC and expiry dates, plus the **full raw payload retained for audit** — in the **Operations inbox**, where it is highly visible to `ops_exec`. From the inbox `ops_exec` **converts** a referral into a company + contact + customer (`source = bank_lc`) + query (with `lc_finance` implied, RULE-SVC-04) and drafts the quotation; the resulting shipment is LC-backed and carries the LC/trade-finance OTD steps. This is **inbound LC intake only** — deliberately distinct from the Phase-3 full bank API / escrow settlement handshake (§10).

---

## 6. Business Flow

Full diagrams in `WORKFLOW.md`.

```
Management/HR creates employee (role + department) → activation email → login
   ↓
THREE ACQUISITION CHANNELS → each has a concrete intake mechanism
   1. BDO            → BDO raises lead/query directly (outreach)
   2. Direct client  → Public Storefront (§5.20): load board + rate calculator
                       → Public Inquiry → Sales triage → lead(direct)+query
   3. Bank LC        → Bank LC webhook (§5.21): bank posts LC → Ops inbox
                       → ops_exec converts → customer(bank_lc)+query
   ↓
Lead (LED-…) via BDO outreach | Bank LC | Direct client
   ↓   BDO/ASM plan & log Visit Plans to win the client
   outreach → qualified → convert → Customer (CST-…)
   ↓                                                   ↓
   └────────────────────────────── provision portal user
   ↓
Query (QRY-…) via BDO | Public Inquiry | Bank LC referral ── selects SERVICES ── hazardous? → Compliance pre-check
   ↓
Ops drafts Quotation (QT-…) → Ops Manager sends → customer/ASM decides
   │                                    ↳ rejected → revision v2
   ↓ approved  ── one transaction ──
   Shipment (SHIP-…) + OTD steps COMPOSED FROM SELECTED SERVICES
                     + OTC milestones + chat channel + draft invoice
   ↓
   Action Engine → tasks ONLY for in-scope services → owning field employee
                 · notifications · live push
   ↓
   Each assigned employee submits/confirms their task → shipment status advances
   OTD progresses through the service-composed path      OTC 1→5 by Accounts
   ↓  (hold / resume / cancel available throughout)
   delivered ─┬─ all OTC done → settled → closed
              └─ invoices issued → payments received
   ↓
Management reads dashboards, reports and audit
```

The example above shows the full sea-freight/LC path. A **local-transport-only** order runs a four-step path (Order Lock → Allocation → Cargo Pickup → Delivery & POD) with no Compliance/Customs/bank steps and no tasks for those departments.

---

## 7. Shipment Lifecycle

Status is **derived from the highest completed OTD step on the shipment's own service-composed path** — not from a fixed count. The **full sea-freight/LC path** yields the canonical sixteen progressive statuses: 13 distinct step-completion statuses derived from the 14 OTD steps (steps 1 and 2 both yield `order_confirmed`), plus `booking` (zero steps complete), `settled` and `closed` (ADR-039). A **shorter service path exposes only its own subset** of those statuses (e.g. a local-only order moves `booking → order_confirmed → … → delivered → settled → closed` without ever entering the customs/BOL/telex statuses, because those steps are not on it). `exception_state` (`none | on_hold | cancelled`) is orthogonal to progress on every path. Canonical step table in `DECISIONS.md` ADR-003 as amended by ADR-039; the service-composition rules and per-service subsets are in `WORKFLOW.md §4a`; machines in `WORKFLOW.md §5`.

---

## 8. Technical Stack

This section describes the stack **as implemented in the codebase** (`erp-frontend/` and `erp-backend/`).

### Frontend (`erp-frontend/`)
| Tool | Purpose |
|---|---|
| React 19 | UI (JavaScript / JSX; TypeScript only in `src/lib/utils.ts`) |
| Vite 8 (`@vitejs/plugin-react`) | Build and dev server, with React Compiler enabled (`babel-plugin-react-compiler` via `@rolldown/plugin-babel`) |
| Zustand 5 | Client state — session/auth store (`src/store/authStore.js`) |
| React Context | Theme state (`src/context/ThemeContext.jsx`) |
| Axios 1 | HTTP transport, one configured instance (`src/lib/axios.js`) — **the only HTTP client**; attaches the Bearer token and normalises errors/401 handling |
| React Router 7 (`react-router-dom`) | Routing |
| Tailwind CSS 4 (`@tailwindcss/vite`) + `tw-animate-css` | Styling |
| shadcn/ui on Base UI (`@base-ui/react`, style `base-nova`) + `class-variance-authority` · `clsx` · `tailwind-merge` | Component system (`components.json`) |
| lucide-react | Icons |
| Framer Motion 12 | Animation |
| react-hot-toast | Toast notifications |
| Geist variable font (`@fontsource-variable/geist`) | Typography |
| ESLint 9 (flat config) | Linting |
| Vercel | Hosting — SPA rewrite to `index.html` (`vercel.json`) |

### Backend (`erp-backend/`)
| Tool | Purpose |
|---|---|
| Node.js + Express 5 | API (JavaScript, ES modules; `app.js` + `server.js`) |
| PostgreSQL | Database (`DATABASE_URL`) |
| Prisma ORM 6 (`@prisma/client` + `prisma` CLI) | Data access; client generated on `postinstall` (`prisma/schema.prisma`) |
| Zod 4 | Request validation via `middleware/validate.middleware.js` and per-module schemas |
| jsonwebtoken 9 | JWT authentication (Bearer tokens, 30-day expiry) |
| bcrypt 6 | Password hashing |
| helmet 8 | Security HTTP headers |
| cors | CORS allow-list with credentials |
| express-rate-limit 8 | Rate limiting (100 requests / 15 min on `/api`) |
| nodemon | Dev auto-reload |
| Vercel (`@vercel/node`) | Serverless deployment (`vercel.json`, `api/index.js`) |

**Not present in the current codebase** (they appear in earlier spec versions and in `WORKFLOW.md` diagrams as design targets, but are not implemented): NestJS, TypeScript on either tier, TanStack Query/Table/Virtual, React Hook Form, Recharts, Socket.IO, Redis, BullMQ, Passport, MinIO, Nodemailer, ClamAV, Pino/Prometheus/Sentry, Swagger, Docker, and the testing stacks (Vitest · RTL · MSW · Playwright · Jest · supertest · Testcontainers). Adopting any of them is a future decision, not a description of today's stack.

---

## 9. Repository Structure

Two independently deployed applications (no monorepo tooling — each app has its own `package.json` and its own Vercel project):

```
Consort-Erp/
├── erp-backend/                Express 5 + Prisma (JavaScript, ES modules)
│   ├── api/index.js            Vercel serverless entry
│   ├── app.js                  Express app — helmet, rate limit, CORS, routes, error handler
│   ├── server.js               Server entry (local / `@vercel/node` build target)
│   ├── config/                 Prisma client (`prisma.js`), DB connect (`db.js`)
│   ├── middleware/             Zod `validate` middleware
│   ├── modules/
│   │   └── auth/               routes · controllers · validation · middleware
│   ├── prisma/schema.prisma    Data model (User + UserRole enum)
│   ├── utils/                  AppError · catchAsync
│   └── vercel.json
├── erp-frontend/               Vite 8 + React 19 (JavaScript)
│   ├── src/
│   │   ├── components/         ui · guards · utils · ErrorBoundary
│   │   ├── context/            ThemeContext
│   │   ├── hooks/ · layouts/
│   │   ├── pages/              AdminPages · AuthPages · UserPages
│   │   ├── lib/                axios instance · utils
│   │   ├── services/           superAdminService · userService
│   │   └── store/              authStore (Zustand)
│   ├── components.json         shadcn/ui configuration
│   ├── vite.config.js
│   └── vercel.json             SPA rewrite
└── docs/                       CRM_MASTER.md · DATABASE.md · WORKFLOW.md
```

New backend features are added as folders under `erp-backend/modules/` following the existing `auth` pattern (routes · controllers · validation · middleware).

---

## 10. Phase Boundaries

| Capability | Phase 1 | Later |
|---|---|---|
| Employees, roles, permissions, audit | ✅ | — |
| Lead → Customer (BDO · Bank LC · Direct) | ✅ | — |
| Public storefront — load board + rate calculator (lead-gen) | ✅ | Carrier load-matching board → Phase 2 TMS |
| Bank LC intake webhook (inbound referral → query) | ✅ | Full bank API / escrow handshake → Phase 3 |
| Visit Plans | ✅ | Route/territory optimisation → Phase 2 |
| Service selection driving OTD template | ✅ | Runtime-configurable service catalog → Phase 3 |
| Query → Quote → Shipment | ✅ | — |
| OTD / OTC | ✅ | — |
| Invoices & payments | ✅ | Credit notes, escrow → Phase 3 |
| Documents | ✅ | E-signature → Phase 2 |
| Internal chat | ✅ | — |
| Customer portal | ✅ | — |
| Dashboards, reports, audit | ✅ | — |
| WhatsApp notifications | Config stub | Phase 1.5 |
| Runtime-configurable roles | ❌ enum-based (ADR-005) | Phase 3 |
| GPS telematics | ❌ schema ready | Phase 2 TMS |
| Load board (carrier load-matching / booking) | ❌ schema ready | Phase 2 TMS |
| Bank API / LC settlement & escrow handshake | ❌ schema ready | Phase 3 |
| Multi-currency FX feed | ❌ rate supplied per transaction | Phase 2 |
| Business-hours SLA | ❌ wall-clock hours | Phase 2 |

---

## 11. Document Map

| Document | Owns | Read it when |
|---|---|---|
| `DECISIONS.md` | Canonical resolutions (ADRs) | Anything is ambiguous or two documents disagree |
| `CRM_MASTER.md` | Vision, scope, roles, modules, stack | Onboarding, or scoping a change |
| `BUSINESS_RULES.md` | Invariants, permissions, validations, edge cases | Implementing any behaviour |
| `DATABASE.md` | Schema, enums, indexes, seeds, migrations | Touching data |
| `API.md` | Endpoint contracts | Building or consuming an endpoint |
| `WORKFLOW.md` | State machines, events, sequences | Changing a lifecycle or an event |
| `BACKEND.md` | Express structure and patterns | Writing server code |
| `FRONTEND.md` | React structure and patterns | Writing client code |
| `SPRINTS.md` | Delivery plan and acceptance | Planning, or defining done |
| `GLOSSARY.md` | Domain vocabulary | Encountering an unfamiliar term |

**Precedence:** `DECISIONS.md` → `BUSINESS_RULES.md` → the specific document (`DATABASE`/`API`/`WORKFLOW`) → the implementation guides (`BACKEND`/`FRONTEND`) → `SPRINTS.md`. If a lower document contradicts a higher one, the lower one is a bug — file it, do not code around it.

