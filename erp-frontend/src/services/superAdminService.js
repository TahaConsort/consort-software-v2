/**
 * adminService.js
 * Centralized API service for SUPER ADMIN CRUD operations.
 * All routes use `x-admin-secret` header for auth.
 */

import api from "@/lib/axios";

const SECRET_HEADER = (secretKey) => ({
  headers: { "x-admin-secret": secretKey },
});

/**
 * Get all super admins
 * GET /auth/super-admins
 */
export const getSuperAdmins = async (secretKey) => {
  const res = await api.get("/auth/super-admins", SECRET_HEADER(secretKey));
  return res.data;
};


/**
 * Update super admin
 * PUT /auth/super-admins/:id
 */
export const updateSuperAdmin = async (id, data, secretKey) => {
  const res = await api.put(
    `/auth/super-admins/${id}`,
    data,
    SECRET_HEADER(secretKey)
  );
  return res.data;
};

/**
 * Delete super admin
 * DELETE /auth/super-admins/:id
 */
export const deleteSuperAdmin = async (id, secretKey) => {
  const res = await api.delete(
    `/auth/super-admins/${id}`,
    SECRET_HEADER(secretKey)
  );
  return res.data;
};