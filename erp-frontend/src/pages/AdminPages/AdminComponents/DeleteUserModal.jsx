import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getOpenWork, reassignWork, deactivateEmployee } from "@/services/employeeService";
import { labelForRole } from "@/lib/roles";
import toast from "react-hot-toast";
import { Loader2, UserX } from "lucide-react";

/**
 * DeleteUserModal — deactivate an Employee (ADR-045). Never a hard delete.
 * If they own open work, drives the reassignment wizard first (RULE-EMP-02).
 *
 * Props: user (employee) | null, onClose(), onSuccess(), employees[] (targets).
 */
const DeleteUserModal = ({ user, onClose, onSuccess, employees = [] }) => {
  const [checking, setChecking] = useState(false);
  const [openWork, setOpenWork] = useState(null);
  const [target, setTarget] = useState("");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!user) {
      setOpenWork(null);
      setTarget("");
      return;
    }
    setChecking(true);
    getOpenWork(user.id)
      .then((res) => setOpenWork(res.data))
      .catch((err) => toast.error(err?.message || "Failed to check open work"))
      .finally(() => setChecking(false));
  }, [user]);

  const hasOpenWork = openWork && openWork.total > 0;

  // Active colleagues with a login, excluding the person being deactivated.
  const targets = employees.filter((e) => e.isActive && e.userId && e.id !== user?.id);

  const handleConfirm = async () => {
    if (!user) return;
    if (hasOpenWork && !target) return toast.error("Pick who inherits the open work");

    setProcessing(true);
    try {
      if (hasOpenWork) {
        await reassignWork(user.id, target);
      }
      await deactivateEmployee(user.id);
      toast.success(`${user.fullName} deactivated`);
      onSuccess?.();
      onClose?.();
    } catch (err) {
      // Race: work appeared between check and delete → re-open the wizard.
      if (err?.status === 409) {
        toast.error("New open work appeared — reassign it");
        const res = await getOpenWork(user.id).catch(() => null);
        if (res) setOpenWork(res.data);
      } else {
        toast.error(err?.message || "Failed to deactivate");
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <AlertDialog open={!!user} onOpenChange={(val) => { if (!val && !processing) onClose?.(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <UserX className="w-5 h-5 text-destructive" />
            Deactivate Employee
          </AlertDialogTitle>
          <AlertDialogDescription>
            Deactivate{" "}
            <span className="font-semibold text-foreground">{user?.fullName}</span>?
            Their login is disabled and sessions revoked. Ownership and audit
            history are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {checking && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking open work…
          </span>
        )}

        {hasOpenWork && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-3">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              This employee owns open work — reassign it first:
            </p>
            <ul className="text-xs text-amber-700 dark:text-amber-300 grid grid-cols-2 gap-1">
              <li>Leads: <b>{openWork.leads}</b></li>
              <li>Queries: <b>{openWork.queries}</b></li>
              <li>Quotations: <b>{openWork.quotations}</b></li>
              <li>Tasks: <b>{openWork.tasks}</b></li>
            </ul>
            <div className="space-y-1.5">
              <Label htmlFor="reassign-target" className="text-xs">Reassign to</Label>
              <Select value={target} onValueChange={setTarget} disabled={processing} items={targets.map((e) => ({ value: e.userId, label: `${e.fullName} — ${labelForRole(e.role)}` }))}>
                <SelectTrigger id="reassign-target">
                  <SelectValue placeholder="Select an employee" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((e) => (
                    <SelectItem key={e.id} value={e.userId}>
                      {e.fullName} — {labelForRole(e.role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={() => !processing && onClose?.()} disabled={processing}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleConfirm(); }}
            disabled={processing || checking}
            className="bg-destructive text-white hover:bg-destructive/90 gap-2"
          >
            {processing ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Working…</>
            ) : hasOpenWork ? (
              "Reassign & Deactivate"
            ) : (
              "Deactivate"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteUserModal;
