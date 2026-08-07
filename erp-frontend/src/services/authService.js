/**
 * authService.js
 * API surface for the Authentication & Access module (CRM_MASTER §5.1).
 * Uses the shared axios instance (withCredentials → sends the refresh cookie).
 */
import api from "@/lib/axios";

// POST /auth/login → { accessToken, user, permissions }
export const login = async (email, password) => {
  const res = await api.post("/auth/login", { email, password });
  return res.data;
};

// POST /auth/register — customer self-signup (§5.16/§5.20). Creates the
// company + contact + customer + portal login and signs the user straight in,
// so the response has the same shape as /login.
export const register = async (payload) => {
  const res = await api.post("/auth/register", payload);
  return res.data;
};

// POST /auth/refresh — rotates the refresh cookie, returns a fresh access token.
export const refresh = async () => {
  const res = await api.post("/auth/refresh");
  return res.data;
};

// GET /auth/me → current user + permissions
export const getMe = async () => {
  const res = await api.get("/auth/me");
  return res.data;
};

// POST /auth/logout — revoke this device's session
export const logout = async () => {
  const res = await api.post("/auth/logout");
  return res.data;
};

// POST /auth/activate — set password from an activation token
export const activate = async (token, password) => {
  const res = await api.post("/auth/activate", { token, password });
  return res.data;
};

// POST /auth/forgot-password — request a reset link
export const forgotPassword = async (email) => {
  const res = await api.post("/auth/forgot-password", { email });
  return res.data;
};

// POST /auth/reset-password — set a new password from a reset token
export const resetPassword = async (token, password) => {
  const res = await api.post("/auth/reset-password", { token, password });
  return res.data;
};
