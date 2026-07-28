import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Ship, RefreshCw, AlertCircle, Pause, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useShipmentStore } from "@/store/shipmentStore";
import { SHIPMENT_STATUS_LABELS, EXCEPTION_STATE_LABELS, labelForService } from "@/lib/catalog";

const STATUS_STYLE = (s) =>
  s === "closed" || s === "settled"
    ? "bg-green-50 text-green-700 border-green-400 dark:bg-green-950/30 dark:text-green-300"
    : s === "booking"
    ? "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300"
    : "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300";

const ShipmentsListPage = () => {
  const { shipments, loading, error, statusFilter, exceptionFilter, setFilter, fetchShipments } = useShipmentStore();
  const navigate = useNavigate();

  useEffect(() => { fetchShipments(); }, [fetchShipments]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><Ship className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Shipments</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Status is derived from the composed OTD path — a shorter service set runs fewer steps
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={exceptionFilter || "all"} onValueChange={(v) => setFilter("exceptionFilter", v === "all" ? "" : v)} items={[{ value: "all", label: "All states" }, { value: "none", label: "Active" }, { value: "on_hold", label: "On Hold" }, { value: "cancelled", label: "Cancelled" }]}>
            <SelectTrigger className="w-32 h-9"><SelectValue placeholder="State" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="none">Active</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchShipments} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0" /><p className="text-sm font-medium flex-1">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchShipments}>Retry</Button>
        </div>
      )}

      <div className="border rounded-xl overflow-x-auto bg-white dark:bg-zinc-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left border-b">
            <tr>
              <th className="p-3 font-semibold text-muted-foreground">Ref</th>
              <th className="p-3 font-semibold text-muted-foreground">Customer</th>
              <th className="p-3 font-semibold text-muted-foreground hidden md:table-cell">Services</th>
              <th className="p-3 font-semibold text-muted-foreground">Status</th>
              <th className="p-3 font-semibold text-muted-foreground">State</th>
            </tr>
          </thead>
          <tbody>
            {loading && [...Array(3)].map((_, i) => (
              <tr key={i} className="border-t animate-pulse">{[...Array(5)].map((_, j) => <td key={j} className="p-3"><div className="h-4 bg-muted rounded w-3/4" /></td>)}</tr>
            ))}
            {!loading && shipments.map((s) => (
              <tr key={s.id} className="border-t hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`/admin/shipments/${s.id}`)}>
                <td className="p-3"><span className="font-medium text-primary">{s.referenceNo}</span></td>
                <td className="p-3">{s.customerCompany} <span className="text-xs text-muted-foreground">({s.customerRef})</span></td>
                <td className="p-3 hidden md:table-cell">
                  <div className="flex flex-wrap gap-1 max-w-xs">
                    {s.services.map((sv) => <Badge key={sv} variant="secondary" className="text-[10px]">{labelForService(sv)}</Badge>)}
                  </div>
                </td>
                <td className="p-3"><Badge variant="outline" className={`text-xs ${STATUS_STYLE(s.status)}`}>{SHIPMENT_STATUS_LABELS[s.status]}</Badge></td>
                <td className="p-3">
                  {s.exceptionState === "on_hold" && <Badge variant="outline" className="text-xs gap-1 bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300"><Pause className="w-3 h-3" /> On Hold</Badge>}
                  {s.exceptionState === "cancelled" && <Badge variant="outline" className="text-xs gap-1 bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300"><Ban className="w-3 h-3" /> Cancelled</Badge>}
                  {s.exceptionState === "none" && <span className="text-xs text-muted-foreground">{EXCEPTION_STATE_LABELS.none}</span>}
                </td>
              </tr>
            ))}
            {!loading && shipments.length === 0 && !error && (
              <tr><td colSpan="5" className="p-10 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Ship className="w-8 h-8 opacity-30" /><p className="font-medium">No shipments yet</p>
                  <p className="text-xs">Shipments appear once a quotation is approved.</p>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ShipmentsListPage;
