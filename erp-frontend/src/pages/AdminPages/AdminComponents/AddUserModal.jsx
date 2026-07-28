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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createEmployee, listDepartments } from "@/services/employeeService";
import { ROLE_OPTIONS, labelForRole } from "@/lib/roles";
import toast from "react-hot-toast";
import { UserPlus, Loader2, Copy } from "lucide-react";

const INITIAL_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  role: "bdo",
  departmentId: "",
  designation: "",
  phone: "",
  managerId: "",
};

/**
 * AddUserModal — create an Employee (+ login + activation link).
 * Props: onSuccess(), employees[] (for the optional reporting-manager select).
 */
const AddUserModal = ({ onSuccess, employees = [] }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [activationLink, setActivationLink] = useState(null);

  useEffect(() => {
    if (!open) return;
    listDepartments()
      .then((res) => setDepartments(res.data ?? []))
      .catch(() => toast.error("Failed to load departments"));
  }, [open]);

  const validate = () => {
    const e = {};
    if (!form.firstName.trim()) e.firstName = "First name is required";
    if (!form.lastName.trim()) e.lastName = "Last name is required";
    if (!form.email.trim()) e.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Invalid email";
    if (!form.departmentId) e.departmentId = "Department is required";
    return e;
  };

  const handleChange = (e) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
    setErrors((p) => ({ ...p, [e.target.name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) return setErrors(errs);

    setLoading(true);
    try {
      const payload = { ...form, managerId: form.managerId || undefined };
      const res = await createEmployee(payload);
      toast.success("Employee created");

      if (res.activationLink) {
        // Surface the activation link so the invitee can set a password.
        setActivationLink(res.activationLink);
      } else {
        closeAndReset();
      }
      onSuccess?.();
    } catch (err) {
      toast.error(err?.message || "Failed to create employee");
    } finally {
      setLoading(false);
    }
  };

  const closeAndReset = () => {
    setOpen(false);
    setForm(INITIAL_FORM);
    setErrors({});
    setActivationLink(null);
  };

  const handleOpenChange = (val) => {
    if (loading) return;
    if (val) setOpen(true);
    else closeAndReset();
  };

  return (
    <>
      <Button id="add-user-btn" onClick={() => setOpen(true)} className="gap-2 text-sm" size="sm">
        <UserPlus className="w-4 h-4" />
        Add Employee
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              Add Employee
            </DialogTitle>
            <DialogDescription>
              Creates the employee and a login. They set their password via the
              activation link.
            </DialogDescription>
          </DialogHeader>

          {activationLink ? (
            <div className="space-y-4 py-2">
              <p className="text-sm">Employee created. Share this activation link:</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={activationLink} className="text-xs" />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard?.writeText(activationLink);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={closeAndReset}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name" name="firstName" value={form.firstName} onChange={handleChange} error={errors.firstName} disabled={loading} />
                <Field label="Last Name" name="lastName" value={form.lastName} onChange={handleChange} error={errors.lastName} disabled={loading} />
              </div>

              <Field label="Email" name="email" type="email" value={form.email} onChange={handleChange} error={errors.email} disabled={loading} placeholder="name@consortgroup.us" />

              <div className="grid grid-cols-2 gap-3">
                {/* Role */}
                <div className="space-y-1.5">
                  <Label htmlFor="add-role">Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm((p) => ({ ...p, role: v }))} disabled={loading}>
                    <SelectTrigger id="add-role">
                      <SelectValue>{labelForRole(form.role)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Department */}
                <div className="space-y-1.5">
                  <Label htmlFor="add-dept">Department</Label>
                  <Select value={form.departmentId} onValueChange={(v) => setForm((p) => ({ ...p, departmentId: v }))} disabled={loading} items={departments.map((d) => ({ value: d.id, label: d.name }))}>
                    <SelectTrigger id="add-dept" className={errors.departmentId ? "border-destructive" : ""}>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.departmentId && <p className="text-xs text-destructive">{errors.departmentId}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Designation" name="designation" value={form.designation} onChange={handleChange} disabled={loading} placeholder="Optional" />
                <Field label="Phone" name="phone" value={form.phone} onChange={handleChange} disabled={loading} placeholder="Optional" />
              </div>

              {/* Reporting manager (optional) */}
              <div className="space-y-1.5">
                <Label htmlFor="add-manager">Reporting Manager (optional)</Label>
                <Select value={form.managerId || "none"} onValueChange={(v) => setForm((p) => ({ ...p, managerId: v === "none" ? "" : v }))} disabled={loading} items={[{ value: "none", label: "None" }, ...employees.filter((e) => e.isActive).map((e) => ({ value: e.id, label: `${e.fullName} — ${labelForRole(e.role)}` }))]}>
                  <SelectTrigger id="add-manager">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {employees.filter((e) => e.isActive).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.fullName} — {labelForRole(e.role)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter className="gap-2 pt-2">
                <Button type="button" variant="outline" onClick={closeAndReset} disabled={loading}>Cancel</Button>
                <Button type="submit" disabled={loading} className="gap-2">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : <><UserPlus className="w-4 h-4" />Create</>}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

// Small labelled text field
const Field = ({ label, name, error, ...props }) => (
  <div className="space-y-1.5">
    <Label htmlFor={`add-${name}`}>{label}</Label>
    <Input id={`add-${name}`} name={name} className={error ? "border-destructive" : ""} {...props} />
    {error && <p className="text-xs text-destructive">{error}</p>}
  </div>
);

export default AddUserModal;
