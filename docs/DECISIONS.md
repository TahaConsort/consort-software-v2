# DECISIONS.md
# Consort CRM — Architecture Decision Records (ADRs)
**Authority:** This document **outranks every other document** in the repo. If any document contradicts an ADR here, the other document is a bug — file it, do not code around it.
*Document history lives in git — this file carries no manual version bookkeeping.*

---

## 0. How to read this document

Each ADR records **one canonical resolution**: the decision, why, and what it forbids. Statuses: **Accepted** (in force), **Amended** (in force, as modified by a later ADR), **Reserved** (number retired with the v1 review; its content is absorbed into other ADRs or documents and is not reproduced here).

## 1. ADR Index

| ADR | Title | Status |
|---|---|---|
| ADR-001 | One source of truth per concept | Accepted |
| ADR-002 | Reserved | — |
| ADR-003 | The canonical 14 OTD steps | Amended by ADR-039, ADR-040 |
| ADR-004 | Reserved | — |
| ADR-005 | Enum-based roles & permissions in one contracts package | Amended by ADR-044 |
| ADR-006 | Invoices and payments are the revenue source of truth | Accepted |
| ADR-007 | One socket contract, server-assigned rooms | Accepted |
| ADR-008 | Reserved | — |
| ADR-009 | Access-token-in-memory auth strategy | Accepted |
| ADR-010 – ADR-013 | Reserved | — |
| ADR-014 | `shipments.status` is derived, never written | Accepted |
| ADR-015 – ADR-018 | Reserved | — |
| ADR-019 | Quotation revisions are new rows, not a status | Accepted |
| ADR-020 | Closed, versioned domain event catalog | Accepted |
| ADR-021 | Transactional outbox for all domain events | Accepted |
| ADR-022 – ADR-029 | Reserved | — |
| ADR-030 | `revision_requested` is distinct from `rejected` on queries | Accepted |
| ADR-031 – ADR-032 | Reserved | — |
| ADR-033 | Multi-device sessions with per-session revocation | Accepted |
| ADR-034 – ADR-035 | Reserved | — |
| ADR-036 | Frontend data layer | Accepted (partially implemented) |
| ADR-037 | Reserved | — |
| ADR-038 | Task hold columns (`sla_paused_at`, `status_before_hold`) | Accepted |
| ADR-039 | Step ownership & status-mapping amendment | Accepted |
| ADR-040 | **Service-driven OTD template composition** | Accepted |
| ADR-041 | **The Phase-1 service catalog** | Accepted |
| ADR-042 | **Lead acquisition channels (`source`)** | Accepted |
| ADR-043 | **Visit Plans as a first-class entity** | Accepted |
| ADR-044 | **`cfo` joins the Management tier** | Accepted |
| ADR-045 | **Employee removal is deactivate-and-reassign** | Accepted |
| ADR-046 | **Service packages sit above the service catalog** | Accepted |
| ADR-047 | **A customer may upload inbound documents, nothing more** | Accepted |
| ADR-048 | **One main step with sub-actions, not many steps** | Accepted |
| ADR-049 | **Port → Consignee is a fourth package** | Accepted |

Reserved numbers were consumed by the v1 conflict review; their resolutions were folded into the v2 documents and the ADRs above. Never reuse a reserved number.

---

## ADR-001 — One source of truth per concept

**Decision.** Every business fact is modelled exactly once. Derived representations (statuses, totals, counts, mirrors) are computed from the owning model, never maintained beside it.

**Consequences.**
- `shipments.status` is derived from OTD steps (ADR-014).
- Revenue is aggregated from `invoices` and `payments`; OTC milestone amounts are display mirrors (ADR-006).
- Permissions live in one package (ADR-005).
- Audit is written in one place, by the global interceptor.

**Forbids.** Any second writable copy of a fact. Duplicated truth is the defect class that produced most of v1's contradictions.

---

## ADR-003 — The canonical 14 OTD steps

**Decision.** There is **one** canonical list of Order-to-Delivery steps — the enum, the seed data, the UI stepper and every diagram use it. v1 carried three divergent lists; all are dead.

| # | Code | Step | Owner¹ | Derived status |
|---|---|---|---|---|
| 1 | — | Order Lock | Operations | `order_confirmed`² |
| 2 | `order_confirmed` | Order Confirmation | Operations | `order_confirmed`² |
| 3 | `lc_generated` | SWIFT / LC Advice | Compliance | `lc_generated` |
| 4 | `container_allocated` | Vehicle / Container Allocation | Transport¹ | `container_allocated` |
| 5 | `cro_released` | Container Release Order (CRO) | Operations | `cro_released` |
| 6 | `cargo_pickup` | Cargo Pickup | Transport¹ | `cargo_pickup` |
| 7 | `customs_entry` | Customs Declaration (GD) | Compliance | `customs_entry` |
| 8 | `inspected_sealed` | Customs Inspection & Sealing | Compliance | `inspected_sealed` |
| 9 | `port_handover` | Terminal Handover | Operations | `port_handover` |
| 10 | `bol_issued` | Bill of Lading Issuance | Operations | `bol_issued` |
| 11 | `bol_submitted` | Document Submission to Bank | Accounts | `bol_submitted` |
| 12 | `telex_released` | Telex Release | Accounts | `telex_released` |
| 13 | `destination_inspection` | Cargo Inspection & Acceptance | Compliance | `destination_inspection` |
| 14 | `delivered` | Final Delivery / POD / Title Transfer | Operations | `delivered` |

¹ Ownership of steps 4 and 6 amended to Transport by ADR-039.
² Steps 1 and 2 both derive `order_confirmed` (ADR-039), which is why 14 steps yield 13 distinct step statuses. With `booking` (zero steps complete), `settled` and `closed`, the full-path status enum has sixteen progressive values.

**Amendment (ADR-040).** The 14 steps are the **full superset** — the path of a shipment that bought every service. Each shipment is seeded with only the subset its selected services require. This does not change the list, the codes, the order or the ownership; it changes which rows exist per shipment.

**Sequence.** Steps complete in canonical order, with exactly one permitted out-of-order pair: steps 3 and 4 (RULE-SH-03). Any other out-of-order completion requires a forced override with authority and justification.

---

## ADR-005 — Enum-based roles & permissions in one contracts package

**Decision.** Roles are a **closed enum** in Phase 1. The permission vocabulary, the role→permission matrix and the row-level scope table are defined once, in `packages/contracts`, and consumed by both apps. `BUSINESS_RULES.md §2` is generated from it.

**Rationale.** Runtime-configurable roles (Phase 3) are a product feature, not an architecture requirement; an enum removes an entire class of authorisation bugs while the domain stabilises.

**Forbids.** Role or permission checks defined ad-hoc in a controller; string-typed role comparisons scattered across the codebase.

**Amended by ADR-044:** the enum gains `cfo`.

---

## ADR-006 — Invoices and payments are the revenue source of truth

**Decision.** All revenue reporting aggregates the `invoices` and `payments` tables. The `amount` on an OTC milestone is a **display mirror**, never an input to a report. v1 reported revenue from a finance model it never built; v2 builds the model and reports only from it.

**Consequences.** Invoices are auto-drafted from the approved quotation; issued by Accounts; voidable only while unpaid. Payments carry method, reference and FX rate captured at commit.

---

## ADR-007 — One socket contract, server-assigned rooms

**Decision.** The real-time contract is specified exactly once (`WORKFLOW.md §7`). Rooms (`user:{id}`, `role:{role}`, `dept:{id}`, `customer:{id}`) are **assigned server-side from the verified token**; clients may only request resource rooms (`shipment:{id}`, `channel:{id}`), which are re-authorised on join.

**Rationale.** v1's client-emitted `joinUser` had no server handler, so no notification was ever delivered; and the emitter/listener event-name mismatch (`statusUpdated` vs `shipmentUpdate`) silently killed shipment push.

**Consequences.** Socket events are **invalidation hints, never authoritative state** (EDGE-T-05). REST is complete without sockets.

---

## ADR-009 — Access-token-in-memory auth strategy

**Decision.** JWT access tokens live **15 minutes and only in memory** (Zustand store). Refresh tokens are rotating, hashed at rest, `HttpOnly` cookies with reuse detection. Global invalidation via `users.token_version`; bumping it kills every outstanding token.

**Forbids.** Tokens in `localStorage`/`sessionStorage`; long-lived access tokens.

**Note.** The current codebase ships a 30-day bearer token as an interim implementation; it is a known gap against this ADR, not a revision of it.

---

## ADR-014 — `shipments.status` is derived, never written

**Decision.** `shipments.status` is computed as the derived status of the **highest completed OTD step on the shipment's composed path** (ADR-040). No endpoint writes it. Reopening step *n* reopens all steps after *n* and recomputes downward (RULE-SH-05).

**Rationale.** v1 held progress in two independently writable places; they disagreed within weeks.

---

## ADR-019 — Quotation revisions are new rows, not a status

**Decision.** A revision is a **new quotation row**: `version = n+1`, `status = draft`, `parent_quotation_id = n`. The v1 `revised` status is removed.

**Consequences.** INV-07/INV-08 (one live, one approved quotation per query) are enforceable as partial unique indexes, so a double-click cannot create two shipments.

---

## ADR-020 — Closed, versioned domain event catalog

**Decision.** The Action Engine and all consumers are triggered by **domain events, never by status polling**. The catalog (`WORKFLOW.md §6`) is closed: an event exists only if it is defined in `packages/contracts` and listed in that section — both are updated together when adding one.

---

## ADR-021 — Transactional outbox for all domain events

**Decision.** Business state, audit rows and the event row commit **in one database transaction** via `outbox_events`. A relay dispatches committed events; consumers are idempotent (RULE-AE-04).

**Rationale.** A queue/socket outage must never lose a task (EDGE-V-01), and an event must never describe a transaction that rolled back.

---

## ADR-030 — `revision_requested` is distinct from `rejected` on queries

**Decision.** A rejected quotation moves its query to `revision_requested` ("re-quote me"); `rejected` on the query means the customer walked away. In v1 both mapped to `open`, making `rejected` unreachable and the pipeline unable to distinguish "never quoted" from "quoted and pushed back".

---

## ADR-033 — Multi-device sessions with per-session revocation

**Decision.** Each device login creates its own refresh-token session, individually revocable. Account lockout after repeated failures; every attempt (success or not) is written to `login_activities`. Failure responses are identical in shape and timing to prevent user enumeration.

---

## ADR-036 — Frontend data layer

**Decision.** Server state belongs to **TanStack Query**, client/session state to **Zustand**, transport to a **single configured Axios instance**. Today's codebase implements the Axios instance and the Zustand auth store; TanStack Query is the accepted target, not yet installed (`CRM_MASTER.md §8`).

**Forbids.** A second HTTP client; server data cached in Zustand.

---

## ADR-038 — Task hold columns

**Decision.** Holding a shipment freezes its open tasks via two columns: `sla_paused_at` (when the clock stopped) and `status_before_hold` (what to restore). Both are cleared on resume; **a task is "held" iff `sla_paused_at` is set**. On resume, `due_date += hold_minutes` so held shipments do not poison SLA metrics (RULE-SH-10).

---

## ADR-039 — Step ownership & status-mapping amendment

**Decision.**
1. Steps 4 (`container_allocated`) and 6 (`cargo_pickup`) move from Operations to **Transport**. Operations retains 1, 2, 5, 9, 10, 14.
2. Steps 1 and 2 both derive `order_confirmed`; the full-path status enum is therefore **sixteen** progressive values (13 step statuses + `booking`, `settled`, `closed`).

---

## ADR-040 — Service-driven OTD template composition

**Status:** Accepted · refines ADR-003 (does not contradict it).

**Context.** Consort sells services à la carte. A customer buying only local transport must not see — or staff — customs, bank or BOL steps. Earlier drafts treated the 14 steps as always-present on every shipment.

**Decision.** The canonical 14 steps (ADR-003) are the **full superset**. At quote approval, the shipment is seeded with **only the steps whose service is selected**, in canonical order, plus the always-on steps (1–2 Order Lock/Confirmation, 14 Delivery). The composition table is normative in `WORKFLOW.md §4a.1`.

**Rules.**
1. The composed template is **fixed at approval time** and stored on the shipment. Post-approval re-scope is a controlled, audited exception, out of Phase-1 scope.
2. A department with no step on the composed path has **no role on that shipment** — no queue entry, no tasks, no ownership (RULE-SVC-02).
3. `shipments.status` derives from the highest completed step **on the composed path**; a shorter path exposes only its own subset of the status enum.
4. The Action Engine fires only task templates for steps that exist on the shipment (RULE-AE-07).
5. Display renumbers steps 1..N of the composed path; the canonical `step_code` and number are retained for reporting.

**Forbids.** Seeding all 14 rows and hiding some; per-shipment custom steps; skipping a seeded step without the forced-override path.

---

## ADR-041 — The Phase-1 service catalog

**Status:** Accepted.

**Decision.** The catalog is a **closed enum** of five services (`CRM_MASTER.md §5.6a`):

`local_transport` · `customs_clearance` · `sea_freight` · `port_handling` · `lc_finance`

Every query records a non-empty set of selected services (RULE-QRY-05); the set is carried through the quotation onto the shipment. Adding a service is a schema + step-template change, not runtime configuration (runtime catalog → Phase 3).

**`lc_finance` implication.** Any customer whose acquisition channel is Bank LC (ADR-042) gets `lc_finance` implied on their shipments; it may also be selected explicitly.

---

## ADR-042 — Lead acquisition channels (`source`)

**Status:** Accepted.

**Decision.** Every lead (and the customer it converts to) carries an immutable `source` enum:

| Value | Meaning |
|---|---|
| `bdo` | Generated by a Business Development Officer through outreach |
| `bank_lc` | Referred via a bank Letter of Credit arrangement |
| `direct` | Customer approached Consort directly (incl. portal self-service) |

`bank_lc` implies `lc_finance` on downstream shipments (ADR-041). Conversion reports segment by `source`.

---

## ADR-043 — Visit Plans as a first-class entity

**Status:** Accepted.

**Decision.** A scheduled field visit by a BDO or ASM is its own entity with its own machine — `planned → completed | cancelled | no_show`, `no_show → planned` on reschedule (`WORKFLOW.md §2a`) — linked to a lead or customer. **A completed visit is also recorded as an outreach touch**, so it can advance the lead machine exactly as a logged meeting does. Ad-hoc, already-happened visits remain plain outreach; Visit Plans are for scheduled future visits.

**Scope.** BDO sees own, ASM sees team, Management sees all — the standard sales scope ladder.

---

## ADR-044 — `cfo` joins the Management tier

**Status:** Accepted · amends ADR-005 (enum gains one value).

**Decision.** `cfo` is a Management-tier role with permissions **identical** to `ceo`, `project_director`, `director` and `gm` — the Management tier is five roles, still with no partial-management sub-tier. Additionally, `cfo` is the **head of the Finance department**; `accounts` executes under it. The finance-oversight duty is a dashboard/reporting emphasis, not a separate permission set.

---

## ADR-045 — Employee removal is deactivate-and-reassign

**Status:** Accepted.

**Decision.** There is **no hard delete** of employees. "Removing" an employee means:
1. If they own open work (leads, queries, quotations, shipments, tasks), the API returns `409 EMPLOYEE_HAS_OPEN_WORK` and the UI drives a **reassignment wizard** (RULE-EMP-02).
2. Once clear, the employee and user rows are deactivated: `is_active = false`, `exit_date` set, `token_version` bumped, refresh tokens revoked, chat memberships closed, live sockets force-disconnected (EDGE-A-04).
3. Ownership history and audit rows are **retained forever**.

**Rationale.** A hard delete orphans every shipment, task and audit row the employee ever touched — the offboarding case that corrupts ownership data in most CRMs.

**Forbids.** `DELETE` semantics that remove the row; reassignment that skips notification of both owners; reuse of a deactivated employee's login by editing the email.

---

## ADR-046 — Service packages sit above the service catalog

**Status:** Accepted. Extended by ADR-049, which adds a fourth package.

**Context.** The business sells three things — Local Transport, Loading Point → Port, and International Shipment — and one of them has a sub-option (who obtains the CRO). The closed `ServiceCode` catalog (ADR-041) cannot express this. Two concrete failures forced the decision:

1. A pure-local job composed `empty_container_pickup` (demanding an `eir_out` container interchange receipt) and `order_confirmed` (demanding a commercial invoice, packing list and authority letterhead). A truck moving goods across town needs none of that, and the RULE-SH-06 document gate would hard-block the job at 422.
2. `services[]` provably **cannot** separate Local Transport from the Loading Point → Port transport leg — both contain `local_transport` yet need different steps. Gating had to move up a level.

**Decision.** A new `ServicePackage` enum (`local_transport`, `loading_point_to_port`, `international`) and a `CroHandling` enum (`not_applicable`, `customer`, `consort`) are added to Query, Quotation and Shipment, snapshotted forward and frozen at approval alongside `services` (INV-14).

The package **presets** `services[]` rather than replacing it (`utils/servicePackage.js` → `PACKAGE_SERVICES`, `resolveServices`). Everything already keyed on `ServiceCode` — charge types, rate cards, load-board postings, `resolveCharge`, `departmentsOnPath`, P&L — keeps working untouched. Ops may add services on top of the preset, never below it.

`otd_step_templates` gains `packages ServicePackage[]` and `cro_modes CroHandling[]`, both *empty means don't gate* (WORKFLOW §4a.1).

**Consequences.**
- Canonical step numbers are **re-spaced to multiples of 10**. This is safe because every canonical-number comparison in the codebase is intra-shipment and every cross-shipment lookup is by `step_code`. The one exception — the hardcoded `[3, 4]` out-of-order exemption — is re-keyed to a `step_code` pair (`OUT_OF_ORDER_PAIRS`), which is a prerequisite, not a nicety.
- The two CRO modes are **two template rows**, not one row with conditional documents, because `OtdStep` persists neither `title` nor `required_doc_types`; both are resolved from the template by `step_code` at completion time.
- Each package needs its **own terminal step deriving `delivered`** (`delivered` / `local_delivered` / `port_job_completed`), because `maybeSettleTx` only settles a shipment whose status is `delivered`.
- Composition **requires** a package: there is no null-package fallback, since skipping the gate would make package-only steps apply to every shipment. Rows predating the feature are resolved by `inferPackageFromServices` and backfilled by `scripts/backfillServicePackages.js`.
- The `customer` role gains a narrowly scoped `document.upload` (see ADR-047).

**Forbids.** Composing a path without a package; re-encoding the package→step mapping anywhere but `otd_step_templates` (ADR-001); a ninth copy of the service-code list — `utils/servicePackage.js` is the one place the vocabulary lives.

---

## ADR-047 — A customer may upload inbound documents, nothing more

**Status:** Accepted.

**Context.** On the Loading Point → Port package a customer may supply their own CRO (ADR-046). They therefore have to be able to hand a file over — but INV-10/§2.2 had customers as read-only on documents.

**Decision.** The `customer` role gains `document.upload` and **only** that. Three independent gates confine it:
1. `ownerInScope(..., { forWrite: true })` allows customer writes **only** to `ownerType: "shipment"` on a shipment belonging to their own customer.
2. The upload controller enforces a docType allowlist (`CUSTOMER_UPLOADABLE_DOC_TYPES` = `cro`, `commercial_invoice`, `packing_list`, `authority_letterhead`), and rejects a `cro` unless the shipment's `cro_handled_by` is `customer`. This check lives in the **controller, not the middleware**, because `req.body.docType` does not exist until multer has parsed the multipart body.
3. Uploads land `is_published = false` (the schema default), so an inbound file is never mistaken for a customer-facing deliverable.

The role holds neither `document.publish` nor `document.delete`, so a customer can never expose or remove anything.

**Forbids.** Granting a customer write access to a quotation, query, lead or task owner; accepting a customer `cro` on a shipment Consort is arranging; inferring upload rights from `document.read`.

---

## ADR-048 — One main step with sub-actions, not many steps

**Status:** Accepted.

**Context.** Two milestones are single pieces of work made of several parts. Order confirmation on the **international** package means collecting seven documents from the customer (packing list, GD, quotation, undertaking, sales tax invoice, commercial invoice, certificate of origin); customs clearance means filing the GD, paying duty, getting the cargo examined and sealed. Modelling each part as its own OTD step would be wrong three times over: the parts have no meaningful order between them, they are all owned by one department, and `shipments.status` is derived from the highest completed step (ADR-014) — so seven paperwork steps would produce seven fake status transitions. The pack also differs by package, and `otd_step_templates.step_code` is `@unique`, so a per-package variant would mean a second step code for the same milestone.

**Decision.** A step may carry an ordered **sub-action checklist**, seeded in `otd_step_action_templates` and materialised per shipment into `otd_step_actions` at approval. Sub-actions use the **same three gates as steps** (package → CRO mode → service, each empty-means-don't-gate), which is what lets one `order_confirmed` step carry the seven-document international pack and the shorter loading-point-to-port pack.

Two kinds, and the distinction is the load-bearing part:

- **`document`** — satisfied by a live document of that `doc_type` on the shipment. **Derived, never written**: it is resolved at read time and folded into the RULE-SH-06 check, so it cannot drift from the files on record. Ticking one by hand is refused (409). This is ADR-014's principle applied one level down.
- **`manual`** — ticked by a member of the step's owning department (RULE-SH-04), enforced by RULE-SH-13.

Consequences:
- `missing_required_docs` is now the **union** of the template's `required_doc_types` and the step's required `document` sub-actions — a union, never a replacement, so a step can hold a fixed requirement and a package-dependent checklist without the gate drifting between them.
- Both gates are evaluated together and reported in **one** 422. A step can fail both, and telling someone about a missing document only for them to discover four open checklist items on the retry is a round trip nobody needs.
- Reopening a step resets its `manual` items; `document` items stay satisfied, because the files are still on record.
- The **quotation** item is satisfied without asking anyone: the approved quotation is rendered to PDF (`utils/quotationPdf.js`, sell side only) and attached at approval, so the item is ticked on arrival. Generation is best-effort — a rendering failure must not roll back an approval, and a manual upload of the same docType satisfies the item either way.
- `customs_entry` + `inspected_sealed` are superseded by one `customs_clearance` step. `otd_step_templates` gains `active`: superseded rows are **kept, not deleted**, because `missing_required_docs` and `recompute_status` resolve templates by `step_code` for shipments that already ran them. Composition skips them.

**Forbids.** Modelling checklist items as OTD steps; storing a `document` sub-action's satisfaction; a second gate for documents that live in a checklist; deleting a superseded step template.

---

## ADR-049 — Port → Consignee is a fourth package, not a reuse of the destination-agent steps

**Status:** Accepted.

**Context.** The business also sells the **import** leg on its own: a container has landed and been released, and the customer wants it collected from the terminal, delivered to the consignee, and the empty returned. Three existing steps already describe that physical work — `destination_do`, `destination_pickup`, `empty_return` — reached by adding the `destination_services` code to an international job. Reusing them by presetting `destination_services` was the obvious move and is wrong on three counts:

1. Those steps are the **far end of somebody else's export job**, performed by an overseas agent and owned by Operations. This leg is our own vehicles on domestic roads, and ADR-046 already established that a trucking leg is Transport-owned end to end so the job never 403s across a department handoff.
2. `destination_do` collects a delivery order and gate pass **from an agent**. Here the customer supplies both, along with the BOL and the free-days count, and they belong in the `order_confirmed` document pack (ADR-048) — the same place every other package collects what the customer owes us.
3. Presetting `destination_services` would compose both sets the moment Ops added the code by hand, giving a shipment two empty-return steps.

**Decision.** `ServicePackage` gains `port_to_consignee`, presetting `local_transport` + `port_handling`. Two new step codes — `import_container_pickup` (canonical 152) and `import_empty_return` (canonical 178) — carry the EIRs; `order_confirmed` and `local_delivered` are reused by adding the package to their gate. The composed path is five steps:

`order_lock` → `order_confirmed` → `import_container_pickup` → `local_delivered` → `import_empty_return`

**Consequences.**
- The package has **no CRO**: the line already released the box, and the customer's delivery order stands in for it. `allowedCroModes` and the three `*_cro_mode_valid` CHECK constraints are widened from "only `local_transport` is `not_applicable`" to a two-package list. Those constraints are **dropped and recreated**, not re-added — the file's `ADD`/`EXCEPTION WHEN duplicate_object` idiom would have silently kept the old predicate, which rejects every row of the new package.
- It is the **first package to want a port and a street address at once** (`origin_port` is where the container sits, `delivery_address` is the consignee), so `packageUsesPorts` no longer implies "no addresses". `packageUsesPickupAddress` / `packageUsesDeliveryAddress` replace the `isLocal` ternary that had been copy-pasted across five UI call sites.
- Three existing templates are **narrowed** from "any package" to the two export packages — `port_handover` (this package buys `port_handling` to get the box *out*, and would otherwise compose an origin gate-in it never performs) and the three destination-agent steps. No existing package's path changes.
- `queries`/`shipments` gain `free_days` and `empty_return_location`. Free days is the detention clock the whole job races; a number that lives in step notes cannot be reported on or alerted against.
- `inferPackageFromServices` **cannot** return this package — it shares its service set with `loading_point_to_port`, and no row predating the package can be an import leg anyway.
- The operational job ends at the empty return, but **closing still waits for the money**: `import_empty_return` derives `delivered`, and `maybeSettleTx` already refuses to settle while any step is pending, so the existing settle-then-close rule (RULE-SH-12) is unchanged.

**Forbids.** Presetting `destination_services` on this package; a per-package variant of an existing step code; collecting the customer's delivery order anywhere but the `order_confirmed` pack.

---

## ADR-050 — LC management is a per-shipment dimension beside the CRO, not a service

**Status:** Accepted.

**Context.** The business asks, on both export packages (Loading Point → Port and International), *who manages the Letter of Credit* — the customer runs it with their bank and we only collect a copy, or Consort manages it end-to-end. The existing machinery could not say this: `lc_finance` (ADR-041) expresses that we SELL the LC legwork, and it was auto-injected only for bank-LC-sourced customers (RULE-SVC-04). "Customer runs their own LC but we still need the copy on file" had no representation at all, and "no LC on this trade" was indistinguishable from "nobody asked".

**Decision.** A new `LcHandling` enum (`not_applicable`, `customer`, `consort`) mirrors `CroHandling`: `lc_handled_by` lands on Query → Quotation → Shipment (snapshotted forward, frozen at approval, INV-14), and both template tables gain an `lc_modes LcHandling[]` gate, evaluated package → CRO → **LC** → service. Unlike the CRO, `not_applicable` stays selectable on the export packages — open-account exports are real — so the CHECK constraints (`*_lc_mode_valid`) only force `not_applicable` on the two non-export packages.

The load-bearing subtlety: **the Consort-managed steps are NOT lc-modes-gated.** `lc_generated` (30) and `bol_submitted` (130) keep their original `lc_finance` service gate, and `consort` mode simply sells that service (`resolveServices` unions `lc_finance` when `lcHandledBy = "consort"`). Only the new row 35, `lc_received_from_customer` (compliance, `packages` both export, `lcModes ["customer"]`, requires the `lc` doc, derives `lc_generated`), carries the new gate. Gating 30/130 on `lcModes ["consort"]` — the obvious symmetric design — would have broken the one guarantee this migration made: a bank-LC customer's `local_transport` job carries `lc_finance` (RULE-SVC-04 injects it on every package) and composed 30/130 through the service gate alone; an lc-modes gate would have silently dropped those steps, since a non-export package can never hold `consort`. The compose-matrix snapshot (scripts/composeMatrixSnapshot.js) proves every pre-ADR-050 selection reproduces byte-for-byte.

`resolveLcMode` (utils/servicePackage.js) normalises the column the way `resolveCroMode` does, plus two defaults that keep it truthful: a bank-LC customer reads `consort` unless they explicitly chose `customer`, and a row whose frozen `services` already carry `lc_finance` reads `consort` — before this dimension existed, selling `lc_finance` was the only way to say "Consort runs the LC". Composition does not depend on either coercion; they exist so the badge on a legacy shipment says what is actually happening.

The International package also gains an explicit **Downstream toggle** at intake (internal form + portal wizard): it unions `destination_services`, composing the destination-agent steps (150/160/180) exactly as an Ops add-on always has. No schema, no new gate — a UI affordance over ADR-040 machinery.

**Consequences.**
- Row 35 joins `OUT_OF_ORDER_PAIRS` with `vessel_booked`, same as row 30 — chasing the customer's LC copy and booking the vessel run in parallel.
- Customer-managed LC pulls **Compliance** onto the LP→Port path (someone must vet the LC terms) — a deliberate ownership choice, flagged for UAT.
- The `lc` docType becomes customer-uploadable, and the upload controller mirrors the CRO-mode check: a portal customer may hand in an `lc` only when `lc_handled_by = "customer"` (extends ADR-047 gate 2).
- A bank-LC customer explicitly choosing `customer` suppresses the RULE-SVC-04 `lc_finance` injection — we are not selling LC legwork on a trade the customer is running.

**Forbids.** Gating `lc_generated`/`bol_submitted` on `lc_modes`; a fourth way to spell the LC vocabulary (it lives in `utils/servicePackage.js`); asking the LC question on `local_transport` or `port_to_consignee`.

---

## ADR-051 — The step and document catalog is admin-managed; step codes are strings

**Status:** Accepted.

**Context.** ADR-040/046/048 made composition fully data-driven, but the DATA was developer-only: the catalog was writable solely by `prisma/seed.js`, `OtdStepCode` was a Prisma enum (a brand-new step meant a schema change), the docType vocabulary was a Zod list mirrored by hand in the frontend, and step hints were a hardcoded frontend map. The business needs non-developers to add, gate, re-order, deactivate and document steps per service package.

**Decision.** Four moves, one principle — the catalog becomes data all the way down:

1. **`OtdStepCode` enum → `text`** on all five columns (`otd_step_templates.step_code`, `otd_step_action_templates.step_code`, `otd_steps.step_code`, `task_templates.step_code`, `charge_types.default_step_code`), one transaction (`prisma/sql/2026-07-step-code-to-text.sql`) that drops the template FK, converts both sides, re-adds it, and drops the type. Format is guarded by `otd_step_templates_code_format` (`^[a-z][a-z0-9_]{1,49}$`) and the workflow module's Zod. `ShipmentStatus`, `DepartmentCode`, `ServiceCode`, `ServicePackage`, `CroHandling`, `LcHandling` stay enums — they are code-coupled (locking, scoping, gating, UI routing); admin-created steps pick from them.
2. **`document_types` table** replaces the Zod `DOC_TYPES` closed list and the `CUSTOMER_UPLOADABLE_DOC_TYPES` allowlist (its `customer_uploadable` flag). Uploads validate against ACTIVE rows via a 60s-TTL cache (`docTypes.cache.js`, invalidated on admin writes); the frontend hydrates the vocabulary from `GET /api/documents/types` (static maps remain as pre-hydration fallback only).
3. **`modules/workflow/`** (`/api/workflow`, Management + `workflow.manage`): CRUD over steps, whole-checklist replacement, doc-type CRUD, `/meta` for admin selects, `/validate` composing every package × CRO × LC combo and reporting empty paths, paths that never derive `delivered`, dangling docTypes, and never-composed steps. Every mutation audits. Guardrails: `step_code` is **immutable** (historical `otd_steps` resolve by code forever); a step referenced by any shipment or charge type **deactivates, never deletes** (409); the step's `otd.step` TaskTemplate is upserted **in the same transaction** as every step write, via `utils/taskTemplates.js` — one derivation shared with the seed, so the Action Engine can always chain the task (RULE-AE-07). `otd_step_templates` gains `hint` (the old frontend STEP_HINTS map, now served with hydrated steps so admin-created steps carry their own guidance).
4. **The seed is demoted to factory settings.** `--templates-only` now refuses without `--factory-reset`, because a reseed REPLACES a catalog that admins may have curated. Document types are upserted, never deleted — admin-added types survive even a factory reset.

**Consequences.**
- Template edits shape **new shipments only** (INV-14) — stated in the admin UI banner and in every mutation's response message.
- **Rollback window:** the enum can be recreated only while every stored code is one of the 28 legacy labels — i.e. until the first admin-created step. The reverse SQL is documented in the migration file's header.
- Composition, status recompute and the doc gate needed **zero changes** for this ADR — they always read the tables; only the write path was frozen.
- `GET /api/services/compose` remains the one preview surface; the admin panel's Preview tab drives it with package/CRO/LC pickers.

**Forbids.** Renaming a step code; hard-deleting a used step or a referenced doc type; writing task templates for steps anywhere but `deriveTaskTemplateData`; a reseed that silently clobbers admin edits; re-introducing a hardcoded docType or step list in either codebase.

---

*ADR-001 through ADR-039 codify the resolutions the other documents already cite; ADR-040 through ADR-045 record the service-driven business logic (service catalog, composed OTD template, acquisition channels, Visit Plans, `cfo`, deactivate-and-reassign); ADR-046/047 layer the sold service packages above that catalog and scope the customer's inbound upload; ADR-048 adds the sub-action checklist beneath a step; ADR-049 adds the import delivery leg as a fourth package; ADR-050 adds the LC-management dimension beside the CRO; ADR-051 hands the whole catalog to the Workflow admin panel.*
