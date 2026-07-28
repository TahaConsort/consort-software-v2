import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Auth store (CRM_MASTER §5.1, ADR-009).
 *
 * The access token is kept in MEMORY only — never persisted — so a stolen
 * localStorage payload can't be replayed. On reload the token is gone and the
 * axios layer silently re-mints it from the HttpOnly refresh cookie via
 * POST /auth/refresh. `user` + `permissions` persist so guards render instantly.
 */
export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null, // access token — memory only
      permissions: [],
      isAuthenticated: false,

      // Full login / refresh result.
      setAuth: ({ user, accessToken, permissions }) =>
        set({
          user: user ?? get().user,
          token: accessToken ?? null,
          permissions: permissions ?? get().permissions,
          isAuthenticated: true,
        }),

      // Rotate just the access token (silent refresh).
      setToken: (accessToken) => set({ token: accessToken }),

      logout: () =>
        set({ user: null, token: null, permissions: [], isAuthenticated: false }),

      hasPermission: (perm) => get().permissions?.includes(perm) ?? false,

      // Multi-role helpers. `roles` is the full set; falls back to the primary
      // `role` for any legacy session persisted before roles existed.
      rolesOf: () => {
        const u = get().user;
        return u?.roles?.length ? u.roles : u?.role ? [u.role] : [];
      },
      hasRole: (...roles) => get().rolesOf().some((r) => roles.includes(r)),
    }),
    {
      name: "auth-storage",
      // Persist identity, NOT the access token (ADR-009).
      partialize: (state) => ({
        user: state.user,
        permissions: state.permissions,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
