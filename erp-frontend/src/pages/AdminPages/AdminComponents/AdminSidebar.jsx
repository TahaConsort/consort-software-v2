import React from "react";
import {
  X,
  LayoutDashboard,
  Settings,
  User,
  Users,
  Target,
  Handshake,
  CalendarClock,
  FileSearch,
  FileText,
  Ship,
  ListChecks,
  Receipt,
  MessagesSquare,
  Bell,
  Cpu,
  BarChart3,
  ShieldCheck,
  Lock,
  PhoneCall,
  Inbox,
  Landmark,
  Package,
  Truck,
  Workflow,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import AdminLogoutModal from "./AdminLogoutModal";
import { useAuthStore } from "@/store/authStore";
import { useNotificationStore } from "@/store/notificationStore";
import { isManagement, labelForRoles, hasAnyRole, INTERNAL_ROLES } from "@/lib/roles";

const NON_MGMT_INTERNAL = INTERNAL_ROLES.filter((r) => !isManagement(r));

const SHIPMENT_ROLES = ["asm", "bdo", "ops_manager", "ops_exec", "compliance_manager", "compliance_exec", "transport_manager", "transport_exec", "accounts"];
const REPORT_ROLES = ["hr", "asm", "bdo", "ops_manager", "compliance_manager", "transport_manager", "accounts"];

// Each item lists the roles that see it; Management sees everything (ADR-044).
const NAV_ITEMS = [
  { name: "Dashboard", icon: LayoutDashboard, path: "/admin", roles: NON_MGMT_INTERNAL },
  { name: "Employees", icon: Users, path: "/admin/users", roles: ["hr"] },
  { name: "Leads", icon: Target, path: "/admin/leads", roles: ["asm", "bdo"] },
  { name: "Outreach", icon: PhoneCall, path: "/admin/outreach", roles: ["asm", "bdo"] },
  { name: "Visit Plans", icon: CalendarClock, path: "/admin/visits", roles: ["asm", "bdo"] },
  { name: "Customers", icon: Handshake, path: "/admin/customers", roles: ["asm", "bdo"] },
  {
    name: "Queries",
    icon: FileSearch,
    path: "/admin/queries",
    roles: ["asm", "bdo", "ops_manager", "ops_exec", "compliance_manager", "compliance_exec"],
  },
  { name: "Inquiries", icon: Inbox, path: "/admin/inquiries", roles: ["asm", "bdo"] }, // direct channel (§5.20)
  { name: "LC Inbox", icon: Landmark, path: "/admin/lc-inbox", roles: ["ops_manager", "ops_exec"] }, // bank-LC (§5.21)
  { name: "Load Board", icon: Package, path: "/admin/loadboard", roles: ["ops_manager", "transport_manager"] }, // §5.20
  { name: "Quotations", icon: FileText, path: "/admin/quotations", roles: ["asm", "ops_manager", "ops_exec"] },
  { name: "Shipments", icon: Ship, path: "/admin/shipments", roles: SHIPMENT_ROLES },
  { name: "Tasks", icon: ListChecks, path: "/admin/tasks", roles: SHIPMENT_ROLES },
  { name: "Finance", icon: Receipt, path: "/admin/finance", roles: ["accounts"] },
  { name: "Vendors", icon: Truck, path: "/admin/vendors", roles: ["ops_manager", "ops_exec", "transport_manager", "compliance_manager", "accounts", "asm", "bdo"] },
  { name: "Chat", icon: MessagesSquare, path: "/admin/chat", roles: NON_MGMT_INTERNAL },
  { name: "Notifications", icon: Bell, path: "/admin/notifications", roles: NON_MGMT_INTERNAL, badge: "unread" },
  { name: "Security", icon: Lock, path: "/admin/security", roles: NON_MGMT_INTERNAL },
  { name: "Reports", icon: BarChart3, path: "/admin/reports", roles: REPORT_ROLES }, // report.read (§5.18)
  { name: "Action Engine", icon: Cpu, path: "/admin/action-engine", roles: [] }, // Management only (§5.12)
  { name: "Workflow", icon: Workflow, path: "/admin/workflow", roles: [] }, // Management only (ADR-051)
  { name: "Audit", icon: ShieldCheck, path: "/admin/audit", roles: [] }, // Management only (§5.19)
];

const AdminSidebar = ({ open, setOpen }) => {
  const admin = useAuthStore((state) => state.user);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  // No fetch or poll here: AdminLayout already mounts one, and this ran a SECOND 60s
  // interval against the same store — two requests a minute for one badge. `notification:new`
  // pushes live via RealtimeBridge, so reading the store's count is enough.

  const navItems = NAV_ITEMS.filter(
    (item) => isManagement(admin) || hasAnyRole(admin, item.roles),
  );

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed z-40 inset-y-0 left-0 w-64 bg-white dark:bg-zinc-900 border-r transform transition-transform duration-300
        ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <div className="flex flex-col h-full">
          {/* HEADER */}
          <div className="p-4 border-b relative">
            <div className="flex gap-2 items-center">
              <img src="/logo.png" alt="logo" className="w-9" />
              <p className="text-sm uppercase font-black">
                Consort <span className="text-primary">ERP</span>
              </p>
            </div>

            <button
              className="lg:hidden absolute right-4 top-4"
              onClick={() => setOpen(false)}
            >
              <X size={20} />
            </button>
          </div>

          {/* NAVIGATION */}
          <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1 scrollbar-thin">
            {navItems.map((item, i) => (
              <NavLink
                key={i}
                to={item.path}
                end={item.path === "/admin"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors
                  ${
                    isActive
                      ? "bg-primary text-white"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`
                }
                onClick={() => setOpen(false)}
              >
                <item.icon className="w-4 h-4" />
                <span className="flex-1">{item.name}</span>
                {item.badge === "unread" && unreadCount > 0 && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-[10px] font-semibold flex items-center justify-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* FOOTER */}
          <div className="border-t w-full p-3 space-y-2">
            {isManagement(admin) && (
              <NavLink
                to="/admin/settings"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors
      ${
        isActive
          ? "bg-primary text-white"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`
                }
                onClick={() => setOpen(false)}
              >
                <Settings className="w-4 h-4" />
                Settings
              </NavLink>
            )}

            {/* Logout */}
            <div onClick={() => setOpen(false)}>
              <AdminLogoutModal />
            </div>

            {/* Admin Info */}
            <div className="flex items-center gap-3 mt-3 p-3 rounded-md bg-muted/50">
              {/* Avatar */}
              <div className="w-9 h-9 flex items-center justify-center rounded-full bg-primary/10">
                <User className="w-4 h-4 text-primary" />
              </div>

              {/* Details */}
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-medium text-foreground truncate max-w-[140px]">
                  {admin?.email || "Signed in"}
                </span>

                <span className="text-[10px] uppercase tracking-wide text-primary font-medium">
                  {labelForRoles(admin)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default AdminSidebar;
