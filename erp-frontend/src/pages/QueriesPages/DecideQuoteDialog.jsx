import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileCheck2,
  FileX2,
  Link2,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Button,
  Callout,
  EmptyState,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TRow,
  Table,
} from "@neuctra/ui";
import toast from "react-hot-toast";
// Read-only: this dialog looks up the one live quote for a query. All quotation WRITES
// go through the parent's useQuotationStore so they invalidate the screens they affect.
import * as quotationService from "@/services/quotationService";
import * as approvalService from "@/services/approvalService";
import * as documentService from "@/services/documentService";
import { QUOTE_SHARE_CHANNEL_LABELS, routeOf, DEFAULT_CURRENCY } from "@/lib/catalog";

const money = (n, ccy) =>
  `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const SHARE_OPTIONS = Object.entries(QUOTE_SHARE_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));

/** The customer's signed quotation — the one document type this dialog handles. */
const ACCEPTANCE_DOC_TYPE = "quotation_acceptance";

/** Module scope so the memoised fetcher below does not close over a fresh object. */
const EMPTY_LINK_STATE = { active: null, lastDecision: null };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "");

/**
 * Review a sent quote (ADR-056). Nobody here approves — a shipment is born only from the
 * customer's own act. What the dialog offers instead, per role:
 *
 *   sales (`canShare`)      record that the quote was given, record the customer's verbal
 *                           yes and relay the one-time link, upload the copy they signed
 *   ops (`canVerify`)       verify or reject that signed copy — verifying IS the approval
 *                           and creates the shipment on the spot
 *   anyone with reject      reject on the customer's behalf (routes to a revision)
 *
 * The parent decides the flags; the server enforces them again.
 */
const DecideQuoteDialog = ({
  busy,
  query,
  currentUserId,
  canReject,
  canShare,
  canVerify,
  onShare,
  onClose,
  onReject,
  onVerified,
}) => {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("view"); // "view" | "reject"
  const [reason, setReason] = useState("");

  // "Given to customer" — informational.
  const [shareChannel, setShareChannel] = useState("");
  const [shareNote, setShareNote] = useState("");
  const [sharing, setSharing] = useState(false);

  // "Customer said yes" — the recorded claim + the link that goes with it.
  const [acceptVia, setAcceptVia] = useState("");
  const [acceptNote, setAcceptNote] = useState("");
  const [recording, setRecording] = useState(false);

  /**
   * The parent's `busy` comes from the QUERY store, but reject runs through the
   * QUOTATION store — so it never goes true here and nothing guarded a second click.
   * Tracking the in-flight decision locally fixes it without the parent changing.
   */
  const [decidingAs, setDecidingAs] = useState(null); // null | "reject"

  /**
   * The secure approval link. `linkToken` is the plaintext, held in memory only for as
   * long as this dialog is open — the server returns it once and never again, so once
   * this closes the only way to get a link is to issue a new one.
   */
  const [linkState, setLinkState] = useState(EMPTY_LINK_STATE);
  const [linkToken, setLinkToken] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // The signed copies on the quotation, newest first.
  const [copies, setCopies] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [verifyingId, setVerifyingId] = useState(null);
  const [rejectingCopy, setRejectingCopy] = useState(null); // document id whose reject note is open
  const [copyRejectNote, setCopyRejectNote] = useState("");
  const fileRef = useRef(null);

  const pending =
    busy || sharing || recording || linkBusy || uploading || verifyingId !== null || decidingAs !== null;

  useEffect(() => {
    let alive = true;
    quotationService
      .listQuotations({ queryId: query.id, status: "sent" })
      .then((res) => {
        if (!alive) return;
        // Scope may widen the result to all of the user's queries, so pin to THIS
        // query. At most one live quote per query (INV-07); take the latest version.
        const sent =
          (res.data ?? [])
            .filter((qt) => qt.queryId === query.id)
            .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
        setQuote(sent);
      })
      .catch((err) => toast.error(err?.message || "Couldn't load the quote"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query.id]);

  // Both fetchers RETURN state rather than setting it, so the effects below set it inside
  // a promise callback — a synchronous setState in an effect body cascades renders.
  const fetchLinkState = useCallback(
    (quotationId) =>
      approvalService
        .getApprovalLink(quotationId)
        .then((res) => res.data ?? EMPTY_LINK_STATE)
        // Not being able to read the link status must never break the review itself.
        .catch(() => EMPTY_LINK_STATE),
    [],
  );
  const fetchCopies = useCallback(
    (quotationId) =>
      documentService
        .listDocuments("quotation", quotationId)
        .then((res) => (res.data ?? []).filter((d) => d.docType === ACCEPTANCE_DOC_TYPE))
        .catch(() => []),
    [],
  );

  useEffect(() => {
    if (!quote?.id) return undefined;
    let alive = true;
    if (canShare) fetchLinkState(quote.id).then((s) => alive && setLinkState(s));
    fetchCopies(quote.id).then((c) => alive && setCopies(c));
    return () => {
      alive = false;
    };
  }, [canShare, quote?.id, fetchLinkState, fetchCopies]);

  const copyLink = async (token) => {
    const url = approvalService.approvalUrlFor(token);
    try {
      await navigator.clipboard.writeText(
        `Please review and approve quotation ${quote.referenceNo}: ${url}`,
      );
      setCopied(true);
      toast.success("Approval link copied — paste it to the customer");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard needs a secure context; the link stays on screen to select by hand.
      toast.error("Couldn't copy — select the link below and copy it manually");
    }
  };

  // A link without a claim: the customer has not said yes yet, they are being asked.
  const issueLink = async () => {
    setLinkBusy(true);
    try {
      const res = await approvalService.issueApprovalLink(quote.id);
      // The one moment the plaintext token exists on the client. Copy it straight away
      // so the BDO is never left holding a link they cannot see again.
      setLinkToken(res.data.token);
      await copyLink(res.data.token);
      setLinkState(await fetchLinkState(quote.id));
    } catch (err) {
      toast.error(err?.message || "Couldn't create the approval link");
    } finally {
      setLinkBusy(false);
    }
  };

  // The customer said yes: record it AND mint the link in one call. Still not an
  // approval — the shipment is created when the customer confirms.
  const recordAcceptance = async () => {
    if (!acceptVia) return toast.error("Pick how the customer told you");
    setRecording(true);
    try {
      const res = await approvalService.recordAcceptance(quote.id, {
        via: acceptVia,
        note: acceptNote.trim() || undefined,
      });
      setQuote((q) => ({
        ...q,
        acceptanceClaimedVia: acceptVia,
        acceptanceClaimedAt: new Date().toISOString(),
        acceptanceClaimNote: acceptNote.trim() || null,
      }));
      setLinkToken(res.data.token);
      await copyLink(res.data.token);
      setLinkState(await fetchLinkState(quote.id));
      setAcceptVia("");
      setAcceptNote("");
      toast.success(res?.message || "Acceptance recorded — send the customer the link");
    } catch (err) {
      toast.error(err?.message || "Couldn't record the acceptance");
    } finally {
      setRecording(false);
    }
  };

  const revokeLink = async () => {
    setLinkBusy(true);
    try {
      const res = await approvalService.revokeApprovalLink(quote.id);
      setLinkToken(null);
      toast.success(res?.message || "Approval link cancelled");
      setLinkState(await fetchLinkState(quote.id));
    } catch (err) {
      toast.error(err?.message || "Couldn't cancel the link");
    } finally {
      setLinkBusy(false);
    }
  };

  // Record the give-out without closing the dialog — the BDO often records the
  // customer's yes right after relaying the quote on the same call.
  const doShare = async () => {
    if (!shareChannel) return toast.error("Pick how you gave the quote to the customer");
    setSharing(true);
    try {
      const res = await onShare(quote.id, { channel: shareChannel, note: shareNote.trim() || undefined });
      setQuote((q) => ({ ...q, ...res.data }));
      setShareChannel("");
      setShareNote("");
      toast.success(res?.message || "Recorded — quote given to the customer");
    } catch (err) {
      toast.error(err?.message || "Couldn't record it");
    } finally {
      setSharing(false);
    }
  };

  const uploadSignedCopy = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      await documentService.uploadDocument({
        file,
        ownerType: "quotation",
        ownerId: quote.id,
        docType: ACCEPTANCE_DOC_TYPE,
      });
      toast.success("Signed copy uploaded — Ops will verify it");
      setCopies(await fetchCopies(quote.id));
    } catch (err) {
      toast.error(err?.message || "Couldn't upload the signed copy");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Verifying the signed copy IS the approval: the server creates the shipment in the
  // same transaction, so a success here closes the dialog with the shipment ref.
  const verifyCopy = async (doc, status) => {
    if (status === "rejected" && copyRejectNote.trim().length < 3) {
      return toast.error("Say why it is not acceptable — the uploader is told this");
    }
    setVerifyingId(doc.id);
    try {
      const res = await documentService.verifyDocument(doc.id, {
        status,
        note: status === "rejected" ? copyRejectNote.trim() : undefined,
      });
      if (status === "verified") {
        await onVerified?.(res);
        return;
      }
      toast.success(res?.message || "Signed copy rejected");
      setRejectingCopy(null);
      setCopyRejectNote("");
      setCopies(await fetchCopies(quote.id));
    } catch (err) {
      toast.error(err?.message || "Couldn't update the signed copy");
    } finally {
      setVerifyingId(null);
    }
  };

  const decide = async () => {
    if (pending || !quote) return;
    if (reason.trim().length < 3) return toast.error("A reason is required");
    setDecidingAs("reject");
    try {
      await onReject(quote, reason.trim());
    } finally {
      // A successful decision unmounts this dialog, so this only matters on failure —
      // which is exactly when the buttons have to come back.
      setDecidingAs(null);
    }
  };

  const closeIfIdle = () => {
    if (!pending) onClose();
  };

  const route = routeOf(query);
  const expired = quote?.validityDate && new Date(quote.validityDate) < new Date();
  const claimed = !!quote?.acceptanceClaimedAt;
  const verifiedCopy = copies.find((d) => d.verificationStatus === "verified");

  return (
    <Modal isOpen onClose={closeIfIdle} disableOverlayClose={pending}>
      <ModalContent maxWidth="max-w-2xl" className="flex max-h-[90vh] flex-col">
        <ModalHeader title={`Review quote · ${query.referenceNo}`} onClose={closeIfIdle} />

        {/* `min-w-0` so a wide child (the charge table, a long note) is clipped and
            scrolled by its own wrapper instead of stretching the body past the modal. */}
        <ModalBody className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            {query.customerCompany}
            {route ? ` · ${route}` : ""} —{" "}
            {canVerify
              ? "the shipment is created when the customer confirms, or when you verify their signed copy."
              : "the shipment is created only when the customer confirms it themselves."}
          </p>

          {loading ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Spinner size="lg" label="Loading the quote…" />
            </div>
          ) : !quote ? (
            <EmptyState
              icon={<FileX2 className="h-8 w-8 opacity-40" />}
              title="No sent quote found"
              description="Nothing has been sent to the customer for this query yet."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-primary">{quote.referenceNo}</span>
                <span className="text-sm text-muted-foreground">
                  {quote.validityDate ? `Valid until ${fmtDate(quote.validityDate)}` : "No expiry"}
                </span>
              </div>

              {/* `className` is the responsive wrapper — bounding it there is what makes
                  a wide charge line scroll inside the table rather than widen the modal. */}
              <Table dense bordered className="w-full min-w-0 max-w-full">
                <THead>
                  <TRow>
                    <TH>Description</TH>
                    <TH className="text-right">Qty</TH>
                    <TH className="text-right">Unit</TH>
                    <TH className="text-right">Amount</TH>
                  </TRow>
                </THead>
                <TBody>
                  {(quote.chargeLines ?? []).map((l) => (
                    <TRow key={l.id ?? l.sortOrder}>
                      <TD>{l.description}</TD>
                      <TD className="text-right">{Number(l.quantity)}</TD>
                      <TD className="text-right">{money(l.unitPrice, quote.currency)}</TD>
                      <TD className="text-right">{money(l.amount, quote.currency)}</TD>
                    </TRow>
                  ))}
                </TBody>
              </Table>

              <div className="text-right text-sm font-semibold">
                Total: {money(quote.totalAmount, quote.currency)}
              </div>

              {expired && (
                <Callout type="error" title="This quote has passed its validity date">
                  Ops must revise it before the customer can approve it.
                </Callout>
              )}

              {/* ── Customer acceptance — the whole story in one place ── */}
              {mode === "view" && (
                <div className="min-w-0 space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium">
                      <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Customer acceptance
                    </span>
                    {linkState.active && (
                      <span className="min-w-0 text-xs text-muted-foreground">
                        Link active until {fmtDate(linkState.active.expiresAt)}
                      </span>
                    )}
                  </div>

                  {/* Where things stand, in one line each. */}
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {quote.sharedAt && (
                      <p className="min-w-0 wrap-break-word">
                        Given via {QUOTE_SHARE_CHANNEL_LABELS[quote.sharedVia] ?? quote.sharedVia} on{" "}
                        {fmtDate(quote.sharedAt)}
                        {quote.shareNote ? ` — ${quote.shareNote}` : ""}
                      </p>
                    )}
                    {claimed && (
                      <p className="min-w-0 wrap-break-word font-medium text-amber-700 dark:text-amber-300">
                        Customer said yes via{" "}
                        {QUOTE_SHARE_CHANNEL_LABELS[quote.acceptanceClaimedVia] ?? quote.acceptanceClaimedVia} on{" "}
                        {fmtDate(quote.acceptanceClaimedAt)} — awaiting their confirmation
                        {quote.acceptanceClaimNote ? ` — ${quote.acceptanceClaimNote}` : ""}
                      </p>
                    )}
                    {!claimed && !quote.sharedAt && !copies.length && (
                      <p>
                        Nothing recorded yet. The customer confirms through a one-time link, on the
                        portal, or by signing the quote — their name, email and IP (or the signed
                        scan) are kept as the evidence behind the order.
                      </p>
                    )}
                  </div>

                  {linkState.lastDecision?.decidedAt && (
                    <Callout
                      type={linkState.lastDecision.decision === "approved" ? "success" : "info"}
                      title={`${linkState.lastDecision.decision === "approved" ? "Approved" : "Sent back"} by ${linkState.lastDecision.approverName}`}
                    >
                      {linkState.lastDecision.approverEmail} ·{" "}
                      {new Date(linkState.lastDecision.decidedAt).toLocaleString()}
                    </Callout>
                  )}

                  {canShare && (
                    <>
                      {/* Row 1 — the quote went out. Purely informational. */}
                      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                        <div className="min-w-0">
                          <Select
                            size="sm"
                            value={shareChannel}
                            onValueChange={setShareChannel}
                            options={SHARE_OPTIONS}
                            placeholder="Given via…"
                            disabled={pending}
                            className="w-full"
                            containerClassName="w-full"
                          />
                        </div>
                        <div className="min-w-0">
                          <Input
                            size="sm"
                            placeholder="Note (optional)"
                            maxLength={500}
                            value={shareNote}
                            disabled={pending}
                            onChange={(e) => setShareNote(e.target.value)}
                            wrapperClassName="w-full"
                            inputClassName="w-full"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={pending}
                          loading={sharing}
                          loadingText="Recording…"
                          onClick={doShare}
                          iconBefore={<Share2 className="h-3.5 w-3.5" />}
                        >
                          {quote.sharedAt ? "Record again" : "Mark as given"}
                        </Button>
                      </div>

                      {/* Row 2 — the customer said yes. Records the claim and mints the
                          link in one go; the shipment still waits for the customer. */}
                      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                        <div className="min-w-0">
                          <Select
                            size="sm"
                            value={acceptVia}
                            onValueChange={setAcceptVia}
                            options={SHARE_OPTIONS}
                            placeholder="Accepted via…"
                            disabled={pending || expired}
                            className="w-full"
                            containerClassName="w-full"
                          />
                        </div>
                        <div className="min-w-0">
                          <Input
                            size="sm"
                            placeholder="What they said (optional)"
                            maxLength={500}
                            value={acceptNote}
                            disabled={pending || expired}
                            onChange={(e) => setAcceptNote(e.target.value)}
                            wrapperClassName="w-full"
                            inputClassName="w-full"
                          />
                        </div>
                        <Button
                          type="button"
                          size="xs"
                          disabled={pending || expired}
                          loading={recording}
                          loadingText="Recording…"
                          onClick={recordAcceptance}
                          iconBefore={<Check className="h-3.5 w-3.5" />}
                        >
                          {claimed ? "Record again + new link" : "Record acceptance + link"}
                        </Button>
                      </div>

                      {/* The plaintext link exists only while this dialog is open — the
                          server returns it once. Shown so it can still be selected by
                          hand if the clipboard is unavailable. */}
                      {linkToken && (
                        <p className="min-w-0 wrap-break-word rounded-md border border-border bg-background p-2 font-mono text-[11px]">
                          {approvalService.approvalUrlFor(linkToken)}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={pending || expired}
                          loading={linkBusy}
                          loadingText="Working…"
                          onClick={issueLink}
                          iconBefore={<Link2 className="h-3.5 w-3.5" />}
                          title="Send the customer a link to decide, without recording a yes"
                        >
                          {linkState.active ? "Replace link only" : "Link only (customer decides)"}
                        </Button>
                        {linkToken && (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={pending}
                            onClick={() => copyLink(linkToken)}
                            iconBefore={<Copy className="h-3.5 w-3.5" />}
                          >
                            {copied ? "Copied" : "Copy again"}
                          </Button>
                        )}
                        {linkState.active && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={pending}
                            onClick={revokeLink}
                            iconBefore={<Trash2 className="h-3.5 w-3.5" />}
                          >
                            Cancel link
                          </Button>
                        )}
                      </div>

                      {linkState.active && !linkToken && (
                        <p className="text-[11px] text-muted-foreground">
                          A link is already live but its address is only shown once. Record the
                          acceptance again or use <b>Replace link</b> to issue a fresh one — the old
                          one stops working immediately.
                        </p>
                      )}
                    </>
                  )}

                  {/* ── The signed copy — the paper path ── */}
                  <div className="space-y-2 border-t border-border pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <FileCheck2 className="h-3.5 w-3.5" /> Signed copy
                        <span className="font-normal text-muted-foreground">
                          — {canVerify ? "verifying it creates the shipment" : "Ops verifies it, and that creates the shipment"}
                        </span>
                      </span>
                      {canShare && !verifiedCopy && (
                        <>
                          <input
                            ref={fileRef}
                            type="file"
                            accept="application/pdf,image/png,image/jpeg"
                            className="hidden"
                            disabled={pending || expired}
                            onChange={(e) => uploadSignedCopy(e.target.files?.[0])}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={pending || expired}
                            loading={uploading}
                            loadingText="Uploading…"
                            onClick={() => fileRef.current?.click()}
                            iconBefore={<Upload className="h-3.5 w-3.5" />}
                          >
                            Upload signed quote
                          </Button>
                        </>
                      )}
                    </div>

                    {copies.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">No signed copy uploaded.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {copies.map((d) => {
                          const mine = d.uploadedById === currentUserId;
                          const decidable = canVerify && !mine && d.verificationStatus === "unverified";
                          return (
                            <li key={d.id} className="min-w-0 rounded-md border border-border bg-background p-2 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="min-w-0 truncate font-medium" title={d.fileName}>
                                  {d.fileName}
                                </span>
                                <span
                                  className={
                                    d.verificationStatus === "verified"
                                      ? "text-success"
                                      : d.verificationStatus === "rejected"
                                        ? "text-destructive"
                                        : "text-amber-700 dark:text-amber-300"
                                  }
                                >
                                  {d.verificationStatus === "verified"
                                    ? "Verified"
                                    : d.verificationStatus === "rejected"
                                      ? "Rejected"
                                      : "Awaiting verification"}
                                </span>
                              </div>
                              {d.verificationNote && (
                                <p className="mt-1 wrap-break-word text-muted-foreground">{d.verificationNote}</p>
                              )}
                              {canVerify && mine && d.verificationStatus === "unverified" && (
                                <p className="mt-1 text-muted-foreground">
                                  You uploaded this — a colleague has to verify it.
                                </p>
                              )}
                              {decidable && (
                                <div className="mt-2 space-y-2">
                                  {rejectingCopy === d.id && (
                                    <Input
                                      size="sm"
                                      placeholder="Why it is not acceptable (the uploader is told this)"
                                      maxLength={500}
                                      value={copyRejectNote}
                                      disabled={pending}
                                      autoFocus
                                      onChange={(e) => setCopyRejectNote(e.target.value)}
                                      wrapperClassName="w-full"
                                      inputClassName="w-full"
                                    />
                                  )}
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      size="xs"
                                      disabled={pending || expired}
                                      loading={verifyingId === d.id && rejectingCopy !== d.id}
                                      loadingText="Creating shipment…"
                                      onClick={() => verifyCopy(d, "verified")}
                                      iconBefore={<Check className="h-3.5 w-3.5" />}
                                    >
                                      Verify — create shipment
                                    </Button>
                                    {rejectingCopy === d.id ? (
                                      <>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="xs"
                                          className="text-destructive"
                                          disabled={pending}
                                          loading={verifyingId === d.id}
                                          loadingText="Rejecting…"
                                          onClick={() => verifyCopy(d, "rejected")}
                                          iconBefore={<X className="h-3.5 w-3.5" />}
                                        >
                                          Confirm reject
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="xs"
                                          disabled={pending}
                                          onClick={() => { setRejectingCopy(null); setCopyRejectNote(""); }}
                                        >
                                          Back
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="xs"
                                        className="text-muted-foreground hover:text-destructive"
                                        disabled={pending}
                                        onClick={() => setRejectingCopy(d.id)}
                                        iconBefore={<X className="h-3.5 w-3.5" />}
                                      >
                                        Reject copy
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {mode === "reject" && (
                <Input
                  id="dq-reason"
                  type="textarea"
                  rows={3}
                  label="Rejection reason"
                  value={reason}
                  disabled={pending}
                  autoFocus
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What did the customer want changed?"
                  helperText="Ops sees this when they revise the quote."
                  wrapperClassName="w-full min-w-0"
                  // A bare textarea sizes itself from `cols`, and stays resizable in both
                  // directions — either one lets the user drag it past the modal edge.
                  textareaClassName="w-full resize-y"
                />
              )}
            </>
          )}
        </ModalBody>

        {/* Outside the quote branch, so Close stays reachable while loading and when no
            quote was found. There is no Approve button: nobody here approves (ADR-056). */}
        <ModalFooter>
          {mode === "view" ? (
            <>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                Close
              </Button>
              {quote && canReject && (
                <Button
                  type="button"
                  variant="default"
                  className=" bg-destructive! hover:bg-destructive/10"
                  disabled={pending}
                  onClick={() => setMode("reject")}
                  iconBefore={<X className="h-4 w-4" />}
                >
                  Reject for customer
                </Button>
              )}
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setMode("view")} disabled={pending}>
                Back
              </Button>
              <Button
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={pending}
                loading={decidingAs === "reject"}
                loadingText="Rejecting…"
                onClick={decide}
                iconBefore={<X className="h-4 w-4" />}
              >
                Confirm reject
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default DecideQuoteDialog;
