/**
 * End-to-end check of the own-fleet API and master-data documents against a
 * RUNNING local server. Leaves zero residue: everything it creates it deletes,
 * uploaded file included.
 *
 *   node scripts/verifyFleetCrud.js               # assumes http://localhost:5000
 *   BASE=http://localhost:5000 EMAIL=ops.exec@consort.test PASSWORD=1234567 node scripts/verifyFleetCrud.js
 *
 * Runs as ops_exec deliberately — the role granted `fleet.manage` last, so if the
 * permission map is wrong this fails first.
 *
 * Exercises: login → driver create/list/patch → duplicate CNIC 409 → vehicle
 * create for both kinds → kind filter → document upload against a driver (named
 * after its reference and type) → list → download → delete → 404 on an invented
 * owner id.
 */
import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { UPLOAD_ROOT } from "../modules/document/document.service.js";

const BASE = process.env.BASE ?? "http://localhost:5000";
const EMAIL = process.env.EMAIL ?? "ops.exec@consort.test";
const PASSWORD = process.env.PASSWORD ?? "1234567";

const CNIC = "4210199999991";
const PLATE_TRUCK = "ZZVERIFY1";
const PLATE_DUMPER = "ZZVERIFY2";
const DRIVER_NAME = "ZZ Verify Driver";

let token = null;
const call = async (method, p, body) => {
  const res = await fetch(`${BASE}/api${p}`, {
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

// A real 1×1 PNG: the upload path magic-byte sniffs the file, so random bytes
// with a .png name would be rejected for the wrong reason.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const storageKeys = [];

const cleanup = async () => {
  const drivers = await prisma.driver.findMany({
    where: { OR: [{ name: DRIVER_NAME }, { cnic: CNIC }] },
    select: { id: true },
  });
  const vehicles = await prisma.fleetVehicle.findMany({
    where: { plateNo: { in: [PLATE_TRUCK, PLATE_DUMPER] } },
    select: { id: true },
  });
  const ownerIds = [...drivers.map((d) => d.id), ...vehicles.map((v) => v.id)];
  if (ownerIds.length) {
    const docs = await prisma.document.findMany({
      where: { ownerId: { in: ownerIds } },
      select: { id: true, storageKey: true },
    });
    for (const d of docs) storageKeys.push(d.storageKey);
    await prisma.auditLog.deleteMany({ where: { resourceType: "document", resourceId: { in: docs.map((d) => d.id) } } });
    await prisma.document.deleteMany({ where: { ownerId: { in: ownerIds } } });
  }
  await prisma.driver.deleteMany({ where: { id: { in: drivers.map((d) => d.id) } } });
  await prisma.fleetVehicle.deleteMany({ where: { id: { in: vehicles.map((v) => v.id) } } });
  for (const key of storageKeys) {
    try { fs.unlinkSync(path.join(UPLOAD_ROOT, key)); } catch { /* already gone */ }
  }
};

async function run() {
  await cleanup();

  const login = await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
  if (!login.json?.accessToken) {
    throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.json)?.slice(0, 200)} — is the server running?`);
  }
  token = login.json.accessToken;
  const perms = login.json.permissions ?? []; // top-level on the login payload, not under `user`
  check("login as ops_exec", true);
  check("ops_exec holds fleet.read + fleet.manage", perms.includes("fleet.read") && perms.includes("fleet.manage"),
    perms.filter((p) => p.startsWith("fleet.")).join(", ") || "none");

  // ── drivers ──
  const created = await call("POST", "/drivers", {
    name: DRIVER_NAME, phone: "0300-1234567", cnic: "42101-9999999-1", licenseNo: "LHR-99-9999",
  });
  const driver = created.json?.data;
  check("POST /drivers → 201", created.status === 201 && !!driver?.id, driver?.referenceNo);
  check("reference is DRV-YYYY-NNNNN", /^DRV-\d{4}-\d{5}$/.test(driver?.referenceNo ?? ""), driver?.referenceNo);
  check("CNIC stored digits-only", driver?.cnic === CNIC, driver?.cnic);

  const list = await call("GET", "/drivers");
  check("GET /drivers lists it", Array.isArray(list.json?.data) && list.json.data.some((d) => d.id === driver.id),
    `${list.json?.data?.length ?? 0} rows`);

  const search = await call("GET", "/drivers?q=ZZ%20Verify");
  check("GET /drivers?q= finds by name", search.json?.data?.some((d) => d.id === driver.id));

  const patched = await call("PATCH", `/drivers/${driver.id}`, { phone: "0301-7654321" });
  check("PATCH /drivers/:id", patched.status === 200 && patched.json?.data?.phone === "0301-7654321");

  const dupe = await call("POST", "/drivers", { name: "ZZ Verify Driver", cnic: CNIC });
  check("duplicate CNIC → 409", dupe.status === 409, dupe.json?.message);

  const badCnic = await call("POST", "/drivers", { name: "ZZ Verify Driver", cnic: "123" });
  check("short CNIC → 400/422", badCnic.status === 400 || badCnic.status === 422, String(badCnic.status));

  // ── vehicles ──
  const truck = await call("POST", "/vehicles", { kind: "truck", plateNo: "zz-verify 1" });
  check("POST /vehicles (truck) → 201", truck.status === 201, truck.json?.data?.referenceNo);
  check("plate normalised", truck.json?.data?.plateNo === PLATE_TRUCK, truck.json?.data?.plateNo);

  const dumper = await call("POST", "/vehicles", { kind: "dumper", plateNo: PLATE_DUMPER });
  check("POST /vehicles (dumper) → 201", dumper.status === 201, dumper.json?.data?.referenceNo);

  const trucks = await call("GET", "/vehicles?kind=truck");
  const dumpers = await call("GET", "/vehicles?kind=dumper");
  check("kind filter separates the two views",
    trucks.json?.data?.some((v) => v.id === truck.json.data.id)
    && !trucks.json?.data?.some((v) => v.id === dumper.json.data.id)
    && dumpers.json?.data?.some((v) => v.id === dumper.json.data.id),
    `${trucks.json?.data?.length} trucks / ${dumpers.json?.data?.length} dumpers`);

  const dupePlate = await call("POST", "/vehicles", { kind: "truck", plateNo: "ZZVERIFY1" });
  check("duplicate plate → 409", dupePlate.status === 409, dupePlate.json?.message);

  // ── documents on master data ──
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "IMG_0043.png");
  form.append("ownerType", "driver");
  form.append("ownerId", driver.id);
  form.append("docType", "cnic");
  const upRes = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const upJson = await upRes.json().catch(() => null);
  const doc = upJson?.data;
  if (doc?.id) {
    const row = await prisma.document.findUnique({ where: { id: doc.id }, select: { storageKey: true } });
    if (row) storageKeys.push(row.storageKey);
  }
  check("upload CNIC against a driver → 201", upRes.status === 201 && !!doc?.id, upJson?.message);
  check("renamed after reference + doc type", doc?.fileName === `${driver.referenceNo}_CNIC-National-ID.png`, doc?.fileName);
  check("internal by default (INV-10)", doc?.isPublished === false);

  const docs = await call("GET", `/documents?ownerType=driver&ownerId=${driver.id}`);
  check("GET /documents lists it", docs.json?.data?.some((d) => d.id === doc?.id), `${docs.json?.data?.length ?? 0} docs`);

  const dl = await fetch(`${BASE}/api/documents/${doc.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  const bytes = Buffer.from(await dl.arrayBuffer());
  check("download returns the same bytes", dl.status === 200 && bytes.equals(PNG), `${bytes.length} bytes`);

  // ops_exec holds no document.publish, so ask a manager — the refusal must come
  // from the owner type, not from the permission gate in front of it.
  const mgr = await call("POST", "/auth/login", { email: "ops.manager@consort.test", password: PASSWORD });
  const mgrPublish = await fetch(`${BASE}/api/documents/${doc.id}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mgr.json?.accessToken}` },
  });
  check("publishing master-data doc → 409", mgrPublish.status === 409, String(mgrPublish.status));

  // Inline preview — same bytes, served for on-screen rendering, audited apart from
  // downloads so a thumbnail never reads as "someone took a copy".
  const pv = await fetch(`${BASE}/api/documents/${doc.id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  const pvBytes = Buffer.from(await pv.arrayBuffer());
  check("preview serves the bytes inline", pv.status === 200 && pvBytes.equals(PNG)
    && (pv.headers.get("content-disposition") ?? "").startsWith("inline"),
    pv.headers.get("content-disposition"));
  const pvAudit = await prisma.auditLog.findFirst({ where: { resourceId: doc.id, action: "document.preview" } });
  check("preview audits as document.preview, not download", !!pvAudit);

  // A format the browser cannot draw must refuse the preview rather than stream
  // bytes an <img> would render as a broken icon.
  const txtForm = new FormData();
  txtForm.append("file", new Blob(["zz verify"], { type: "text/plain" }), "note.txt");
  txtForm.append("ownerType", "driver");
  txtForm.append("ownerId", driver.id);
  const txtUp = await fetch(`${BASE}/api/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: txtForm });
  const txtJson = await txtUp.json().catch(() => null);
  if (txtJson?.data?.id) {
    const row = await prisma.document.findUnique({ where: { id: txtJson.data.id }, select: { storageKey: true } });
    if (row) storageKeys.push(row.storageKey);
    const txtPv = await fetch(`${BASE}/api/documents/${txtJson.data.id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
    check("non-previewable type → 415", txtPv.status === 415, String(txtPv.status));
  } else {
    check("non-previewable type → 415", false, `upload failed: ${txtJson?.message}`);
  }

  const ghost = await call("GET", "/documents?ownerType=driver&ownerId=00000000-0000-0000-0000-000000000000");
  check("unknown driver owner → 404", ghost.status === 404, String(ghost.status));

  const vehDoc = new FormData();
  vehDoc.append("file", new Blob([PNG], { type: "image/png" }), "reg.png");
  vehDoc.append("ownerType", "vehicle");
  vehDoc.append("ownerId", truck.json.data.id);
  vehDoc.append("docType", "vehicle_registration");
  const vehUp = await fetch(`${BASE}/api/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: vehDoc });
  const vehJson = await vehUp.json().catch(() => null);
  if (vehJson?.data?.id) {
    const row = await prisma.document.findUnique({ where: { id: vehJson.data.id }, select: { storageKey: true } });
    if (row) storageKeys.push(row.storageKey);
  }
  check("upload registration against a vehicle → 201", vehUp.status === 201, vehJson?.data?.fileName);

  // ── deactivate (soft) ──
  const off = await call("POST", `/drivers/${driver.id}/deactivate`);
  const after = await call("GET", `/drivers/${driver.id}`);
  check("deactivate is soft", off.status === 200 && after.json?.data?.isActive === false);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log(`✗ failing: ${failed.map((f) => f.name).join(", ")}`);
    process.exitCode = 1;
  }
}

run()
  .catch((err) => {
    console.error("✗ run failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
