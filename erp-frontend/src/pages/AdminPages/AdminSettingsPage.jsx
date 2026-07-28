import React, { useState, useCallback } from "react";
import {
  ShieldCheck,
  KeyRound,
  Pencil,
  Trash2,
  RefreshCw,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import toast from "react-hot-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/store/authStore";
import {
  deleteSuperAdmin,
  getSuperAdmins,
  updateSuperAdmin,
} from "@/services/superAdminService";

const AdminSettingsPage = () => {
  const { theme, toggleTheme } = useTheme();

  // Admin Panel State
  const [secretKeyInput, setSecretKeyInput] = useState("");
  const [unlockedKey, setUnlockedKey] = useState(null);

  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(false);

  // Modals state
  const [editAdmin, setEditAdmin] = useState(null); // admin obj

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [editLoading, setEditLoading] = useState(false);

  // Fetch admins
  const fetchAdmins = useCallback(async (key) => {
    setLoading(true);
    try {
      const res = await getSuperAdmins(key);
      if (res.success) {
        setAdmins(res.data);
        setUnlockedKey(key);
        toast.success("Admin list fetched successfully");
      } else {
        toast.error(res.message || "Failed to fetch admins");
        setUnlockedKey(null);
      }
    } catch (err) {
      toast.error(
        err?.response?.data?.message || err.message || "Invalid secret key",
      );
      setUnlockedKey(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUnlock = (e) => {
    e.preventDefault();
    if (!secretKeyInput.trim()) {
      toast.error("Please enter the secret key");
      return;
    }
    fetchAdmins(secretKeyInput);
  };

  // ─── Edit Handlers ──────────────────────────────────────────
  const openEditModal = (admin) => {
    setEditAdmin(admin);
    setEditForm({ name: admin.name, email: admin.email, password: "" });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditLoading(true);
    try {
      const payload = {
        name: editForm.name,
        email: editForm.email,
      };

      if (editForm.password) {
        payload.password = editForm.password;
      }

      const res = await updateSuperAdmin(editAdmin.id, payload, unlockedKey);
      if (res.success) {
        setEditAdmin(null);
        fetchAdmins(unlockedKey);
        //   Save user and token in Zustand store
        useAuthStore.getState().setAuth({ user: res.data, accessToken: res?.token });
      } else {
        toast.error(res.message || "Failed to update admin");
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update admin");
    } finally {
      setEditLoading(false);
    }
  };



  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage system preferences and high-level administrator accounts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* PANEL B: Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Appearance</CardTitle>
            <CardDescription>
              Customize how the application looks on your device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between ">
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-full bg-primary/10 text-primary">
                  {theme === "dark" ? <Moon size={20} /> : <Sun size={20} />}
                </div>
                <div>
                  <h4 className="font-medium text-sm">Theme Mode</h4>
                  <p className="text-xs text-muted-foreground">
                    Currently set to {theme} mode
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={toggleTheme}>
                Switch to {theme === "dark" ? "Light" : "Dark"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PANEL A: Admin Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Administrator Accounts</CardTitle>
          </div>
          <CardDescription>
            View and manage global administrators. This section requires the
            master secret key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!unlockedKey ? (
            <form onSubmit={handleUnlock} className="flex gap-3 max-w-md">
              <div className="relative flex-1">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder="Enter Master Secret Key..."
                  className="pl-9"
                  value={secretKeyInput}
                  onChange={(e) => setSecretKeyInput(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "Unlocking..." : "Unlock"}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Badge
                  variant="outline"
                  className="border-primary/50 text-primary bg-primary/5"
                >
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  Unlocked
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchAdmins(unlockedKey)}
                  className="gap-2 text-muted-foreground"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </Button>
              </div>

              <div className="border rounded-xl overflow-x-auto bg-white dark:bg-zinc-900 shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left border-b">
                    <tr>
                      <th className="p-3 font-semibold text-muted-foreground">
                        #
                      </th>
                      <th className="p-3 font-semibold text-muted-foreground">
                        Name
                      </th>
                      <th className="p-3 font-semibold text-muted-foreground hidden sm:table-cell">
                        Email
                      </th>
                      <th className="p-3 font-semibold text-muted-foreground">
                        Role
                      </th>
                      <th className="p-3 font-semibold text-muted-foreground text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && admins.length === 0 ? (
                      <tr>
                        <td
                          colSpan="5"
                          className="p-4 text-center text-muted-foreground"
                        >
                          Loading admins...
                        </td>
                      </tr>
                    ) : admins.length === 0 ? (
                      <tr>
                        <td
                          colSpan="5"
                          className="p-4 text-center text-muted-foreground"
                        >
                          No administrators found
                        </td>
                      </tr>
                    ) : (
                      admins.map((admin, i) => (
                        <tr
                          key={admin.id}
                          className="border-t hover:bg-muted/30 transition-colors group"
                        >
                          <td className="p-3 text-muted-foreground text-xs">
                            {i + 1}
                          </td>
                          <td className="p-3 font-medium">{admin.name}</td>
                          <td className="p-3 text-muted-foreground hidden sm:table-cell">
                            {admin.email}
                          </td>
                          <td className="p-3">
                            <Badge variant="default" className="text-xs">
                              SUPER ADMIN
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2.5 text-xs gap-1.5 hover:bg-primary/10 hover:text-primary"
                                onClick={() => openEditModal(admin)}
                              >
                                Edit
                              </Button>
                          
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Admin Modal */}
      <Dialog
        open={!!editAdmin}
        onOpenChange={(val) => {
          if (!val && !editLoading) setEditAdmin(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              Edit Administrator
            </DialogTitle>
            <DialogDescription>
              Update details for {editAdmin?.name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                required
                value={editForm.name}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, name: e.target.value }))
                }
                disabled={editLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                required
                type="email"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, email: e.target.value }))
                }
                disabled={editLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                placeholder="Leave blank to keep unchanged"
                value={editForm.password}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, password: e.target.value }))
                }
                disabled={editLoading}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditAdmin(null)}
                disabled={editLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={editLoading}>
                {editLoading ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>


    </div>
  );
};

export default AdminSettingsPage;
