import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, AlertCircle, Building2, FileText, Landmark, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import DocumentsPanel from "@/components/DocumentsPanel";
import { VENDOR_TYPE_LABELS, FI_STATUS_LABELS, FI_STATUS_CLASS, labelForTradeStage } from "@/lib/catalog";
import { getVendor } from "@/services/vendorService";
import * as tradeService from "@/services/tradeService";

/**
 * One party in the directory, and everything it has touched.
 *
 * The roadmap's §2 directory is only half the answer — the useful question on a vendor
 * is "what has this company done for us", which spans its contracts, the bank
 * instruments it holds, and the shipments it appears on. `Vendor.type` is shown as what
 * it is: a default hint, not the role it plays on any given job.
 */

const money = (n, ccy) =>
  n == null
    ? "—"
    : `${ccy ?? ""} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const Fact = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-sm break-words">{value || "—"}</p>
  </div>
);

const VendorDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canTrade = hasPermission("trade.read");

  const [vendor, setVendor] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("profile");

  const load = useCallback(
    async (alive = () => true) => {
      try {
        const v = await getVendor(id);
        if (!alive()) return;
        setVendor(v.data);
        // Best-effort: a role without trade.read simply sees the profile and documents.
        if (canTrade) {
          const [c, f] = await Promise.all([
            tradeService.listContracts({ vendorId: id }).catch(() => ({ data: [] })),
            tradeService.listInstruments({ vendorId: id }).catch(() => ({ data: [] })),
          ]);
          if (!alive()) return;
          setContracts(c.data ?? []);
          setInstruments(f.data ?? []);
        }
      } catch (err) {
        if (alive()) setError(err?.message || "Vendor not found");
      } finally {
        if (alive()) setLoading(false);
      }
    },
    [id, canTrade],
  );

  useEffect(() => {
    let mounted = true;
    // load() is async: every setState runs in an await continuation, guarded by `mounted`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(() => mounted);
    return () => {
      mounted = false;
    };
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (error || !vendor) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate("/admin/vendors")}>
          <ArrowLeft className="w-4 h-4" /> Vendors
        </Button>
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-medium">{error ?? "Vendor not found"}</p>
        </div>
      </div>
    );
  }

  // Every shipment this party appears on, through the instruments it holds.
  const shipments = instruments.flatMap((f) => (f.shipments ?? []).map((s) => ({ ...s, via: f.fiNumber })));

  const TABS = [
    { key: "profile", label: "Profile", icon: Building2 },
    ...(canTrade ? [{ key: "trade", label: "Contracts & Instruments", icon: Landmark }] : []),
    { key: "documents", label: "Documents", icon: FileText },
  ];

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate("/admin/vendors")}>
        <ArrowLeft className="w-4 h-4" /> Vendors
      </Button>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-primary">{vendor.name}</h1>
            <Badge variant="outline" className="text-xs">{VENDOR_TYPE_LABELS[vendor.type] ?? vendor.type}</Badge>
            {!vendor.isActive && <Badge variant="outline" className="text-xs text-muted-foreground">Deactivated</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {vendor.referenceNo}
            {vendor.city ? ` · ${vendor.city}` : ""}
            {vendor.country ? `, ${vendor.country}` : ""}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            The type above is what this company usually is. The role it plays is chosen per shipment.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-sm px-3 py-1.5 rounded-md flex items-center gap-1.5 ${
              tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="space-y-4">
          <div className="border rounded-xl p-4">
            <p className="text-xs font-semibold mb-3">Contact</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Fact label="Contact" value={vendor.contactName} />
              <Fact label="Email" value={vendor.email} />
              <Fact label="Phone" value={vendor.phone} />
              <Fact label="Website" value={vendor.website} />
              <Fact label="Address" value={vendor.address} />
              <Fact label="City" value={vendor.city} />
              <Fact label="Country" value={vendor.country} />
            </div>
          </div>

          <div className="border rounded-xl p-4">
            <p className="text-xs font-semibold mb-3">Registration &amp; terms</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Fact label="NTN / Tax ID" value={vendor.taxId} />
              <Fact label="STRN" value={vendor.strn} />
              <Fact label="REX No." value={vendor.rexNo} />
              <Fact label="VAT / TVA No." value={vendor.vatNo} />
              <Fact label="Payment terms" value={vendor.paymentTermsDays ? `${vendor.paymentTermsDays} days` : null} />
              <Fact label="Currency" value={vendor.currency} />
            </div>
          </div>

          <div className="border rounded-xl p-4">
            <p className="text-xs font-semibold mb-3">Banking</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Fact label="Bank" value={vendor.bankName} />
              <Fact label="Branch" value={vendor.bankBranch} />
              <Fact label="Account title" value={vendor.accountTitle} />
              <Fact label="IBAN" value={vendor.iban} />
              <Fact label="SWIFT" value={vendor.swiftCode} />
            </div>
          </div>

          {vendor.notes && (
            <div className="border rounded-xl p-4">
              <p className="text-xs font-semibold mb-2">Internal notes</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{vendor.notes}</p>
            </div>
          )}
        </div>
      )}

      {tab === "trade" && (
        <div className="space-y-4">
          <div className="border rounded-xl p-4">
            <p className="text-xs font-semibold mb-3 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Contracts
            </p>
            {contracts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contracts against this party.</p>
            ) : (
              <ul className="space-y-1.5">
                {contracts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm border-b last:border-0 py-1.5">
                    <span className="truncate">
                      <span className="font-medium">{c.contractNo}</span>
                      <span className="text-muted-foreground"> · {fmtDate(c.contractDate)}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0">{money(c.totalValue, c.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border rounded-xl p-4">
            <p className="text-xs font-semibold mb-3 flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5" /> Financial instruments
            </p>
            {instruments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No instruments registered for this party.</p>
            ) : (
              <ul className="space-y-1.5">
                {instruments.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 text-sm border-b last:border-0 py-1.5">
                    <span className="truncate">
                      <span className="font-medium">{f.fiNumber}</span>
                      <span className="text-muted-foreground"> · expires {fmtDate(f.expiryDate)}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground">{money(f.value, f.currency)}</span>
                      <Badge variant="outline" className={`text-[10px] ${FI_STATUS_CLASS[f.status] ?? ""}`}>
                        {FI_STATUS_LABELS[f.status] ?? f.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border rounded-xl p-4">
            <p className="text-xs font-semibold mb-3 flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5" /> Shipments
            </p>
            {shipments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shipments yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {shipments.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-sm border-b last:border-0 py-1.5">
                    <button
                      type="button"
                      className="truncate text-left hover:underline"
                      onClick={() => navigate(`/admin/shipments/${s.id}`)}
                    >
                      <span className="font-medium">{s.referenceNo}</span>
                      <span className="text-muted-foreground"> · via {s.via}</span>
                    </button>
                    <span className="text-muted-foreground text-xs shrink-0">{labelForTradeStage(s.tradeStage)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "documents" && (
        <DocumentsPanel ownerType="vendor" ownerId={id} defaultDocType="tax_certificate" gallery />
      )}
    </div>
  );
};

export default VendorDetailPage;
