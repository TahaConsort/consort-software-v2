import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateEmployee, listDepartments } from "@/services/employeeService";
import { ASSIGNABLE_ROLE_OPTIONS, labelForRoles, isManagement } from "@/lib/roles";
import toast from "react-hot-toast";
import { Pencil, Loader2 } from "lucide-react";

/**
 * EditUserModal — edit an Employee's details (name, department, designation,
 * phone, reporting manager) and, for NON-management employees, their roles.
 *
 * A Management employee (CFO/GM/Director/Project Director) is editable here for
 * DETAILS ONLY — the roles section is hidden and no `roles` field is sent, so the
 * backend's "a Management account can't be re-roled" guard is never triggered.
 * The CEO is not editable at all (the row hides the action).
 *
 * Props: user (employee) | null, onClose(), onSuccess(), employees[] (managers).
 */
const EditUserModal = ({ user, onClose, onSuccess, employees = [] }) => {
  const [form, setForm] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);

  // Whether the roles section is shown / sent. Management → details only.
  const editableRoles = user ? !isManagement(user) : false;

  useEffect(() => {
    if (!user) return setForm(null);
    setForm({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      roles: user.roles?.length ? user.roles : user.role ? [user.role] : [],
      departmentId: user.departmentId ?? "",
      designation: user.designation ?? "",
      phone: user.phone ?? "",
      managerId: user.managerId ?? "",
    });
    listDepartments()
      .then((res) => setDepartments(res.data ?? []))
      .catch(() => toast.error("Failed to load departments"));
  }, [user]);

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  const toggleRole = (code) =>
    setForm((p) => ({ ...p, roles: p.roles.includes(code) ? p.roles.filter((r) => r !== code) : [...p.roles, code] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form) return;
    if (!form.departmentId) return toast.error("A department is required");
    if (editableRoles && form.roles.length === 0) return toast.error("At least one role is required");

    setLoading(true);
    try {
      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        departmentId: form.departmentId,
        designation: form.designation,
        phone: form.phone,
        managerId: form.managerId || null,
        // Roles are sent ONLY for non-management employees.
        ...(editableRoles ? { roles: form.roles } : {}),
      };
      await updateEmployee(user.id, payload);
      toast.success("Employee updated");
      onSuccess?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || "Failed to update employee");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (val) => {
    if (!val && !loading) onClose?.();
  };

  return (
    <Dialog open={!!user} onOpenChange={handleOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" />
            Edit Employee
          </DialogTitle>
          <DialogDescription>
            {user?.email}
            {!editableRoles && " — Management account: details only, roles are fixed."}
          </DialogDescription>
        </DialogHeader>

        {form && (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-firstName">First Name</Label>
                <Input id="edit-firstName" name="firstName" value={form.firstName} onChange={handleChange} disabled={loading} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-lastName">Last Name</Label>
                <Input id="edit-lastName" name="lastName" value={form.lastName} onChange={handleChange} disabled={loading} />
              </div>
            </div>

            {/* Roles — non-management only (RULE-EMP: management is not re-roled here). */}
            {editableRoles && (
              <div className="space-y-1.5">
                <Label>Roles <span className="text-xs font-normal text-muted-foreground">— pick one or more; permissions are the union</span></Label>
                <div className="grid grid-cols-2 gap-2 border rounded-lg p-3 max-h-44 overflow-y-auto">
                  {ASSIGNABLE_ROLE_OPTIONS.map((r) => (
                    <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={form.roles.includes(r.value)} onCheckedChange={() => toggleRole(r.value)} disabled={loading} />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-dept">Department</Label>
                <Select value={form.departmentId} onValueChange={(v) => setForm((p) => ({ ...p, departmentId: v }))} disabled={loading} items={departments.map((d) => ({ value: d.id, label: d.name }))}>
                  <SelectTrigger id="edit-dept">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-designation">Designation</Label>
                <Input id="edit-designation" name="designation" value={form.designation} onChange={handleChange} disabled={loading} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input id="edit-phone" name="phone" value={form.phone} onChange={handleChange} disabled={loading} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-manager">Reporting Manager</Label>
                <Select value={form.managerId || "none"} onValueChange={(v) => setForm((p) => ({ ...p, managerId: v === "none" ? "" : v }))} disabled={loading} items={[{ value: "none", label: "None" }, ...employees.filter((e) => e.isActive && e.id !== user?.id).map((e) => ({ value: e.id, label: `${e.fullName} — ${labelForRoles(e)}` }))]}>
                  <SelectTrigger id="edit-manager">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {employees.filter((e) => e.isActive && e.id !== user?.id).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.fullName} — {labelForRoles(e)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onClose?.()} disabled={loading}>Cancel</Button>
              <Button type="submit" disabled={loading} className="gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EditUserModal;
