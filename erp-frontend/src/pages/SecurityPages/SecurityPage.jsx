import { useEffect, useState, useCallback } from "react";
import { ShieldCheck, Loader2, Monitor, LogOut, X } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import * as authService from "@/services/authService";

/**
 * Security & Sessions (CRM_MASTER §5.1, ADR-033). Multi-device visibility with
 * per-session revocation, a global logout, and the login-activity trail.
 */
const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
const OUTCOME_TONE = {
  success: "border-green-400 text-green-700 dark:text-green-300",
  invalid_credentials: "border-red-400 text-red-700 dark:text-red-300",
  locked: "border-amber-400 text-amber-700 dark:text-amber-300",
  inactive: "border-muted-foreground/40 text-muted-foreground",
};

const SecurityPage = () => {
  const [sessions, setSessions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([authService.listSessions(), authService.getLoginActivity()]);
      setSessions(s.data ?? []);
      setActivity(a.data ?? []);
    } catch (err) {
      toast.error(err?.message || "Failed to load security info");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    setBusyId(id);
    try {
      await authService.revokeSession(id);
      toast.success("Session revoked");
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not revoke");
    } finally {
      setBusyId(null);
    }
  };

  const logoutOthers = async () => {
    try {
      await authService.logoutAll();
      toast.success("Signed out of all devices");
      // Current session is revoked too; the axios layer will bounce to login on next call.
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not sign out everywhere");
    }
  };

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><ShieldCheck className="w-5 h-5" /></div>
        <div>
          <h1 className="text-xl font-semibold leading-none">Security</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Active devices and recent sign-in activity.</p>
        </div>
      </div>

      {loading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}

      {!loading && (
        <>
          <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Active sessions</h2>
              {sessions.length > 1 && (
                <Button size="sm" variant="outline" className="gap-2 text-destructive" onClick={logoutOthers}>
                  <LogOut className="w-4 h-4" /> Sign out everywhere
                </Button>
              )}
            </div>
            <ul className="divide-y">
              {sessions.map((s) => (
                <li key={s.id} className="py-3 flex items-center gap-3">
                  <Monitor className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {s.deviceLabel || "Unknown device"}
                      {s.current && <Badge variant="outline" className="text-[10px] border-primary text-primary">This device</Badge>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{s.ip || "—"} · since {fmt(s.createdAt)}</p>
                  </div>
                  {!s.current && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive gap-1" disabled={busyId === s.id}
                      onClick={() => revoke(s.id)}>
                      {busyId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Revoke
                    </Button>
                  )}
                </li>
              ))}
              {sessions.length === 0 && <li className="py-3 text-sm text-muted-foreground">No active sessions.</li>}
            </ul>
          </div>

          <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5">
            <h2 className="font-semibold text-sm mb-3">Recent sign-in activity</h2>
            <ul className="divide-y">
              {activity.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{a.emailAttempted}<span className="text-muted-foreground"> · {a.ip || "—"}</span></span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`text-[10px] ${OUTCOME_TONE[a.outcome] ?? ""}`}>{a.outcome.replace(/_/g, " ")}</Badge>
                    <span className="text-[11px] text-muted-foreground">{fmt(a.createdAt)}</span>
                  </div>
                </li>
              ))}
              {activity.length === 0 && <li className="py-2 text-sm text-muted-foreground">No activity recorded.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default SecurityPage;
