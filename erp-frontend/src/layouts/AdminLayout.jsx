import React, { useState, useEffect } from "react"
import { Menu, Sun, Moon, Bell } from "lucide-react"
import { Link } from "react-router-dom"
import AdminSidebar from "@/pages/AdminPages/AdminComponents/AdminSidebar"
import { Outlet } from "react-router-dom"
import { useTheme } from "@/context/ThemeContext"
import { useNotificationStore } from "@/store/notificationStore"

const AdminLayout = () => {
  const [open, setOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()

  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications)

  // The single owner of the notification read for the whole admin shell (AdminSidebar used
  // to run an identical interval against the same store). `notification:new` pushes live
  // via RealtimeBridge and the bus revalidates on focus and reconnect, so this interval is
  // just a slow floor for a badge nobody wants to miss.
  useEffect(() => {
    fetchNotifications()
    const t = setInterval(() => fetchNotifications({ background: true }), 60_000)
    return () => clearInterval(t)
  }, [fetchNotifications])

  return (
    <div className="h-screen flex overflow-hidden bg-muted/40">

      {/* Sidebar */}
      <AdminSidebar open={open} setOpen={setOpen} />

      {/* Main */}
      <div className="flex-1 flex flex-col lg:ml-64 h-full overflow-hidden">

        {/* Topbar */}
        <header className="h-14 flex items-center justify-between w-full px-4 border-b bg-white dark:bg-zinc-900">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOpen(true)}
              className="p-2 rounded-md hover:bg-muted transition lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <h2 className="text-sm font-medium">Admin Panel</h2>
          </div>

          <div className="flex items-center gap-1">
            {/* Notifications bell + unread count */}
            <Link
              to="/admin/notifications"
              className="relative p-2 rounded-md hover:bg-muted transition"
              title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : "Notifications"}
              aria-label="Notifications"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-semibold flex items-center justify-center leading-none">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md hover:bg-muted transition"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 pt-6 overflow-y-auto p-4">
          <Outlet />
        </main>

      </div>
    </div>
  )
}

export default AdminLayout
