import { invalidate, revalidateAll } from "./invalidationBus.js";
import { onSocket } from "./socket.js";

/**
 * The three ways the app learns it is out of date, wired in one place and mounted
 * once by RealtimeBridge. Between them they replace the manual reload:
 *
 *  1. PUSH — `data:changed` carries only a topic list (ADR-007: events are hints,
 *     never state), so it is safe on role/department rooms. The relay emits it for
 *     every dispatched outbox event, ~3s behind the write.
 *  2. RECONNECT — socket.io re-joins rooms automatically, but anything emitted while
 *     we were disconnected is GONE. So a reconnect means "you missed something,
 *     but not what" → revalidate everything live.
 *  3. FOCUS / VISIBILITY — a tab left open behind another window misses nothing over
 *     the socket, but a laptop that slept does. Cheap insurance, throttled so
 *     alt-tabbing doesn't become a traffic generator.
 *
 * Deliberately no interval polling: sockets are installed and working, and per-tab
 * background traffic is exactly what a 3s-latency push already covers.
 */

const FOCUS_THROTTLE_MS = 10_000;
let lastRevalidatedAt = 0;

const revalidateThrottled = (reason) => {
  const now = Date.now();
  if (now - lastRevalidatedAt < FOCUS_THROTTLE_MS) return;
  lastRevalidatedAt = now;
  if (import.meta.env.DEV) console.debug(`[revalidate] ${reason}`);
  revalidateAll();
};

/** Wire every revalidation source. Returns a teardown fn. */
export const startRevalidation = () => {
  const offs = [
    // The generic fan-out: one event name for the whole app.
    onSocket("data:changed", (payload) => {
      const topics = payload?.topics;
      if (Array.isArray(topics) && topics.length) invalidate(...topics);
    }),
    // socket.io fires `connect` on the first connection too — harmless, the very
    // first one finds nothing live yet or refetches data that just loaded.
    onSocket("connect", () => revalidateThrottled("socket reconnect")),
  ];

  const onFocus = () => revalidateThrottled("window focus");
  const onVisible = () => {
    if (document.visibilityState === "visible") revalidateThrottled("tab visible");
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    offs.forEach((off) => off());
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
  };
};
