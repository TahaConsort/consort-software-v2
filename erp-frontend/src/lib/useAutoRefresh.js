import { useCallback, useEffect, useRef } from "react";

/**
 * Coalesce refetches and make stale responses harmless, for pages that keep their
 * own state rather than a store.
 *
 *   run()      — awaited. Concurrent calls share ONE in-flight request; a call made
 *                mid-flight schedules exactly one trailing rerun. Use after a mutation.
 *   schedule() — fire-and-forget with a short trailing debounce. Use for socket hints:
 *                the relay emits `shipment:stepCompleted` AND `shipment:updated` for a
 *                single completion, so both land inside the window and produce ONE load.
 *
 * `loader` receives `{ isCurrent }` and MUST gate every setState on it — that is the
 * stale guard. An older response can then never overwrite a newer one, and a response
 * arriving after unmount is dropped instead of warning. Pass a useCallback-stable loader.
 *
 * CRITICAL: debounce socket hints only. A post-mutation refetch must stay `run()`-awaited
 * and immediate — debouncing it lets the user act again while the refresh is still
 * pending and submit a stale `rowVersion`, turning a stale-UI bug into a 412.
 */
export const useAutoRefresh = (loader, { debounceMs = 300 } = {}) => {
  const alive = useRef(true);
  const seq = useRef(0);
  const pending = useRef(null);
  const trailing = useRef(false);
  const timer = useRef(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(async () => {
    if (pending.current) {
      trailing.current = true;
      return pending.current;
    }
    const mine = ++seq.current;
    const promise = (async () => {
      try {
        return await loader({ isCurrent: () => alive.current && seq.current === mine });
      } finally {
        pending.current = null;
        if (trailing.current && alive.current) {
          trailing.current = false;
          run();
        }
      }
    })();
    pending.current = promise;
    return promise;
  }, [loader]);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (alive.current) run();
    }, debounceMs);
  }, [run, debounceMs]);

  return { run, schedule };
};
