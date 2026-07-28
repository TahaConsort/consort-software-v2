import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

// Core Components
import { ErrorBoundary } from "./components/ErrorBoundary";
import AuthGuard from "./components/guards/AuthGuard";
import GuestGuard from "./components/guards/GuestGuard";
import RoleGuard from "./components/guards/RoleGuard";
import RealtimeBridge from "./components/RealtimeBridge";

// Layouts
import AdminLayout from "./layouts/AdminLayout";

// Auth & Admin Pages
import LoginPage from "./pages/AuthPages/LoginPage";
import RegisterPage from "./pages/AuthPages/RegisterPage";
import ForgotPasswordPage from "./pages/AuthPages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/AuthPages/ResetPasswordPage";
import ActivateAccountPage from "./pages/AuthPages/ActivateAccountPage";
import DashboardHome from "./pages/AdminPages/DashboardHome";
import ManageUsersPage from "./pages/AdminPages/ManageUsersPage";
import AdminSettingsPage from "./pages/AdminPages/AdminSettingsPage";

// User Pages
import UserDashboardPage from "./pages/UserPages/UserDashboardPage";

// Feature Pages
import LeadsListPage from "./pages/LeadsPages/LeadsListPage";
import LeadDetailPage from "./pages/LeadsPages/LeadDetailPage";
import CustomersListPage from "./pages/CustomersPages/CustomersListPage";
import VisitsListPage from "./pages/VisitsPages/VisitsListPage";
import OutreachListPage from "./pages/OutreachPages/OutreachListPage";
import QueriesListPage from "./pages/QueriesPages/QueriesListPage";
import QuotationsListPage from "./pages/QuotationsPages/QuotationsListPage";
import ShipmentsListPage from "./pages/ShipmentsPages/ShipmentsListPage";
import ShipmentDetailPage from "./pages/ShipmentsPages/ShipmentDetailPage";
import TasksListPage from "./pages/TasksPages/TasksListPage";
import FinanceListPage from "./pages/FinancePages/FinanceListPage";
import VendorsListPage from "./pages/VendorsPages/VendorsListPage";
import ActionEngineListPage from "./pages/ActionEnginePages/ActionEngineListPage";
import ReportsListPage from "./pages/ReportsPages/ReportsListPage";
import AuditListPage from "./pages/AuditPages/AuditListPage";
import ChatPage from "./pages/ChatPages/ChatPage";
import NotificationsPage from "./pages/NotificationsPages/NotificationsPage";
import SecurityPage from "./pages/SecurityPages/SecurityPage";

// Public storefront + intake channels (§5.20/§5.21)
import StorefrontPage from "./pages/PublicPages/StorefrontPage";
import InquiriesListPage from "./pages/InquiryPages/InquiriesListPage";
import LcInboxPage from "./pages/LcPages/LcInboxPage";
import LoadBoardManagePage from "./pages/LoadBoardPages/LoadBoardManagePage";

// Role groups (Management passes every gate via RoleGuard, ADR-044).
const INTERNAL = ["hr", "asm", "bdo", "ops_manager", "ops_exec", "compliance_manager", "compliance_exec", "transport_manager", "transport_exec", "accounts"];
const SALES = ["asm", "bdo"];
const QUERY_ROLES = ["asm", "bdo", "ops_manager", "ops_exec", "compliance_manager", "compliance_exec"];
const QUOTATION_ROLES = ["asm", "ops_manager", "ops_exec"];
const SHIPMENT_ROLES = ["asm", "bdo", "ops_manager", "ops_exec", "compliance_manager", "compliance_exec", "transport_manager", "transport_exec", "accounts"];
const FINANCE_ROLES = ["accounts"]; // + Management via RoleGuard (ADR-044)
const REPORT_ROLES = ["hr", "asm", "bdo", "ops_manager", "compliance_manager", "transport_manager", "accounts"]; // report.read (§2.2)
const INQUIRY_ROLES = ["asm", "bdo"]; // direct-channel triage (§5.20)
const LC_ROLES = ["ops_manager", "ops_exec"]; // bank-LC inbox (§5.21)
const LOADBOARD_ROLES = ["ops_manager", "transport_manager"]; // load board management (§5.20)
const VENDOR_ROLES = ["ops_manager", "ops_exec", "transport_manager", "compliance_manager", "accounts", "asm", "bdo"]; // vendor.read (freight-forwarding OTC)

const App = () => {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <RealtimeBridge />
        <Routes>
          {/* Public storefront — anonymous front door, no auth (§5.20) */}
          <Route path="/" element={<StorefrontPage />} />

          {/* Guest / public auth routes */}
          <Route element={<GuestGuard />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/activate" element={<ActivateAccountPage />} />
          </Route>

          {/* Protected */}
          <Route element={<AuthGuard />}>
            {/* Customer portal */}
            <Route path="/dashboard" element={<UserDashboardPage />} />

            {/* Internal workspace — one layout, per-section role guards */}
            <Route path="/admin" element={<AdminLayout />}>
              {/* Dashboard, chat, notifications — every internal role */}
              <Route element={<RoleGuard allowedRoles={INTERNAL} />}>
                <Route index element={<DashboardHome />} />
                <Route path="chat" element={<ChatPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="security" element={<SecurityPage />} />
              </Route>

              {/* Employee management — HR + Management */}
              <Route element={<RoleGuard allowedRoles={["hr"]} />}>
                <Route path="users" element={<ManageUsersPage />} />
              </Route>

              {/* Reports — report.read roles + Management */}
              <Route element={<RoleGuard allowedRoles={REPORT_ROLES} />}>
                <Route path="reports" element={<ReportsListPage />} />
              </Route>

              {/* Management-only — settings + Action Engine (§5.12) + Audit (§5.19) */}
              <Route element={<RoleGuard allowedRoles={[]} />}>
                <Route path="settings" element={<AdminSettingsPage />} />
                <Route path="action-engine" element={<ActionEngineListPage />} />
                <Route path="audit" element={<AuditListPage />} />
              </Route>

              {/* Sales workspace */}
              <Route element={<RoleGuard allowedRoles={SALES} />}>
                <Route path="leads" element={<LeadsListPage />} />
                <Route path="leads/:id" element={<LeadDetailPage />} />
                <Route path="customers" element={<CustomersListPage />} />
                <Route path="visits" element={<VisitsListPage />} />
                <Route path="outreach" element={<OutreachListPage />} />
              </Route>

              {/* Queries — sales raise; Ops & Compliance read */}
              <Route element={<RoleGuard allowedRoles={QUERY_ROLES} />}>
                <Route path="queries" element={<QueriesListPage />} />
              </Route>

              {/* Intake channels (§5.20/§5.21) */}
              <Route element={<RoleGuard allowedRoles={INQUIRY_ROLES} />}>
                <Route path="inquiries" element={<InquiriesListPage />} />
              </Route>
              <Route element={<RoleGuard allowedRoles={LC_ROLES} />}>
                <Route path="lc-inbox" element={<LcInboxPage />} />
              </Route>
              <Route element={<RoleGuard allowedRoles={LOADBOARD_ROLES} />}>
                <Route path="loadboard" element={<LoadBoardManagePage />} />
              </Route>

              {/* Quotations — Ops drafts/sends; ASM approves */}
              <Route element={<RoleGuard allowedRoles={QUOTATION_ROLES} />}>
                <Route path="quotations" element={<QuotationsListPage />} />
              </Route>

              {/* Shipments & Tasks — Ops/Compliance/Transport/Finance + Sales */}
              <Route element={<RoleGuard allowedRoles={SHIPMENT_ROLES} />}>
                <Route path="shipments" element={<ShipmentsListPage />} />
                <Route path="shipments/:id" element={<ShipmentDetailPage />} />
                <Route path="tasks" element={<TasksListPage />} />
              </Route>

              {/* Finance — Accounts + Management */}
              <Route element={<RoleGuard allowedRoles={FINANCE_ROLES} />}>
                <Route path="finance" element={<FinanceListPage />} />
              </Route>

              {/* Vendors — Ops/Transport/Compliance/Finance/Sales + Management */}
              <Route element={<RoleGuard allowedRoles={VENDOR_ROLES} />}>
                <Route path="vendors" element={<VendorsListPage />} />
              </Route>
            </Route>
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <Toaster
          position="top-right"
          toastOptions={{
            className: "rounded-xl border shadow-lg px-4 py-3 text-sm font-medium flex items-center gap-2",
            duration: 4000,
            style: { background: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)", maxWidth: "480px" },
            success: { duration: 3000, iconTheme: { primary: "var(--primary)", secondary: "var(--primary-foreground)" } },
            error: { duration: 7000, iconTheme: { primary: "var(--destructive)", secondary: "var(--destructive-foreground)" } },
          }}
        />
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
