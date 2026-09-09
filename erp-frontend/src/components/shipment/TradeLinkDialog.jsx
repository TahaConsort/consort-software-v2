import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as tradeService from "@/services/tradeService";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * Roadmap Step 1 on a shipment born from a quotation (ADR-057): pick the Trade Contract
 * the customer's BRD/PO was registered as, and the Financial Instrument the vendor's bank
 * issued against it. Both come from the Trade Registers; this dialog only LINKS them —
 * creating one is a register job, linked to from here.
 *
 * Instruments are filtered to the chosen contract's vendor, because the server refuses
 * an instrument another vendor registered. `contractId` / `financialInstrumentId` are
 * what the shipment already carries, so a half-linked shipment shows what it has.
 */
const TradeLinkDialog = ({ shipment, busy, onClose, onSubmit }) => {
  const [contracts, setContracts] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contractId, setContractId] = useState(shipment.contractId ?? "");
  const [fiId, setFiId] = useState(shipment.financialInstrumentId ?? "");

  useEffect(() => {
    let alive = true;
    Promise.all([
      tradeService.listContracts().catch(() => ({ data: [] })),
      tradeService.listInstruments().catch(() => ({ data: [] })),
    ])
      .then(([c, f]) => {
        if (!alive) return;
        // Contracts for this customer, or with no customer named yet (the register lets
        // a contract be raised before the CRM customer exists).
        setContracts((c.data ?? []).filter((x) => !x.customerId || x.customerId === shipment.customerId));
        setInstruments(f.data ?? []);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [shipment.customerId]);

  const contract = contracts.find((c) => c.id === contractId) ?? null;
  // Only ACTIVE instruments can back an order; the server says the same.
  const eligible = instruments.filter(
    (f) => f.status === "active" && (!contract || f.vendorId === contract.vendorId) && (!f.customerId || f.customerId === shipment.customerId),
  );

  const submit = () => {
    const payload = {};
    if (contractId && contractId !== shipment.contractId) payload.contractId = contractId;
    if (fiId && fiId !== shipment.financialInstrumentId) payload.financialInstrumentId = fiId;
    if (!Object.keys(payload).length) return toast.error("Pick a contract and/or an instrument to link");
    onSubmit(payload);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register contract &amp; financial instrument</DialogTitle>
          <DialogDescription>
            Step 1 of the export cycle. The contract is the customer&apos;s BRD/PO; the instrument is the
            EXP form the vendor&apos;s bank registered against it. Both must be on the shipment before the step
            can complete — its expiry and DA clock run from here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Trade contract</Label>
            <Select value={contractId} onValueChange={(v) => { setContractId(v); setFiId(""); }} disabled={loading || busy}
              items={contracts.map((c) => ({ value: c.id, label: `${c.referenceNo} · ${c.contractNo}` }))}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={loading ? "Loading…" : "Pick the contract…"} /></SelectTrigger>
              <SelectContent>
                {contracts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.referenceNo} · {c.contractNo}{c.vendorName ? ` · ${c.vendorName}` : ""}{c.contractDate ? ` · ${fmtDate(c.contractDate)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loading && contracts.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No contract on the register for this customer yet.</p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Financial instrument (active)</Label>
            <Select value={fiId} onValueChange={setFiId} disabled={loading || busy || (!contract && !shipment.contractId)}
              items={eligible.map((f) => ({ value: f.id, label: f.fiNumber }))}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={!contract && !shipment.contractId ? "Pick the contract first" : eligible.length ? "Pick the instrument…" : "No active instrument for this vendor"} />
              </SelectTrigger>
              <SelectContent>
                {eligible.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.fiNumber} · {f.currency} {Number(f.value ?? 0).toLocaleString()} · expires {fmtDate(f.expiryDate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            Not on the register yet?
            <Link to="/admin/trade" className="text-primary hover:underline inline-flex items-center gap-0.5">
              Open Trade Registers <ExternalLink className="w-3 h-3" />
            </Link>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || loading}>Link to shipment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TradeLinkDialog;
