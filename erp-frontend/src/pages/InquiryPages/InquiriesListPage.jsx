import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, Loader2, ArrowRight, Ban, Eye, Check } from "lucide-react";
import toast from "react-hot-toast";
import { useTopicRefresh } from "@/lib/useTopicRefresh";
import { invalidate } from "@/lib/invalidationBus";
import { TOPICS } from "@/lib/topics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { labelForService, DEFAULT_CURRENCY } from "@/lib/catalog";
import { useAuthStore } from "@/store/authStore";
import { listInquiries, setInquiryStatus, convertInquiry } from "@/services/inquiryService";

const STATUS_STYLE = {
  new: "border-blue-400 text-blue-700 dark:text-blue-300",
  reviewing: "border-amber-400 text-amber-700 dark:text-amber-300",
  converted: "border-green-400 text-green-700 dark:text-green-300",
  spam: "border-zinc-400 text-zinc-500",
  closed: "border-zinc-400 text-zinc-500",
};

const money = (n, ccy = DEFAULT_CURRENCY) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(Number(n));

/**
 * Public Inquiry triage (CRM_MASTER §5.20) — the Sales inbox for the *direct*
 * channel. Review a storefront request, then convert it to a customer + query.
 */
export default function InquiriesListPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canConvert = hasPermission("inquiry.convert");

  const [inquiries, setInquiries] = useState(null);
  const [filter, setFilter] = useState("new");
  // Which filter the rows in state belong to. Adjusted during render (React's documented
  // adjust-state-on-prop-change pattern) so switching filters blanks the previous result
  // set immediately, without a setState inside an effect.
  const [loadedFilter, setLoadedFilter] = useState(filter);
  if (loadedFilter !== filter) {
    setLoadedFilter(filter);
    setInquiries(null);
  }
  // Derived, so a BACKGROUND refresh never replaces the list with a spinner.
  const loading = inquiries === null;
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [convertTarget, setConvertTarget] = useState(null);

  // `isCurrent` is the stale guard: switching the filter quickly could otherwise leave
  // the losing response on screen, which reads as a stuck list.
  const load = useCallback(async ({ isCurrent } = {}) => {
    const ok = isCurrent ?? (() => true);
    try {
      const res = await listInquiries(filter === "all" ? undefined : filter);
      if (ok()) setInquiries(res.data || []);
    } catch (err) {
      if (ok()) toast.error(err?.message || "Could not load inquiries");
    }
  }, [filter]);

  // This inbox exists to show work that arrives from OUTSIDE the app, so it is the last
  // screen that should need a manual reload — yet it had no live path at all.
  const { run: reload } = useTopicRefresh([TOPICS.INQUIRIES, TOPICS.QUERIES, TOPICS.LEADS], load);

  useEffect(() => { reload(); }, [filter, reload]);

  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      await reload();
      // Converting an inquiry mints a lead, a query and a customer, so those screens must re-read.
      // This page's own topic is deliberately absent: reload() above already covers it,
      // and publishing it would schedule a second, redundant request.
      invalidate(TOPICS.QUERIES, TOPICS.LEADS, TOPICS.CUSTOMERS, TOPICS.DASHBOARD);
      return res;
    } catch (err) {
      toast.error(err?.message || "Couldn't update the inquiry");
    } finally {
      setBusy(false);
    }
  };

  const doConvert = async () => {
    const res = await act(() => convertInquiry(convertTarget.id), "Inquiry converted to query");
    setConvertTarget(null);
    setDetail(null);
    if (res?.data?.queryId) navigate("/admin/queries");
  };

  const FILTERS = ["new", "reviewing", "converted", "all"];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Inbox className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Storefront Inquiries</h1>
          <p className="text-sm text-muted-foreground">Direct-channel requests from the public storefront (§5.20)</p>
        </div>
      </div>

      <div className="flex gap-1.5">
        {FILTERS.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="capitalize" onClick={() => setFilter(f)}>
            {f}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : inquiries.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">No inquiries here.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Ref</th>
                <th className="px-4 py-2.5">Contact</th>
                <th className="px-4 py-2.5">Lane</th>
                <th className="px-4 py-2.5">Services</th>
                <th className="px-4 py-2.5">Est.</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {inquiries.map((i) => (
                <tr key={i.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-mono text-xs">{i.referenceNo}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{i.contactName}</div>
                    <div className="text-xs text-muted-foreground">{i.companyName || i.contactEmail}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{i.originPort || "—"} → {i.destinationPort || "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {(i.services || []).map((s) => <Badge key={s} variant="secondary" className="text-[10px]">{labelForService(s)}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{money(i.estimatedAmount, i.estimateCurrency || DEFAULT_CURRENCY)}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline" className={`capitalize text-[10px] ${STATUS_STYLE[i.status] ?? ""}`}>{i.status}</Badge></td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setDetail(i)}>
                        <Eye className="w-3.5 h-3.5" /> View
                      </Button>
                      {canConvert && !["converted", "spam"].includes(i.status) && (
                        <Button size="sm" className="h-8 gap-1" disabled={busy} onClick={() => setConvertTarget(i)}>
                          <ArrowRight className="w-3.5 h-3.5" /> Convert
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.referenceNo}</DialogTitle>
                <DialogDescription>{detail.contactName} · {detail.contactEmail}{detail.contactPhone ? ` · ${detail.contactPhone}` : ""}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                {detail.companyName && <p><span className="text-muted-foreground">Company:</span> {detail.companyName}</p>}
                <p><span className="text-muted-foreground">Lane:</span> {detail.originPort || "—"} → {detail.destinationPort || "—"}{detail.containerTypeCode ? ` · ${detail.containerTypeCode}` : ""}</p>
                <p><span className="text-muted-foreground">Services:</span> {(detail.services || []).map(labelForService).join(", ") || "—"}</p>
                {detail.cargoDescription && <p><span className="text-muted-foreground">Cargo:</span> {detail.cargoDescription}</p>}
                {detail.estimatedAmount != null && <p><span className="text-muted-foreground">Estimate:</span> {money(detail.estimatedAmount, detail.estimateCurrency || DEFAULT_CURRENCY)}</p>}
                {detail.message && <p className="rounded-md bg-muted/50 p-2 text-muted-foreground">{detail.message}</p>}
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {!["converted", "spam", "closed"].includes(detail.status) && (
                  <>
                    <Button variant="outline" size="sm" className="gap-1" disabled={busy}
                      onClick={() => act(() => setInquiryStatus(detail.id, "reviewing"), "Marked reviewing").then(() => setDetail(null))}>
                      <Check className="w-3.5 h-3.5" /> Reviewing
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1 text-destructive" disabled={busy}
                      onClick={() => act(() => setInquiryStatus(detail.id, "spam"), "Marked spam").then(() => setDetail(null))}>
                      <Ban className="w-3.5 h-3.5" /> Spam
                    </Button>
                  </>
                )}
                {canConvert && !["converted", "spam"].includes(detail.status) && (
                  <Button size="sm" className="gap-1" disabled={busy} onClick={() => setConvertTarget(detail)}>
                    <ArrowRight className="w-3.5 h-3.5" /> Convert to query
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Convert confirm */}
      <Dialog open={!!convertTarget} onOpenChange={(o) => !o && setConvertTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert {convertTarget?.referenceNo}?</DialogTitle>
            <DialogDescription>
              This creates a customer (source: direct), a lead and a query from this inquiry. You can then draft a quotation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>Cancel</Button>
            <Button className="gap-2" disabled={busy} onClick={doConvert}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Convert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
