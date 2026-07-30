/**
 * End-to-end check of the Workflow admin API (ADR-051) against a RUNNING local server.
 * Leaves zero residue: everything it creates it deletes.
 *
 *   node scripts/verifyWorkflowCrud.js            # assumes http://localhost:5000
 *   BASE=http://localhost:5000 EMAIL=ceo@consort.test PASSWORD=1234567 node scripts/verifyWorkflowCrud.js
 *
 * Exercises: login → meta → doc-type create → step create (canonical 9990, using the
 * new doc type) → TaskTemplate appeared → patch title → replace checklist → validate
 * runs → delete step → TaskTemplate gone → delete doc type → negative cases
 * (bad code 400, duplicate canonicalNo 409).
 */
import prisma from "../config/prisma.js";

const BASE = process.env.BASE ?? "http://localhost:5000";
const EMAIL = process.env.EMAIL ?? "ceo@consort.test";
const PASSWORD = process.env.PASSWORD ?? "1234567";

const STEP = "zz_verify_step";
const DOCTYPE = "zz_verify_doc";

let token = null;
const call = async (method, path, body) => {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// Best-effort cleanup so a mid-run failure never leaves residue for the next run.
const cleanup = async () => {
  await prisma.taskTemplate.deleteMany({ where: { eventCode: "otd.step", stepCode: STEP } });
  await prisma.otdStepActionTemplate.deleteMany({ where: { stepCode: STEP } });
  await prisma.otdStepTemplate.deleteMany({ where: { stepCode: STEP } });
  await prisma.documentType.deleteMany({ where: { code: DOCTYPE } });
};

async function run() {
  await cleanup();

  const login = await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
  if (!login.json?.accessToken) {
    throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.json)?.slice(0, 200)} — is the server running?`);
  }
  token = login.json.accessToken;
  check("login as Management", true);

  const meta = await call("GET", "/workflow/meta");
  check("GET /workflow/meta", meta.status === 200 && meta.json.data.packages.length === 4, `${meta.status}`);

  const dt = await call("POST", "/workflow/doc-types", { code: DOCTYPE, label: "ZZ Verify Doc", customerUploadable: false });
  check("create doc type", dt.status === 201, `${dt.status}`);

  const created = await call("POST", "/workflow/steps", {
    stepCode: STEP,
    canonicalNo: 9990,
    title: "ZZ Verify Step",
    hint: "Throwaway verification step.",
    ownerDepartment: "operations",
    derivedStatus: "in_transit",
    dueOffsetHours: 24,
    packages: ["local_transport"],
    requiredDocTypes: [DOCTYPE],
  });
  check("create step", created.status === 201, `${created.status} ${created.json?.message ?? ""}`);

  const tpl1 = await prisma.taskTemplate.findFirst({ where: { eventCode: "otd.step", stepCode: STEP } });
  check("TaskTemplate auto-created", !!tpl1 && tpl1.requiredDocTypes.includes(DOCTYPE));

  const patched = await call("PATCH", `/workflow/steps/${STEP}`, { title: "ZZ Verify Step (renamed)" });
  check("patch step title", patched.status === 200 && patched.json.data.title.endsWith("(renamed)"), `${patched.status}`);

  const actions = await call("PUT", `/workflow/steps/${STEP}/actions`, {
    actions: [
      { actionCode: "tick_me", title: "Manual tick", kind: "manual", sortOrder: 10 },
      { actionCode: "attach_me", title: "Attach the doc", kind: "document", docType: DOCTYPE, sortOrder: 20 },
    ],
  });
  check("replace checklist", actions.status === 200 && actions.json.data.length === 2, `${actions.status}`);

  const tpl2 = await prisma.taskTemplate.findFirst({ where: { eventCode: "otd.step", stepCode: STEP } });
  check("TaskTemplate re-synced after rename + checklist", !!tpl2 && tpl2.title.includes("renamed") && tpl2.requiredDocTypes.includes(DOCTYPE));

  const validate = await call("GET", "/workflow/validate");
  check("GET /workflow/validate", validate.status === 200 && Array.isArray(validate.json.data.combos), `${validate.status}`);

  const badCode = await call("POST", "/workflow/steps", {
    stepCode: "Bad-Code", canonicalNo: 9991, title: "Nope", ownerDepartment: "operations", derivedStatus: "in_transit",
  });
  check("invalid step code rejected", badCode.status === 400, `${badCode.status}`);

  const dupNo = await call("POST", "/workflow/steps", {
    stepCode: "zz_verify_dup", canonicalNo: 9990, title: "Duplicate number", ownerDepartment: "operations", derivedStatus: "in_transit",
  });
  check("duplicate canonicalNo rejected", dupNo.status === 409, `${dupNo.status}`);

  const delBlocked = await call("DELETE", `/workflow/doc-types/${DOCTYPE}`);
  check("doc type delete blocked while referenced", delBlocked.status === 409, `${delBlocked.status}`);

  const delStep = await call("DELETE", `/workflow/steps/${STEP}`);
  check("delete step", delStep.status === 200, `${delStep.status}`);

  const tpl3 = await prisma.taskTemplate.findFirst({ where: { eventCode: "otd.step", stepCode: STEP } });
  check("TaskTemplate removed with step", !tpl3);

  const delDt = await call("DELETE", `/workflow/doc-types/${DOCTYPE}`);
  check("delete doc type after step gone", delDt.status === 200, `${delDt.status}`);

  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    console.error(`\n${failures.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed — zero residue left behind.`);
}

run()
  .catch(async (e) => {
    console.error("verifyWorkflowCrud failed:", e.message);
    await cleanup().catch(() => {});
    process.exit(1);
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
