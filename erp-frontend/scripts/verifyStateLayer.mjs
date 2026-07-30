/**
 * verifyStateLayer.mjs — regression check for the app-wide state layer.
 *
 * There is no test runner in this repo, so this is a plain script in the house
 * "verify by script" style (cf. erp-backend/scripts/verify*.js). It exercises the two
 * primitives every store is built on, and in particular the guards whose absence used
 * to leave a browser reload as the only cure:
 *
 *   · a stale response for entity A must never overwrite entity B's data
 *   · switching entity must not show the previous one's rows, not even one frame
 *   · a failed refresh must never blank content already on screen
 *   · a background refetch must never raise `loading` (that flashes a spinner over
 *     content the user is reading, which is worse than not refreshing at all)
 *   · an invalidation must not fire requests into unmounted screens
 *
 * Run:  npm run verify:state        (from erp-frontend/)
 */
import { createResourceStore, resetAllStores } from "../src/lib/createResourceStore.js";
import {
  clearAllStale, invalidate, matcherFor, registerSubscriber, revalidateAll,
} from "../src/lib/invalidationBus.js";
import { documentsTopic, shipmentTopic, topicMatches } from "../src/lib/topics.js";

let pass = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) pass += 1;
  else failures.push(name);
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── topic matching ─────────────────────────────────────────────────────────── */

ok("exact topic matches", topicMatches("leads", "leads"));
ok("bare prefix dirties an entity-scoped topic", topicMatches("shipment:abc", "shipment"));
ok("an entity-scoped topic does NOT dirty a sibling", !topicMatches("shipment:abc", "shipment:xyz"));
ok("entity-scoped exact match", topicMatches("shipment:abc", "shipment:abc"));
ok("unrelated topics don't match", !topicMatches("leads", "shipments"));
ok("no partial-word bleed between `shipment` and `shipments`", !topicMatches("shipments", "shipment"));
ok("shipmentTopic builder", shipmentTopic("x") === "shipment:x");
ok("documentsTopic builder", documentsTopic("shipment", "x") === "documents:shipment:x");

/* ── the bus ────────────────────────────────────────────────────────────────── */

let calls = 0;
let live = true;
const sub = registerSubscriber({
  matches: matcherFor(() => ["leads", shipmentTopic("abc")]),
  refetch: async () => { calls += 1; },
  isLive: () => live,
});

invalidate("leads");
await tick();
ok("a live subscriber refetches on its topic", calls === 1);

// Three invalidations that all match, inside one tick.
invalidate("leads");
invalidate("shipment:abc");
invalidate("shipment");
await tick();
ok("several invalidations in one tick coalesce into ONE refetch", calls === 2);

invalidate("invoices");
await tick();
ok("an unowned topic is ignored", calls === 2);

live = false;
invalidate("leads");
await tick();
ok("an unmounted subscriber issues no request", calls === 2);
ok("...and is flagged stale instead", sub.isStale() === true);
sub.clearStale();
ok("clearStale resets the flag", sub.isStale() === false);

live = true;
revalidateAll();
await tick();
ok("revalidateAll refetches live subscribers", calls === 3);
live = false;
revalidateAll();
await tick();
ok("revalidateAll skips unmounted subscribers", calls === 3);
ok("...flagging them stale for next mount", sub.isStale() === true);
clearAllStale();
ok("clearAllStale resets every flag", sub.isStale() === false);

// One store's refetch throwing must not cancel the rest of the batch.
let sibling = 0;
registerSubscriber({ matches: () => true, refetch: async () => { throw new Error("boom"); }, isLive: () => true });
registerSubscriber({ matches: () => true, refetch: async () => { sibling += 1; }, isLive: () => true });
invalidate("leads");
await tick();
await tick();
ok("a rejecting refetch does not block sibling subscribers", sibling === 1);

sub.unregister();
const before = calls;
live = true;
invalidate("leads");
await tick();
ok("an unregistered subscriber stops receiving", calls === before);

/* ── the factory ────────────────────────────────────────────────────────────── */

const delay = { A: 0, B: 0 };
let serverFails = false;
let hits = [];

const useStore = createResourceStore({
  name: "verify",
  topics: ["leads"],
  state: { owner: null, rows: [] },
  keyOf: ([owner]) => owner ?? null,
  clearOnKeyChange: { rows: [] },
  load: async ({ args }) => {
    const [owner] = args;
    hits.push(owner);
    await sleep(delay[owner] ?? 0);
    if (serverFails) throw new Error("server down");
    return { owner, rows: [`${owner}-row`] };
  },
  actions: ({ mutate }) => ({
    write: (opts) => mutate(async () => ({ data: "written" }), opts),
  }),
});
const s = () => useStore.getState();

const first = s().fetch("A");
ok("first load raises `loading`", s().loading === true && s().refreshing === false);
await first;
ok("first load lands data", s().rows[0] === "A-row");
ok("first load clears `loading`", s().loading === false);
ok("first load stamps lastFetchedAt", typeof s().lastFetchedAt === "number");

const bg = s().refetch();
ok("a background refetch raises `refreshing`, never `loading`", s().refreshing === true && s().loading === false);
await bg;
ok("...and clears it when done", s().refreshing === false);

hits = [];
delay.A = 30;
await Promise.all([s().fetch("A"), s().fetch("A")]);
ok("two identical concurrent fetches share ONE request", hits.length === 1);
delay.A = 0;

hits = [];
await s().fetch("A", { ifAbsent: true });
ok("`ifAbsent` skips a key that already settled", hits.length === 0);

delay.B = 20;
const toB = s().fetch("B");
ok("switching entity blanks the previous rows synchronously", s().rows.length === 0);
ok("switching entity shows `loading`, not `refreshing`", s().loading === true);
await toB;
ok("the new entity's data lands", s().rows[0] === "B-row");

// The bug this exists for: a slow request for A resolving AFTER a later request for B
// used to write A's data under B's id, permanently.
delay.A = 60;
delay.B = 0;
const slowA = s().fetch("A");
await sleep(5);
await s().fetch("B");
ok("the later entity wins while the earlier request is still open", s().rows[0] === "B-row");
await slowA;
ok("a stale response does NOT overwrite the current entity", s().rows[0] === "B-row");
ok("...and dataKey still points at the current entity", s().dataKey === "B");
delay.A = 0;

await s().fetch("B");
serverFails = true;
await s().refetch();
ok("a failed refresh records the error", s().error === "server down");
ok("a failed refresh PRESERVES the data on screen", s().rows[0] === "B-row");
ok("a failed refresh clears both progress flags", s().loading === false && s().refreshing === false);
serverFails = false;
await s().refetch();
ok("a later success clears the error", s().error === null);

const useFiltered = createResourceStore({
  name: "verifyFiltered",
  filters: { status: "" },
  state: { rows: [] },
  load: async ({ filters }) => ({ rows: [filters.status] }),
});
await useFiltered.getState().fetch();
await useFiltered.getState().setFilter("status", "open");
ok("setFilter writes the nested filter and refetches", useFiltered.getState().rows[0] === "open");
ok("setFilter cannot create a stray top-level key", useFiltered.getState().status === undefined);

let otherLoads = 0;
const useOther = createResourceStore({
  name: "verifyOther",
  topics: ["invoices"],
  state: { n: 0 },
  load: async () => { otherLoads += 1; return { n: otherLoads }; },
});
await useOther.getState().fetch();
otherLoads = 0;
hits = [];
const writing = s().write({ invalidates: ["invoices"] });
ok("mutate raises `busy`", s().busy === true);
await writing;
ok("mutate clears `busy`", s().busy === false);
ok("mutate refetches its own store", hits.length === 1);
await sleep(10);
ok("an invalidated but UNMOUNTED store issues no request", otherLoads === 0);

resetAllStores();
ok("reset clears data", s().rows.length === 0);
ok("reset clears dataKey", s().dataKey === null);
ok("reset clears lastFetchedAt", s().lastFetchedAt === null);

/* ── report ─────────────────────────────────────────────────────────────────── */

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${pass} passed:\n` + failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
console.log(`✓ state layer: ${pass} checks passed`);
