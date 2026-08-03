import { useEffect, useState } from "react";
import { Landmark, Download, FileText, AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listDocuments, downloadDocument } from "@/services/documentService";

/**
 * The letter of credit a query was raised against (CRM_MASTER §5.21).
 *
 * A bank_lc query is priced against the credit, not against a lane and a weight: the
 * expiry and latest-shipment dates decide whether the schedule is even feasible, the
 * partial/transhipment rules decide how it can be moved, and the documents-required
 * list decides half of what it costs to serve. All of that arrives as `lcDetails`,
 * snapshotted onto the query when the referral was converted — so this panel shows
 * the LC's own words to whoever is about to quote it.
 *
 * Renders nothing for a query with no LC, which is most of them.
 */

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : null);

const Row = ({ label, value, wide = false }) =>
  value ? (
    <div className={wide ? "col-span-full" : ""}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words whitespace-pre-wrap">{value}</dd>
    </div>
  ) : null;

const QueryLcDetails = ({ query }) => {
  const lc = query?.lcDetails;
  // `undefined` = still fetching, `null` = fetched and there is none. Deriving the
  // spinner from that beats a second state variable set inside the effect, which is
  // the cascading-render pattern the hooks lint rule exists to catch.
  const [doc, setDoc] = useState(undefined);
  const loadingDoc = doc === undefined;

  // The advice is copied onto the query at conversion, so it is fetched by owner
  // rather than threaded through the query payload.
  useEffect(() => {
    if (!lc || !query?.id) return undefined;
    let alive = true;
    listDocuments("query", query.id)
      .then((res) => alive && setDoc((res.data || []).find((d) => d.docType === "lc") ?? null))
      .catch(() => alive && setDoc(null));
    return () => { alive = false; };
  }, [lc, query?.id]);

  if (!lc) return null;

  const money = lc.amount != null
    ? `${lc.currency ?? ""} ${Number(lc.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`.trim()
    : null;

  return (
    <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Landmark className="w-4 h-4 text-primary" />
          Letter of Credit
          {lc.lcNumber && <span className="font-mono text-xs text-muted-foreground">{lc.lcNumber}</span>}
        </h3>
        <div className="flex items-center gap-1.5">
          {lc.referralRef && <Badge variant="outline" className="text-[10px]">from {lc.referralRef}</Badge>}
          {loadingDoc && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          {doc && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              onClick={() => downloadDocument(doc.id, doc.fileName)}>
              <Download className="w-3.5 h-3.5" /> LC PDF
            </Button>
          )}
        </div>
      </div>

      {/* A port the LC names but we hold no code for. The lane on the query above is
          blank in that case, and saying why beats leaving someone to wonder. */}
      {lc.unresolvedPorts?.length > 0 && (
        <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          Not in the ports list, so it is not on the lane above: {lc.unresolvedPorts.join("; ")}
        </p>
      )}

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
        <Row label="Applicant (buyer)" value={lc.applicantName} />
        <Row label="Beneficiary (seller)" value={lc.beneficiaryName} />
        <Row label="Issuing bank" value={[lc.issuingBankName, lc.issuingBankBic].filter(Boolean).join(" · ")} />
        <Row label="Credit amount" value={money} />
        <Row label="Tolerance" value={lc.tolerance} />
        <Row label="Form" value={lc.formOfCredit} />
        <Row label="Commodity" value={lc.commodity} />
        <Row label="Quantity" value={lc.quantity} />
        <Row label="Unit price" value={lc.unitPrice} />
        <Row label="Total value" value={lc.totalValue} />
        <Row label="Price term" value={lc.priceTerm ?? lc.incoterm} />
        <Row label="Packing" value={lc.packing} />
        <Row label="Country of origin" value={lc.countryOfOrigin} />
        <Row label="Port of loading" value={lc.originPort} />
        <Row label="Port of discharge" value={lc.destinationPort} />
        <Row label="Date of issue" value={fmtDate(lc.issueDate)} />
        <Row label="Latest shipment" value={fmtDate(lc.latestShipmentDate)} />
        <Row label="Expiry" value={[fmtDate(lc.expiryDate), lc.expiryPlace].filter(Boolean).join(" · ")} />
        <Row label="Partial shipments" value={lc.partialShipments} />
        <Row label="Transhipment" value={lc.transhipment} />
        <Row label="Applicable rules" value={lc.applicableRules} />
      </dl>

      {/* Long free-text blocks last, collapsed: they are the reason a quote gains or
          loses charges, but they run to a page and a half. */}
      {[
        ["Goods description (45A)", lc.goodsDescription],
        ["Documents required (46A)", lc.documentsRequired],
        ["Additional conditions (47A)", lc.additionalConditions],
      ].filter(([, v]) => v).map(([label, value]) => (
        <details key={label} className="rounded-lg border bg-background">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" /> {label}
          </summary>
          <pre className="max-h-60 overflow-auto px-3 pb-3 text-[11px] leading-relaxed whitespace-pre-wrap scrollbar-thin">
            {value}
          </pre>
        </details>
      ))}
    </div>
  );
};

export default QueryLcDetails;
