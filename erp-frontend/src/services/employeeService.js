/**
 * employeeService.js
 * API surface for the Employee Management module (CRM_MASTER §5.2, RULE-EMP).
 */
import api from "@/lib/axios";

// GET /employees → [{ id, fullName, email, role, department, isActive, activated, ... }]
export const listEmployees = async () => {
  const res = await api.get("/employees");
  return res.data;
};

// GET /employees/departments → [{ id, code, name }] (auto-seeded on first call)
export const listDepartments = async () => {
  const res = await api.get("/employees/departments");
  return res.data;
};

// POST /employees → create employee + login + activation token
export const createEmployee = async (payload) => {
  const res = await api.post("/employees", payload);
  return res.data; // { data, activationLink? }
};

// PUT /employees/:id → edit details / role / department / reactivate
export const updateEmployee = async (id, payload) => {
  const res = await api.put(`/employees/${id}`, payload);
  return res.data;
};

// GET /employees/:id/open-work → { leads, queries, quotations, tasks, total }
export const getOpenWork = async (id) => {
  const res = await api.get(`/employees/${id}/open-work`);
  return res.data;
};

// POST /employees/:id/reassign-work → move open work to another user
export const reassignWork = async (id, toUserId) => {
  const res = await api.post(`/employees/${id}/reassign-work`, { toUserId });
  return res.data;
};

// DELETE /employees/:id → deactivate-and-reassign (409 if open work remains)
export const deactivateEmployee = async (id) => {
  const res = await api.delete(`/employees/${id}`);
  return res.data;
};
