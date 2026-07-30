// Sibling modules are imported relatively (not via "@/") so the state layer can be
// exercised by scripts/verifyStateLayer.mjs under plain node, with no bundler.
import { topicMatches } from "./topics.js";

/**
 * Invalidation bus — the one place that answers "something changed, who re-reads?".
 *
 * Stores register a subscriber; anything that mutates server state calls
 * `invalidate(...topics)`. Three rules make this cheap enough to fire on every
 * mutation:
 *
 *  1. LIVENESS. A subscriber with no mounted consumer is NOT refetched — it is
 *     flagged stale and re-reads on its next mount. Without this, one quotation
 *     approval (which dirties six topics) fires six requests into screens nobody
 *     is looking at, and it gets worse the longer a session runs. This is the SWR
 *     model, hand-rolled — no new dependency.
 *  2. COALESCING. Repeated invalidations inside one tick collapse into a single
 *     refetch per subscriber, so a mutation dirtying both `shipments` and
 *     `shipment:abc` doesn't refetch the detail store twice.
 *  3. PREDICATE MATCHING. A subscriber supplies `matches(changed)` rather than a
 *     fixed string, evaluated at invalidation time. An entity-scoped store
 *     (`shipment:abc`) therefore needs no re-registration when its owner changes.
 *
 * Deliberately not a React context: mutations fire from stores and socket
 * handlers with no component to hang a context off, and the registry must outlive
 * any particular tree.
 */

/** Set<{ matches, refetch, isLive, stale }> */
const subscribers = new Set();
/** subscribers scheduled to refetch this tick */
const queued = new Set();
let flushing = false;

const flush = () => {
  flushing = false;
  const batch = [...queued];
  queued.clear();
  for (const entry of batch) {
    // A rejecting refetch must not take the rest of the batch with it — the store
    // has already recorded the failure in its own `error`.
    Promise.resolve().then(entry.refetch).catch(() => {});
  }
};

const schedule = () => {
  if (queued.size && !flushing) {
    flushing = true;
    queueMicrotask(flush);
  }
};

/**
 * Register a subscriber.
 *
 * @param matches  (changedTopic) => boolean. Evaluated at invalidation time, so it
 *                 may read the store's current owner.
 * @param refetch  () => Promise<void>. MUST be a BACKGROUND refetch — it fires
 *                 under the user with content already on screen, so it must not
 *                 flip `loading` or blank the list.
 * @param isLive   () => boolean. False when no component is mounted.
 * @returns handle with `unregister()`, `isStale()`, `clearStale()`
 */
export const registerSubscriber = ({ matches, refetch, isLive }) => {
  const entry = { matches, refetch, isLive, stale: false };
  subscribers.add(entry);
  return {
    unregister: () => subscribers.delete(entry),
    isStale: () => entry.stale,
    clearStale: () => {
      entry.stale = false;
    },
    markStale: () => {
      entry.stale = true;
    },
  };
};

/**
 * Mark topics changed. Live subscribers refetch on the next microtask; the rest
 * are flagged stale. Safe to call with no arguments, duplicates, arrays, or
 * topics nobody owns.
 */
export const invalidate = (...topics) => {
  const changed = topics.flat().filter(Boolean);
  if (!changed.length) return;

  for (const entry of subscribers) {
    if (!changed.some((c) => entry.matches(c))) continue;
    if (entry.isLive()) queued.add(entry);
    else entry.stale = true;
  }
  schedule();
};

/**
 * Refetch every live subscriber regardless of topic, and flag the rest stale. For
 * the two cases where we know we missed events but not which: socket reconnect
 * (anything emitted while disconnected is gone) and the tab regaining focus.
 */
export const revalidateAll = () => {
  for (const entry of subscribers) {
    if (entry.isLive()) queued.add(entry);
    else entry.stale = true;
  }
  schedule();
};

/** Drop every stale flag. Called on logout, alongside resetAllStores(). */
export const clearAllStale = () => {
  for (const entry of subscribers) entry.stale = false;
};

/** Build a `matches` predicate from a function returning the store's current topics. */
export const matcherFor = (currentTopics) => (changed) =>
  currentTopics().some((topic) => topicMatches(topic, changed));

/** Debug introspection for the browser console — not used by app code. */
export const __busState = () => ({
  total: subscribers.size,
  live: [...subscribers].filter((e) => e.isLive()).length,
  stale: [...subscribers].filter((e) => e.stale).length,
});
