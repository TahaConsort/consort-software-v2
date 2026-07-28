import { Navigate, useLocation, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

export default function AuthGuard() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}