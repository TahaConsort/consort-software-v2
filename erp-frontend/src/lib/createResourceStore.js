import { useEffect } from "react";
import { create } from "zustand";
// Relative, not "@/": lets scripts/verifyStateLayer.mjs exercise the state layer under
// plain node with no bundler.
import { clearAllStale, invalidate, matcherFor, registerSubscriber } from "./invalidationBus.js";

/**
 * Store factory — one contract for every store in the app.
 *
 * Written because 20 hand-rolled stores had drifted into 15 recurring defects, all
 * of which show up to the user as "reload the page":
 *
 *  · a background refetch flipped `loading`, so auto-refresh flashed a spinner over
 *    content that was already on screen;
 *  · filter setters fired `get().fetchX()` unawaited and unguarded, so a fast tab
 *    switch left the losing response on screen;
 *  · owner-scoped stores wrote the response unconditionally, so a slow request for
 *    shipment A landing after B put A's data under B's id PERMANENTLY;
 *  · mutations lived in pages, so only the acting page refreshed and every other
 *    screen showing the same data stayed wrong;
 *  · module singletons survived logout, so the next user saw the previous one's rows.
 *
 * The factory closes all of them at once, and `invalidates` on a mutation is what
 * replaces the reload.
 *
 * @param name        debug label, also the liveness key
 * @param topics      static topic strings this store owns (from `@/lib/topics`)
 * @param topicOf     (state) => string|string[] — extra topics that depend on the
 *                    current owner, e.g. `shipment:${get().shipmentId}`. Evaluated
 *                    at invalidation time, so no re-registration on owner change.
 * @param state       extra state fields and their initial values
 * @param filters     initial nested filter object; `setFilter` writes into it
 * @param refetchOnFilterChange  default true. Set false for a screen with an explicit
 *                    Apply button (the audit trail), where refetching per keystroke
 *                    across free-text and date inputs would be a request per character.
 * @param keyOf       (args, state) => string — identity of the data being loaded.
 *                    A change means a DIFFERENT entity, so `clearOnKeyChange`
 *                    fields are blanked before the request goes out.
 * @param clearOnKeyChange  fields (and their empty values) to blank on owner change
 * @param load        async ({ args, get, filters }) => state patch. Throwing sets
 *                    `error` and leaves existing data alone.
 * @param actions     ({ set, get, run, mutate }) => custom actions
 */
export const createResourceStore = ({
  name,
  topics = [],
  topicOf,
  state: extraState = {},
  filters: initialFilters,
  refetchOnFilterChange = true,
  keyOf = () => name,
  clearOnKeyChange = {},
  load,
  actions,
}) => {
  // Request bookkeeping lives OUTSIDE store state on purpose: the house pattern is
  // bare `useXStore()` whole-state subscription (23 call sites), so a sequence
  // counter in state would re-render every consumer on every fetch.
  let reqSeq = 0;
  let inflight = null; // { key, promise }
  let loadedKey = null;
  let lastArgs = [];
  let liveCount = 0;

  const BASE = {
    loading: false, // FIRST load for this key — the only flag that may show a spinner
    refreshing: false, // background refetch — must never blank or flicker the view
    busy: false, // a mutation is in flight
    error: null,
    lastFetchedAt: null,
    dataKey: null, // which entity the data in state belongs to
    ...(initialFilters ? { filters: { ...initialFilters } } : {}),
    ...extraState,
  };

  const useBase = create((set, get) => {
    /**
     * Read. Concurrent identical requests share one promise; a response is dropped
     * if a newer request has started (the guard that makes auto-refresh safe).
     *
     * @param background keep current data visible; sets `refreshing`, not `loading`
     * @param ifAbsent   no-op if this exact key already settled (lets a parent fetch
     *                   first and a child skip the duplicate)
     */
    const run = async (args = [], { background = false, ifAbsent = false } = {}) => {
      const key = keyOf(args, get());
      if (key == null) return; // not enough arguments yet (no owner selected)
      if (inflight?.key === key) return inflight.promise;
      if (ifAbsent && loadedKey === key) return;

      lastArgs = args;
      const seq = ++reqSeq;
      const keyChanged = get().dataKey !== null && get().dataKey !== key;

      set({
        error: null,
        dataKey: key,
        // A different entity must not show the previous one's rows for even one
        // frame, and must never adopt a late response from the old one.
        ...(keyChanged ? clearOnKeyChange : {}),
        loading: keyChanged || (!background && get().lastFetchedAt === null),
        refreshing: background && !keyChanged,
      });

      const promise = (async () => {
        try {
          const patch = await load({ args, get, filters: get().filters });
          if (reqSeq !== seq) return; // a newer request won
          set({ ...patch, loading: false, refreshing: false, error: null, lastFetchedAt: Date.now() });
          loadedKey = key;
        } catch (err) {
          if (reqSeq !== seq) return;
          // Keep whatever is on screen; surface the failure alongside it. Blanking
          // the view on a transient error is what made people reload.
          set({ loading: false, refreshing: false, error: err?.message || `Failed to load ${name}` });
        }
      })().finally(() => {
        if (inflight?.promise === promise) inflight = null;
      });

      inflight = { key, promise };
      return promise;
    };

    /**
     * Write. Sets `busy`, optionally patches state straight from the response (most
     * endpoints return the full updated aggregate), refetches, then publishes the
     * topics that make every OTHER affected screen re-read. Rethrows so the caller
     * still owns the toast.
     *
     * @param invalidates topics dirtied by this write — the replacement for a reload
     * @param patch       (res, get) => state patch, when the response is authoritative
     * @param refetch     false to rely on `patch` alone
     */
    const mutate = async (fn, { invalidates = [], patch, refetch = true } = {}) => {
      set({ busy: true });
      try {
        const res = await fn();
        if (patch) set({ ...patch(res, get), error: null });
        // Refetch before publishing, so a screen woken by our topics reads a server
        // that already reflects this write.
        if (refetch) await run(lastArgs, { background: true });
        if (invalidates.length) invalidate(...invalidates);
        return res;
      } finally {
        set({ busy: false });
      }
    };

    return {
      ...BASE,

      /**
       * Read. Arguments are passed through to `load` verbatim; a trailing plain
       * object is ALSO read for our own `background` / `ifAbsent` flags. Sharing one
       * object means a caller can write
       * `fetch("shipment", id, { withRequired: true, ifAbsent: true })`
       * without the factory having to guess which keys belong to whom.
       */
      fetch: (...args) => {
        const last = args[args.length - 1];
        const opts = last && typeof last === "object" && !Array.isArray(last) ? last : {};
        return run(args, opts);
      },

      /** Background re-read of whatever is currently loaded. */
      refetch: (opts = {}) => run(lastArgs, { background: true, ...opts }),

      /**
       * Set one filter and re-read. Refetches by default — the seven stores that did and
       * the two that didn't were a 50/50 coin flip for anyone wiring a new screen. Writes
       * into the nested `filters` object, so a typo can no longer overwrite an arbitrary
       * top-level state field.
       */
      setFilter: (key, value) => {
        set({ filters: { ...get().filters, [key]: value } });
        if (!refetchOnFilterChange) return undefined;
        return run(lastArgs, { background: get().lastFetchedAt !== null });
      },

      /** Publish topics without a write of our own (for cross-store nudges). */
      invalidate,

      reset: () => {
        reqSeq++; // orphan any in-flight response
        inflight = null;
        loadedKey = null;
        lastArgs = [];
        set({ ...BASE });
      },

      ...(actions?.({ set, get, run, mutate }) ?? {}),
    };
  });

  // ── Liveness: wrap the hook so pages keep calling useXStore() unchanged ────────
  // "use no memo": these hooks are minted per-store inside this factory and close over
  // `liveCount` / `subscription` / `useBase`, which live in the factory's scope, not the
  // module's. React Compiler outlines the dependency-free effect callback to module
  // scope, where those bindings do not exist — "liveCount is not defined" on first
  // mount. Nothing here re-renders, so there is nothing for the compiler to win.
  const useLiveness = () => {
    "use no memo";
    useEffect(() => {
      liveCount += 1;
      // Opened after someone else's change arrived while we were unmounted — read
      // fresh instead of showing what was true when the tab was last looked at.
      if (subscription.isStale()) {
        subscription.clearStale();
        if (useBase.getState().lastFetchedAt !== null) useBase.getState().refetch();
      }
      return () => {
        liveCount -= 1;
      };
    }, []);
  };

  const useStore = (selector) => {
    "use no memo";
    useLiveness();
    return useBase(selector);
  };
  // Preserve getState/setState/subscribe/getInitialState so non-React callers and
  // `useXStore.getState()` keep working exactly as before.
  Object.assign(useStore, useBase);

  const subscription = registerSubscriber({
    matches: matcherFor(() => {
      const dynamic = topicOf?.(useBase.getState());
      return [...topics, ...(Array.isArray(dynamic) ? dynamic : dynamic ? [dynamic] : [])];
    }),
    // Never a foreground load: this fires under the user with content on screen.
    refetch: () => useBase.getState().refetch(),
    isLive: () => liveCount > 0,
  });

  registerResettable(() => useBase.getState().reset());

  return useStore;
};

/* ── Session reset ────────────────────────────────────────────────────────────── */

const resettables = new Set();

/** Every factory-built store registers itself, so there is no list to maintain. */
const registerResettable = (reset) => resettables.add(reset);

/**
 * Wipe every store. Called on logout and on a `setAuth` that changes identity —
 * without it the module singletons keep the previous session's leads, customers,
 * invoices and documents, which is both a stale-data trap and a cross-account leak
 * whose only cure was a browser reload.
 */
export const resetAllStores = () => {
  for (const reset of resettables) {
    try {
      reset();
    } catch {
      // A store that fails to reset must not block the rest of logout.
    }
  }
  // Stale flags describe the previous session's data; carrying them over would make
  // the next user's first mount refetch for reasons that no longer exist.
  clearAllStale();
};
