import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Handshake, Search, RefreshCw, AlertCircle, Globe, Loader2, Copy, UserPlus, FileSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import toast from "react-hot-toast";
import { useCustomerStore } from "@/store/customerStore";
import { useAuthStore } from "@/store/authStore";
import { isManagement, hasAnyRole } from "@/lib/roles";
import { LeadSourceBadge } from "../LeadsPages/LeadComponents/leadBadges";

const SkeletonRow = () => (
  <tr className="border-t animate-pulse">
    {[...Array(6)].map((_, i) => (
      <td key={i} className="p-3"><div className="h-4 bg-muted rounded w-3/4" /></td>
    ))}
  </tr>
);

/**
 * CustomersListPage — customers exist only via lead conversion (RULE-LD-05).
 * Portal-user provisioning (WORKFLOW §1) is Management + ASM.
 */
const CustomersListPage = () => {
  const { customers, loading, error, fetchCustomers } = useCustomerStore();
  const currentUser = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  // An id, not the row object: the modal stays open after success to show the activation
  // link, and a background refresh replaces the array underneath it. Resolving from the
  // live list keeps what it renders current (the pattern FinanceListPage already uses).
  const [portalForId, setPortalForId] = useState(null);
  const portalFor = customers.find((c) => c.id === portalForId) ?? null;

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const canProvision = isManagement(currentUser) || hasAnyRole(currentUser, ["asm"]);

  const filtered = customers.filter(
    (c) =>
      c.referenceNo?.toLowerCase().includes(search.toLowerCase()) ||
      c.companyName?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><Handshake className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Customers</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Converted from qualified leads — one per company
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchCustomers} disabled={loading} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 border rounded-xl px-3 h-10 bg-white dark:bg-zinc-900 shadow-sm focus-within:ring-2 focus-within:ring-primary/30 transition-all">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <Input
          placeholder="Search by CST ref or company…"
          className="border-0 shadow-none focus-visible:ring-0 h-full bg-transparent px-0"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium flex-1">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchCustomers} className="border-destructive/50 text-destructive hover:bg-destructive/10">Retry</Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-xl overflow-x-auto bg-white dark:bg-zinc-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left border-b">
            <tr>
              <th className="p-3 font-semibold text-muted-foreground">Ref</th>
              <th className="p-3 font-semibold text-muted-foreground">Company</th>
              <th className="p-3 font-semibold text-muted-foreground hidden sm:table-cell">Source</th>
              <th className="p-3 font-semibold text-muted-foreground hidden md:table-cell">Assigned BDO</th>
              <th className="p-3 font-semibold text-muted-foreground">Portal</th>
              <th className="p-3 font-semibold text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <><SkeletonRow /><SkeletonRow /><SkeletonRow /></>}

            {!loading && filtered.map((c) => (
              <tr key={c.id} className="border-t hover:bg-muted/30 transition-colors group">
                <td className="p-3 font-medium text-primary">{c.referenceNo}</td>
                <td className="p-3 font-medium">{c.companyName}</td>
                <td className="p-3 hidden sm:table-cell"><LeadSourceBadge source={c.source} /></td>
                <td className="p-3 text-muted-foreground hidden md:table-cell">{c.assignedBdoName ?? "—"}</td>
                <td className="p-3">
                  {c.portalUsers?.length ? (
                    <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30 gap-1">
                      <Globe className="w-3 h-3" /> {c.portalUsers.length}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">None</Badge>
                  )}
                </td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    {hasPermission("query.create") && c.isActive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2.5 text-xs gap-1.5 hover:bg-primary/10 hover:text-primary"
                        onClick={() => navigate("/admin/queries", { state: { customerId: c.id } })}
                      >
                        <FileSearch className="w-3.5 h-3.5" /> New Query
                      </Button>
                    )}
                    {canProvision && c.isActive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2.5 text-xs gap-1.5 hover:bg-primary/10 hover:text-primary"
                        onClick={() => setPortalForId(c.id)}
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Portal User
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && filtered.length === 0 && !error && (
              <tr>
                <td colSpan="6" className="p-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Handshake className="w-8 h-8 opacity-30" />
                    <p className="font-medium">
                      {search ? "No customers match" : "No customers yet — convert a qualified lead"}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PortalUserModal customer={portalFor} onClose={() => setPortalForId(null)} />
    </div>
  );
};

/* ── Provision portal user (WORKFLOW §1 "provision portal user") ── */
const PortalUserModal = ({ customer, onClose }) => {
  // Through the store: creating a portal user also creates a User row, so the employee
  // list changes too, and the store publishes both topics.
  const createPortalUser = useCustomerStore((s) => s.createPortalUser);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);

  const reset = () => { setEmail(""); setLink(null); onClose(); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await createPortalUser(customer.id, email);
      toast.success("Portal user created");
      if (res.devActivationToken) {
        setLink(`${window.location.origin}/activate?token=${res.devActivationToken}`);
      } else {
        reset();
      }
      // No onSuccess callback needed: the store refetched the customer list and published
      // `customers`/`employees` before this line ran.
    } catch (err) {
      toast.error(err?.message || "Failed to create portal user");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!customer} onOpenChange={(v) => !v && !busy && reset()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Provision Portal User</DialogTitle>
          <DialogDescription>
            Creates a portal login for <b>{customer?.companyName}</b>. They set their
            password via the activation link and see only their own shipments.
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="space-y-4 py-2">
            <p className="text-sm">Share this activation link:</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} className="text-xs" />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => { navigator.clipboard?.writeText(link); toast.success("Copied"); }}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={reset}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="portal-email">Email</Label>
              <Input
                id="portal-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@company.com"
                required
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={reset} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy} className="gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CustomersListPage;
