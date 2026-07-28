import { useEffect, useState, useCallback } from "react";
import { Users, UserPlus, Loader2, Power, RotateCcw, Copy, Pencil } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthStore } from "@/store/authStore";
import * as employeeService from "@/services/employeeService";
import { ASSIGNABLE_ROLE_OPTIONS, labelForRoles, hasAnyRole } from "@/lib/roles";
import DeleteUserModal from "./AdminComponents/DeleteUserModal";
import EditUserModal from "./AdminComponents/EditUserModal";

/**
 * Employees (CRM_MASTER §5.2, RULE-EMP). Admin/management sector only. List,
 * add (creates a login + activation token), and deactivate-and-reassign —
 * deactivation is blocked while the employee owns open work (RULE-EMP-02).
 */
const ManageUsersPage = () => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, depts] = await Promise.all([
        employeeService.listEmployees(),
        employeeService.listDepartments(),
      ]);
      setEmployees(emps.data ?? []);
      setDepartments(depts.data ?? []);
      setError(null);
    } catch (err) {
      setError(err?.message || "Failed to load employees");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reactivate = async (emp) => {
    setBusyId(emp.id);
    try {
      await employeeService.updateEmployee(emp.id, { reactivate: true });
      toast.success("Employee reactivated");
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not reactivate");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><Users className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-semibold leading-none">Employees</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{employees.length} record{employees.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        {hasPermission("employee.create") && (
          <Button size="sm" className="gap-2" onClick={() => setShowCreate(true)}><UserPlus className="w-4 h-4" /> Add employee</Button>
        )}
      </div>

      {error && <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">{error}</div>}
      {loading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}

      {!loading && !error && (
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm overflow-x-auto">
          {employees.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">No employees yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Department</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{e.fullName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{e.email}</td>
                    <td className="px-4 py-2.5">{labelForRoles(e)}</td>
                    <td className="px-4 py-2.5">{e.department?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {!e.isActive ? (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>
                      ) : e.activated ? (
                        <Badge variant="outline" className="text-[10px] border-green-400 text-green-700 dark:text-green-300">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-300">Pending activation</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {/* CEO is fully locked; everyone else (incl. CFO/GM/Director/
                          Project Director) can be edited/deactivated. */}
                      {e.isActive && hasPermission("employee.update") && !hasAnyRole(e, ["ceo"]) && e.userId !== currentUserId && (
                        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1"
                          onClick={() => setEditTarget(e)}>
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </Button>
                      )}
                      {e.isActive && hasPermission("employee.deactivate") && !hasAnyRole(e, ["ceo"]) && (
                        <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive gap-1"
                          onClick={() => setDeleteTarget(e)}>
                          <Power className="w-3.5 h-3.5" /> Deactivate
                        </Button>
                      )}
                      {!e.isActive && hasPermission("employee.update") && (
                        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" disabled={busyId === e.id}
                          onClick={() => reactivate(e)}>
                          {busyId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showCreate && (
        <CreateEmployeeDialog departments={departments} onClose={() => setShowCreate(false)} onCreated={load} />
      )}

      {editTarget && (
        <EditUserModal
          user={editTarget}
          employees={employees}
          onClose={() => setEditTarget(null)}
          onSuccess={load}
        />
      )}

      {/* Deactivate-and-reassign wizard (RULE-EMP-02) */}
      <DeleteUserModal
        user={deleteTarget}
        employees={employees}
        onClose={() => setDeleteTarget(null)}
        onSuccess={load}
      />
    </div>
  );
};

const CreateEmployeeDialog = ({ departments, onClose, onCreated }) => {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", roles: [], departmentId: "", designation: "" });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleRole = (code) =>
    setForm((f) => ({ ...f, roles: f.roles.includes(code) ? f.roles.filter((r) => r !== code) : [...f.roles, code] }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email || form.roles.length === 0 || !form.departmentId) {
      return toast.error("Name, email, at least one role and department are required");
    }
    setBusy(true);
    try {
      const res = await employeeService.createEmployee(form);
      toast.success("Employee created");
      await onCreated();
      // Show the activation link so the invitee can set their password.
      if (res?.activationLink) setLink(res.activationLink);
      else onClose();
    } catch (err) {
      toast.error(err?.message || "Could not create employee");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add employee</DialogTitle>
          <DialogDescription>Creates a login and an activation link the employee uses to set a password (RULE-EMP-01).</DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Share this activation link — the employee sets their password to activate:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted rounded-md p-2 break-all">{link}</code>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => { navigator.clipboard?.writeText(link); toast.success("Copied"); }}>
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="fn">First name</Label>
                <Input id="fn" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus /></div>
              <div className="space-y-1.5"><Label htmlFor="ln">Last name</Label>
                <Input id="ln" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="em">Email</Label>
              <Input id="em" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Roles <span className="text-xs font-normal text-muted-foreground">— pick one or more; permissions are the union</span></Label>
              <div className="grid grid-cols-2 gap-2 border rounded-lg p-3 max-h-44 overflow-y-auto">
                {ASSIGNABLE_ROLE_OPTIONS.map((r) => (
                  <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.roles.includes(r.value)} onCheckedChange={() => toggleRole(r.value)} />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5"><Label>Department</Label>
              <Select value={form.departmentId} onValueChange={(v) => set("departmentId", v)} items={departments.map((d) => ({ value: d.id, label: d.name }))}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="des">Designation (optional)</Label>
              <Input id="des" value={form.designation} onChange={(e) => set("designation", e.target.value)} /></div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ManageUsersPage;
