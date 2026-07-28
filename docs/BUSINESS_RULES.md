# BUSINESS_RULES.md
# Consort CRM — Invariants, Permissions, Rules & Edge Cases
**Authority:** Subordinate only to `DECISIONS.md`. Every other document is subordinate to this one. If an implementation contradicts a rule here, the implementation is a bug.
*Document history lives in git — this file carries no manual version bookkeeping.*

Codes used across the repo resolve here: `INV-*` (invariants), `RULE-<domain>-*` (behavioural rules), `EDGE-*` (edge cases). State-machine *shapes* live in `WORKFLOW.md`; this document owns the *rules* that govern the transitions.

---

## 1. Invariants

Invariants hold at all times, enforced at the database layer wherever possible.

| Code | Invariant | Enforcement |
|---|---|---|
| INV-01 | Every employee has exactly one role and one department | NOT NULL FK + enum |
| INV-02 | `shipments.status` is never written by an endpoint — always derived (ADR-014) | service layer only; no route writes it |
| INV-03 | Every shipment originates from exactly one approved quotation | NOT NULL unique FK |
| INV-04 | An `otd_steps` row exists **only** for steps on the shipment's composed path (ADR-040) | seeding logic + no insert route |
| INV-05 | A company has exactly one primary contact | partial unique index |
| INV-06 | A customer is 1:1 with a company | unique FK |
| INV-07 | At most one `draft`/`sent` quotation per query | partial unique index |
| INV-08 | At most one `approved` quotation per query | partial unique index |
| INV-09 | Business state, audit row and outbox event commit in the same transaction (ADR-021) | transactional outbox |
| INV-10 | Documents are internal until explicitly published | `is_published` default false; publish is audited |
| INV-11 | Customers are never members of internal chat channels | membership guard |
| INV-12 | Reference numbers (`LED-`, `CST-`, `QRY-`, `QT-`, `SHIP-`) are immutable once issued | no update path |
| INV-13 | A lead's `source` (ADR-042) is immutable after creation | no update path |
| INV-14 | The shipment's service package, CRO mode and selected-services set are immutable after quote approval (ADR-040/046) | stored at approval; no update route in Phase 1 |
| INV-15 | Every mutation writes exactly one audit row with actor, diff, IP and correlation id | global interceptor |

INV-07 and INV-08 are why a double-click on send or approve cannot create two live quotations or two shipments.

---

## 2. Permissions

Generated from `packages/contracts` (ADR-005) — that package is the single authority for both apps; this section is its human-readable rendering.

### 2.1 Vocabulary

Permissions are `resource.action` strings:

`employee.create · employee.read · employee.update · employee.deactivate · employee.reassign`
`lead.create · lead.read · lead.update · lead.convert · lead.reopen`
`visit.create · visit.read · visit.update · visit.complete`
`query.create · query.read · query.update · query.cancel`
`quotation.create · quotation.read · quotation.send · quotation.approve · quotation.reject · quotation.revise`
`shipment.read · shipment.step.complete · shipment.step.reopen · shipment.hold · shipment.resume · shipment.cancel · shipment.close · shipment.force_override`
`otc.update · invoice.issue · invoice.void · payment.record`
`task.read · task.update · task.complete · task.reassign`
`document.upload · document.read · document.publish · document.delete`
`chat.read · chat.send`
`report.read · audit.read · dashboard.read`

### 2.2 Role matrix

Scopes: **A** = all rows · **D** = own department · **T** = own team (manager closure) · **O** = own rows only · **C** = own customer's rows only · — = no access.

| Permission group | mgmt⁵ | hr | asm | bdo | ops_mgr | ops_exec | comp_mgr | comp_exec | transport_mgr | transport_exec | accounts | customer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| employee.* | A | A | — | — | — | — | — | — | — | — | — | — |
| lead.* | A | — | T | O | — | — | — | — | — | — | — | — |
| visit.* | A (read) | — | T | O | — | — | — | — | — | — | — | — |
| query.create/read/update | A (read) | — | T | O | D (read) | D (read) | D (read)⁶ | D (read)⁶ | — | — | — | C |
| quotation.create/revise | — | — | — | — | D | D | — | — | — | — | — | — |
| quotation.send | — | — | — | — | D | — | — | — | — | — | — | — |
| quotation.approve/reject | A | — | T | — | — | — | — | — | — | — | — | C |
| shipment.read | A | — | T | O | D | D | D | D | D | D | D | C |
| shipment.step.complete | — | — | — | — | D⁷ | D⁷ | D⁷ | D⁷ | D⁷ | D⁷ | D⁷ | — |
| shipment.hold/resume | A | — | — | — | D | — | D | — | D | — | — | — |
| shipment.cancel/close/force_override | A | — | — | — | D | — | — | — | — | — | — | — |
| otc.update / invoice.* / payment.record | A (read) | — | — | — | — | — | — | — | — | — | D | C (read) |
| task.read/update/complete | A (read) | — | T | O | D | O | D | O | D | O | O | — |
| task.reassign | A | — | T | — | D | — | D | — | D | — | — | — |
| document.upload/read | A | — | T | O | D | D | D | D | D | D | D | C (read published; upload inbound only⁸) |
| document.publish | A | — | T | — | D | — | D | — | — | — | D | — |
| chat.* | A | D | D | D | D | D | D | D | D | D | D | — |
| report.read | A | D (HR) | T | O | D | — | D | — | D | — | D | — |
| audit.read | A | — | — | — | — | — | — | — | — | — | — | — |
| dashboard.read | A | D | T | O | D | D | D | D | D | D | D | C |

⁵ The five Management roles — `ceo`, `project_director`, `director`, `cfo`, `gm` — hold identical permissions (ADR-044).
⁶ Compliance reads queries flagged hazardous/reefer for the pre-check.
⁷ Only for steps **owned by the role's department** on that shipment's composed path (RULE-SH-04, ADR-040).
⁸ A customer may upload only `cro`, `commercial_invoice`, `packing_list`, `authority_letterhead`, only onto their own shipment, and a `cro` only when that shipment's `cro_handled_by` is `customer` (ADR-047). Uploads land unpublished; a customer can never publish or delete.

### 2.3 Row-level scope

Scope is applied **in the repository layer**, not remembered by controllers. Out-of-scope reads return **404, not 403** — existence is never leaked.

| Scope | Resolution |
|---|---|
| `all` | No filter (Management, and HR for employee rows) |
| `department` | Rows whose owning department = user's department; for shipments, any shipment with ≥1 composed-path step owned by the department |
| `team` | Rows owned by users in the manager's reporting closure (cache warmed every 5 min) |
| `own` | Rows where the user is the owner/assignee/creator |
| `customer` | Rows belonging to the portal user's customer — never another customer's, never internal notes/margin/chat |

---

## 3. Employees — RULE-EMP

- **RULE-EMP-01** — Only the admin/management sector (Management five + `hr`) may create, edit or deactivate employees. Every employee is created with a role and a department (INV-01); an activation email with a hashed single-use token completes onboarding.
- **RULE-EMP-02** — **Deactivation is blocked while the employee owns open work.** The API returns `409 EMPLOYEE_HAS_OPEN_WORK` with per-type counts; the UI drives a reassignment wizard (`GET /employees/:id/open-work` → `POST /employees/:id/reassign-work`). Reassignment is one transaction, notifies both old and new owners, and is audited. Only then may deactivation proceed (ADR-045).
- **RULE-EMP-03** — Reporting-manager assignment runs cycle detection; an employee can never be in their own reporting chain.
- **RULE-EMP-04** — Changing an employee's role or department re-scopes their dashboard, queues and visibility immediately; open tasks assigned to them **stay assigned** (work does not silently vanish) but are flagged to the department head for review.
- **RULE-EMP-05** — Deactivation bumps `token_version`, revokes all refresh tokens, closes chat memberships (`left_at`) and force-disconnects live sockets (EDGE-A-04). History is retained forever.

---

## 4. Leads — RULE-LD

- **RULE-LD-01** — A lead is created with company, contact and immutable `source` (`bdo | bank_lc | direct`, ADR-042). Company and contact are created once, at lead time — conversion links, never re-creates.
- **RULE-LD-02** — `contacted → qualified` requires **at least one logged non-negative outreach** (a completed Visit Plan counts, ADR-043).
- **RULE-LD-03** — `new → lost` is a legal transition (unreachable contact, bad fit). v1 made it impossible, so dead leads polluted `new` forever.
- **RULE-LD-04** — `lost → contacted` (reopen) is legal and requires a reason. Leads come back from the dead; the model represents it.
- **RULE-LD-05** — Conversion is **one transaction**: create `customers` row + `CST-` code, link existing company/contact, set `converted_at`/`converted_to_customer_id`, write `lead_status_history`, emit `lead.converted`. Partial conversion cannot exist.
- **RULE-LD-06** — `lost` requires `lostReason`; the funnel/conversion report is built on those reasons. Every transition writes `lead_status_history` with actor and notes.

---

## 5. Visit Plans — RULE-VP

- **RULE-VP-01** — A Visit Plan requires a target (lead or customer), assigned salesperson (BDO/ASM), purpose, planned date/time and location. Machine: `planned → completed | cancelled | no_show`; `no_show → planned` on reschedule (`WORKFLOW.md §2a`).
- **RULE-VP-02** — Completion requires an outcome + notes, and is **recorded as an outreach touch** on the linked lead/customer timeline — it can advance the lead machine exactly as a logged meeting does (RULE-LD-02).
- **RULE-VP-03** — Scope follows the sales ladder: BDO own, ASM team, Management all.
- **RULE-VP-04** — A `no_show` notifies the BDO and escalates to the ASM; repeated no-shows on one lead surface on the ASM dashboard.

---

## 6. Queries — RULE-QRY

- **RULE-QRY-01** — A query is raised by a BDO for their customer, or self-served by a portal customer. Ports and container types are validated against reference data on **both create and update**. A `local_transport` query carries free-text `pickup_address`/`delivery_address` instead and must carry **no** port codes; `loading_point_to_port` needs an origin port; `international` needs both. (Incoterm is free text — there is no Incoterm reference table in Phase 1.)
- **RULE-QRY-02** — Hazardous or reefer cargo auto-creates a **Compliance pre-check task** (`query.hazardous` → Action Engine) before pricing.
- **RULE-QRY-03** — Cancellation requires a reason; reasons feed the unserved-demand report.
- **RULE-QRY-04** — A query with no quotation after 90 days auto-expires; staleness at 14 days notifies BDO and ASM.
- **RULE-QRY-05** — **Every query records a service package and a non-empty set of services.** The customer picks the package (ADR-046); it presets the service set from the catalog (ADR-041), and Ops may add to it but never below it. Package, CRO mode and service set are all carried onto the quotation and frozen onto the shipment at approval (INV-14).
- **RULE-QRY-06** — The CRO mode must be one the package allows: `local_transport` ⇒ `not_applicable`; `loading_point_to_port` and `international` ⇒ `customer` or `consort`. Enforced at the API boundary and by the `*_cro_mode_valid` CHECK constraints (ADR-046).

---

## 7. Service Composition — RULE-SVC

The mechanism behind "a local order has fewer steps and no customs role." Normative table: `WORKFLOW.md §4a.1`.

- **RULE-SVC-01** — At quote approval, seed every step template that passes all three gates — **package → CRO mode → service**, each *empty means don't gate* — in canonical order (ADR-040/046).
- **RULE-SVC-02** — **A department with no step on the composed path has no role on that shipment** — no queue entry, no tasks, no ownership, no dashboard presence for it.
- **RULE-SVC-03** — `shipments.status` derives from the highest completed step **on the composed path**; a shorter path exposes only its own subset of the status enum.
- **RULE-SVC-04** — `lc_finance` is implied when the customer's `source` is `bank_lc`, and may also be selected explicitly (ADR-041/042). It is additive on top of any package.
- **RULE-SVC-05** — Display renumbers the composed path 1..N; `step_code` and the canonical number are retained for cross-shipment reporting.
- **RULE-SVC-06** — **Every package composes exactly one terminal step deriving `delivered`** (`delivered`, `local_delivered` or `port_job_completed`). Load-bearing: settlement requires status `delivered`, so a package without one could never settle or close.
- **RULE-SVC-07** — Composition **requires** a package; there is no null-package fallback, because skipping the package gate would put the local trucking leg on every shipment. Rows predating packages are resolved by `inferPackageFromServices` and backfilled by `scripts/backfillServicePackages.js`.
- **RULE-SVC-06** — Changing services after approval is out of Phase-1 scope; the only path is cancel-and-requote, which is audited.

---

## 8. Quotations — RULE-QT

- **RULE-QT-01** — `ops_exec` or `ops_manager` drafts; **only `ops_manager` sends** — four-eyes on outbound pricing.
- **RULE-QT-02** — Charge-line totals are computed server-side; a client-supplied total is ignored.
- **RULE-QT-03** — Approval may come from the customer (portal), the ASM on the customer's behalf, or Management — **never the owning BDO** (no self-approval of one's own deal).
- **RULE-QT-04** — Rejection requires a reason and moves the query to `revision_requested` (ADR-030).
- **RULE-QT-05** — A revision is a new row: version n+1, `draft`, `parent_quotation_id` (ADR-019). INV-07/08 hold across versions.
- **RULE-QT-06** — Quotations expire automatically past `validity_date` (nightly job); a warning fires 48 h before.
- **RULE-QT-07** — **Approval is one transaction**: quotation → `approved`; query → `shipment_created`; shipment + composed OTD steps (RULE-SVC-01) + 5 OTC milestones + chat channel + draft invoice + audit row + `outbox_events('quotation.approved')`. All of it commits or none of it does.
- **RULE-QT-08** — Approval is guarded by validity, optimistic concurrency (`If-Match`) and the customer's credit standing.

---

## 9. Shipments — RULE-SH

- **RULE-SH-01** — A shipment exists only as a consequence of quote approval (INV-03); it carries the frozen services set and its composed step template.
- **RULE-SH-02** — Progress is written **only** through OTD step completion; status is derived (ADR-014).
- **RULE-SH-03** — **The one permitted out-of-order pair: steps 3 and 4** may complete in either order (a nominated booking sometimes precedes LC confirmation) — applicable only when both are on the composed path. Anything else requires `shipment.force_override` with justification, and is audited.
- **RULE-SH-04** — A step may be completed only by a member of its **owning department** (per ADR-003/039, restricted to the composed path). The assigned employee completes it by **submitting/confirming the step's task** — completion is an explicit act, never automatic.
- **RULE-SH-05** — Reopening step *n* reopens every step after *n* and recomputes status downward. Reopening requires manager authority in the owning department and a reason. It also resets that step's **manual** sub-actions (RULE-SH-13); document sub-actions stay satisfied, because the files are still on record.
- **RULE-SH-06** — Step completion requires the step's mandatory document(s) to be attached where the template defines one (e.g. GD, BOL, POD). The requirement is the **union** of the template's `required_doc_types` and the doc types of the step's required `document` sub-actions (ADR-048) — so a pack that lives in a checklist blocks the step exactly like a fixed requirement, and a document is enforced in one place only.
- **RULE-SH-07** — Completion uses optimistic concurrency (`If-Match`) and a per-shipment advisory lock; two simultaneous completions cannot interleave.
- **RULE-SH-08** — Hold, resume and cancel are **orthogonal to progress** (`exception_state`); a shipment is "on hold *at* step 7", never "in an on-hold status".
- **RULE-SH-09** — **While held:** open tasks freeze, SLA clocks stop and `hold_minutes` accrue, the Action Engine skips the shipment (RULE-AE-06), OTD/OTC writes return `409 SHIPMENT_ON_HOLD` — but documents and chat stay open, because people still need to work the problem. Progress position is never lost.
- **RULE-SH-10** — **On resume:** tasks return to `status_before_hold` and `due_date += hold_minutes` (ADR-038). This keeps the overdue metric honest — without it, every held shipment poisons the department's SLA numbers.
- **RULE-SH-11** — Cancellation requires a reason; it cancels open tasks, voids unpaid invoices and notifies all parties. Cancelled shipments are read-only except for documents.
- **RULE-SH-12** — `delivered` + all OTC milestones done → derives `settled`; `settled → closed` by `ops_manager` or Management. Closed shipments are immutable.
- **RULE-SH-13** — A step carrying a **sub-action checklist** (ADR-048) cannot complete while a required **manual** item is open. A force override does not bypass it: `shipment.force_override` answers a sequence question, and an unticked checklist item is unfinished work, not a sequence problem. Items are ticked by a member of the step's owning department (RULE-SH-04); a `document` item is satisfied by attaching its file and may never be ticked by hand (409). RULE-SH-13 and RULE-SH-06 are evaluated together and reported in one 422, so a step that fails both says so once.

---

## 10. Finance — RULE-FI

- **RULE-FI-01** — The invoice is auto-drafted from the approved quotation's charge lines in the approval transaction; Accounts reviews and issues it.
- **RULE-FI-02** — Issuing an invoice **automatically completes OTC milestone 1** (Invoice Issued).
- **RULE-FI-03** — Recording the payment that fully settles an invoice **automatically completes OTC milestone 2** (Payment Received). Part-payments accumulate; the milestone completes only at full settlement.
- **RULE-FI-04** — OTC milestones 3–5 (Credit Line Released, BOL Surrendered, Settlement Complete) are recorded manually by Accounts, in order.
- **RULE-FI-05** — An invoice is voidable **only while unpaid**. Payments carry method, reference and FX rate captured at commit (ADR-006). Milestone `amount` is a display mirror; reports aggregate `invoices` and `payments` only.

---

## 11. Action Engine — RULE-AE

- **RULE-AE-01** — Triggers are **domain events, never statuses** (ADR-020), consumed from the transactional outbox (ADR-021).
- **RULE-AE-02** — Each event matches active task templates; a template defines title, description, owning department/role, due-offset and required documents.
- **RULE-AE-03** — Assignment follows the deterministic four-step chain: **shipment-role assignee → department head → least-loaded department member → department queue**. First hit wins.
- **RULE-AE-04** — Consumption is **idempotent**: tasks upsert `ON CONFLICT (idempotency_key) DO NOTHING`. At-least-once delivery is therefore safe; replays are no-ops.
- **RULE-AE-05** — An event with no matching template, or a template with no eligible assignee, emits `action.unroutable` → **Management alert**. Work is never silently dropped.
- **RULE-AE-06** — All triggers are **suppressed for held, cancelled and closed shipments**; a resume thaws exactly what the hold froze.
- **RULE-AE-07** — **Only templates for steps on the shipment's composed path fire** (ADR-040). A local-only shipment can never generate a customs, bank or BOL task, because those steps do not exist on it.

---

## 12. Tasks — RULE-TK

- **RULE-TK-01** — A task belongs to a shipment step, a query pre-check, or an ad-hoc origin; it always has an owning department, and an assignee or a department-queue position.
- **RULE-TK-02** — **Completing/confirming the task is what completes its OTD step** (RULE-SH-04) — the assigned field employee submits, the step completes, the shipment status advances, and the next step's task fires. Required documents must be attached before submit.
- **RULE-TK-03** — Overdue escalation: assignee (on breach) → department head → Management at 48 h. Held tasks are exempt (`sla_paused_at` set).
- **RULE-TK-04** — Reassignment is manager-level (`task.reassign`), notifies both parties, and is audited.

---

## 13. Documents — RULE-DOC

- **RULE-DOC-01** — **Internal by default** (INV-10). Publishing to the portal is an explicit, audited act by a manager-level role.
- **RULE-DOC-02** — Uploads are size- and type-validated, magic-byte sniffed, checksum-deduplicated and virus-scanned; downloads are presigned and audited.
- **RULE-DOC-03** — Documents attach polymorphically (shipments, quotations, queries, leads, customers, tasks, chat) and follow the parent's scope.
- **RULE-DOC-04** — Step-mandatory documents (RULE-SH-06) cannot be deleted while the step is open or completed; orphaned storage objects are swept nightly (EDGE-D-04).

---

## 14. Chat & Notifications — RULE-CH / RULE-NT

- **RULE-CH-01** — Channels: shipment (auto-created at shipment birth), department, general, direct. **Customers are never members** (INV-11).
- **RULE-CH-02** — Sends are idempotent (client message id); edits within the edit window; deletes are soft. Per-member read markers drive unread counts.
- **RULE-CH-03** — Chat stays open on held shipments (RULE-SH-09) and closes to read-only on cancelled/closed ones.
- **RULE-NT-01** — Per-user, per-type, per-channel preferences, with **two operationally mandatory exceptions that cannot be muted: `task.assigned` and `shipment.held`** — nobody may opt out of learning they own work or that their shipment stopped.
- **RULE-NT-02** — Notifications carry priority, grouping and an action link; quiet hours defer non-mandatory channels.
- **RULE-NT-03** — Per-channel delivery is tracked (queued/sent/failed) so "I never received it" is answerable.

---

## 15. Edge Cases — EDGE

| Code | Case | Resolution |
|---|---|---|
| EDGE-A-01 | Login with correct password on a deactivated account | Same `401 INVALID_CREDENTIALS` shape and timing — no enumeration |
| EDGE-A-02 | Refresh-token reuse detected | Whole token family revoked, user forced to re-login, security notification |
| EDGE-A-03 | Role changed while user is logged in | `token_version` bump invalidates tokens; next request re-authenticates into the new role |
| EDGE-A-04 | Employee deactivated while connected | Gateway **force-disconnects** all live sockets; sessions revoked (RULE-EMP-05) |
| EDGE-D-04 | Upload committed to storage but DB transaction rolled back | Nightly orphan sweep deletes storage objects with no committed row after 24 h |
| EDGE-T-05 | Socket event arrives out of order / read replica lags | Events are **invalidation hints, never authoritative state** — client re-fetches; stale payloads are harmless |
| EDGE-V-01 | Redis/queue outage during quote approval | The outbox row committed with the transaction; the relay dispatches when the queue returns — **a task can be delayed, never lost** |
| EDGE-V-02 | Same event delivered twice | Idempotency keys make the second delivery a no-op (RULE-AE-04) |
| EDGE-SH-01 | Step completed, then its shipment is held before the next task is worked | The created task freezes with the rest (RULE-SH-09); resume restores it with shifted due date |
| EDGE-SH-02 | Quote approved for a customer whose BDO was deactivated mid-cycle | Assignment chain (RULE-AE-03) falls through to department head / queue; `action.unroutable` fires only if the whole chain is empty |
| EDGE-SVC-01 | Bank-LC customer's query submitted without `lc_finance` | The service is implied and added at approval time (RULE-SVC-04); the quote screen shows it as included |
| EDGE-SVC-02 | Template references a step not on this shipment's composed path | The Action Engine skips it by definition (RULE-AE-07); if a template *only* targets absent steps, nothing fires and nothing should |
| EDGE-LD-01 | Two BDOs create leads for the same company | Company duplicate detection warns on create; both leads may proceed (two contacts ≠ one deal), flagged to the ASM |
| EDGE-QT-01 | Customer clicks approve twice / two tabs | `If-Match` + INV-08: the second request gets `409`/`412`; one shipment exists |
| EDGE-FI-01 | Payment recorded against a voided invoice | Rejected — void is only reachable while unpaid (RULE-FI-05), and payments validate invoice status |

---

*§2 is the human-readable rendering of `packages/contracts` (ADR-005); regenerate it when the contracts change. Every `RULE-*`, `INV-*` and `EDGE-*` code cited by `CRM_MASTER.md` and `WORKFLOW.md` resolves in this document.*
