/**
 * userService.js
 * Centralized API service for all user CRUD operations.
 * Uses the shared axios instance which auto-attaches the Authorization header.
 */
import api from "@/lib/axios";

/**
 * Fetch all users (admin only).
 * GET /auth/users
 * @returns {Promise<Array>} Array of user objects
 */
export const getAllUsers = async () => {
  const res = await api.get("/auth/users");
  return res.data; // { success, message, data: [...] }
};


/**
 * Create a new user (admin only).
 * POST /auth/register-user
 * @param {{ name: string, email: string, password: string, role?: string }} data
 * @returns {Promise<Object>} Created user object
 */
export const createUser = async (data) => {
  const res = await api.post("/auth/register-user", data);
  return res.data;
};

/**
 * Update an existing user (admin only).
 * PUT /auth/users/:id
 * @param {number|string} id
 * @param {{ name?: string, email?: string, role?: string, isActive?: boolean, password?: string }} data
 * @returns {Promise<Object>} Updated user object
 */
export const updateUser = async (id, data) => {
  const res = await api.put(`/auth/users/${id}`, data);
  return res.data;
};

/**
 * Delete a user (admin only).
 * DELETE /auth/users/:id
 * @param {number|string} id
 * @returns {Promise<void>}
 */
export const deleteUser = async (id) => {
  const res = await api.delete(`/auth/users/${id}`);
  return res.data;
};
