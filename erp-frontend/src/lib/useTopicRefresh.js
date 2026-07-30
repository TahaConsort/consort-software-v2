import { useEffect, useMemo } from "react";
import { registerSubscriber } from "./invalidationBus.js";
import { topicMatches } from "./topics.js";
import { useAutoRefresh } from "./useAutoRefresh.js";

/**
 * Subscribe a PAGE to invalidation topics.
 *
 * The factory covers stores, but a few screens legitimately keep their own state — a
 * detail page with exactly one consumer, or a triage inbox with a local filter — and
 * those were the screens with no live path at all. The LC inbox and the storefront
 * inquiry inbox were the worst of it: inbound work that only ever appeared on a manual
 * reload, on pages whose entire purpose is to show newly arrived work.
 *
 * Registered only while mounted, so `isLive` is trivially true and there is no stale
 * bookkeeping: an unmounted page simply refetches on its next mount.
 *
 * @param topics  topic strings (from `@/lib/topics`) that should refresh this page
 * @param loader  a useCallback-stable ({ isCurrent }) => Promise. MUST gate every
 *                setState on `isCurrent()` — that is the stale-response guard.
 * @returns { run, schedule } — `run` awaited for post-mutation refreshes, `schedule`
 *          debounced for pushes. See useAutoRefresh for why the distinction matters.
 */
export const useTopicRefresh = (topics, loader, { debounceMs = 300 } = {}) => {
  const { run, schedule } = useAutoRefresh(loader, { debounceMs });
  // Callers pass an inline array; key on the contents so the effect doesn't re-register
  // on every render.
  const key = Array.isArray(topics) ? topics.join("|") : String(topics ?? "");
  const list = useMemo(() => key.split("|").filter(Boolean), [key]);

  useEffect(() => {
    const handle = registerSubscriber({
      matches: (changed) => list.some((topic) => topicMatches(topic, changed)),
      // Debounced: the relay can emit several topics for one write, and a page-wide
      // reload for each of them would be visible churn.
      refetch: async () => schedule(),
      isLive: () => true,
    });
    return handle.unregister;
  }, [list, schedule]);

  return { run, schedule };
};
