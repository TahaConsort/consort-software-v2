import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { friendlyError } from "@/lib/errorMessages";

/**
 * Centralized Axios instance (CRM_MASTER §5.1, ADR-009).
 *
 *   import api from "@/lib/axios";
 *   const res = await api.post("/auth/login", { email, password });
 *
 * Features:
 *   - Base URL from VITE_API_BASE_URL
 *   - Attaches the in-memory access token
 *   - withCredentials → sends/receives the HttpOnly refresh cookie
 *   - On 401, silently mints a fresh access token via POST /auth/refresh
 *     (single-flight; concurrent 401s share one refresh) and retries once
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000/api",
  timeout: 10_000,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

// Endpoints that must NOT trigger a refresh-retry (would loop). Public storefront
// calls (§5.20) are anonymous, so a stray 401 must not force-logout a visitor.
const NO_REFRESH = ["/auth/login", "/auth/refresh", "/auth/logout", "/auth/logout-all", "/public/"];

// ─── Request Interceptor ──────────────────────────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Silent-refresh plumbing ──────────────────────────────────────────────────
let refreshPromise = null;

const runRefresh = async () => {
  // Bare axios call so we don't recurse through this interceptor.
  const { data } = await axios.post(
    `${api.defaults.baseURL}/auth/refresh`,
    {},
    { withCredentials: true }
  );
  useAuthStore.getState().setAuth({
    user: data.user,
    accessToken: data.accessToken,
    permissions: data.permissions,
  });
  return data.accessToken;
};

const hardLogout = () => {
  useAuthStore.getState().logout();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
};

// ─── Response Interceptor ─────────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    const isAuthEndpoint = NO_REFRESH.some((p) => original?.url?.includes(p));

    if (status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      try {
        if (!refreshPromise) refreshPromise = runRefresh().finally(() => (refreshPromise = null));
        const newToken = await refreshPromise;
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original); // retry once with the fresh token
      } catch {
        hardLogout();
        return Promise.reject(error);
      }
    }

    if (status === 401 && !isAuthEndpoint) hardLogout();

    const raw =
      error.response?.data?.message ??
      error.response?.data?.detail ??
      error.message ??
      "";

    // `data` carries the response body through, so a caller can act on structured
    // detail instead of parsing prose. The optimistic-concurrency handlers use it: a
    // 412/428 returns the CURRENT rowVersion, which lets the client refetch and retry
    // once by itself rather than telling the user to reload the page.
    return Promise.reject({
      message: friendlyError(status, raw),
      rawMessage: raw,
      status,
      data: error.response?.data ?? null,
    });
  }
);

export default api;
