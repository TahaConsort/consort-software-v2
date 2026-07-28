import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { isManagement, hasAnyRole } from "@/lib/roles";

/**
 * Gate a route subtree by role. Management (ceo/project_director/director/cfo/gm)
 * holds identical, full permissions (ADR-044), so it passes every gate. A
 * multi-role employee passes when ANY of their roles is allowed.
 */
export default function RoleGuard({ allowedRoles = [] }) {
  const user = useAuthStore((state) => state.user);

  if (!user) return <Navigate to="/login" replace />;

  if (isManagement(user)) return <Outlet />;

  if (!hasAnyRole(user, allowedRoles)) return <Navigate to="/admin" replace />;

  return <Outlet />;
}
