import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import {
  Button,
  Callout,
  Input,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TRow,
  Table,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import * as approvalService from "@/services/approvalService";
import { DEFAULT_CURRENCY } from "@/lib/catalog";

const money = (n, ccy) =>
  `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/** Why a link is unusable, in the customer's language. */
const DEAD_LINK_COPY = {
  revoked: "This approval link was cancelled by Consort. Please ask your contact there for a new one.",
  used: "This quotation has already been decided through this link. Consort has your response.",
  expired: "This approval link has expired. Please ask your Consort contact to send a new one.",
};

/**
 * The customer's approval page — ADR-055, reached from a one-time link and
 * nothing else. No account, no login: the token in the URL is the whole credential,
 * which is why the server hands back an allowlisted view with no cost, no vendor and
 * no internal ids on it.
 *
 * This exists so an approved quotation is provably the customer's decision rather than
 * an internal user clicking "approve on their behalf".
 */
const ApproveQuotePage = () => {
  const { token } = useParams();

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [mode, setMode] = useState("view"); // "view" | "reject"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(null); // null | "approved" | "rejected"
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    let alive = true;
    approvalService
      .viewApproval(token)
      .then((res) => alive && setQuote(res.data ?? null))
      .catch((err) => alive && setLoadError(err?.message || "This approval link is not valid."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token]);

  const submit = async (decision) => {
    if (submitting) return;
    if (name.trim().length < 2) return toast.error("Enter your name");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast.error("Enter a valid email address");
    if (decision === "rejected" && reason.trim().length < 3) {
      return toast.error("Tell us what needs to change so Consort can re-quote");
    }
    setSubmitting(decision);
    try {
      const res = await approvalService.submitApproval(token, {
        decision,
        approverName: name.trim(),
        approverEmail: email.trim(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setOutcome({ decision, message: res.message });
    } catch (err) {
      toast.error(err?.message || "Couldn't record your decision");
    } finally {
      setSubmitting(null);
    }
  };

  const shell = (children) => (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span>Consort — secure quotation approval</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div className="flex justify-center py-20 text-muted-foreground">
        <Spinner size="lg" label="Loading the quotation…" />
      </div>,
    );
  }

  if (loadError || !quote) {
    return shell(
      <Callout type="error" title="This link cannot be opened">
        {loadError || "This approval link is not valid."}
      </Callout>,
    );
  }

  // The decision landed — replace the form entirely so there is nothing left to click.
  if (outcome) {
    return shell(
      <Callout
        type={outcome.decision === "approved" ? "success" : "info"}
        title={outcome.decision === "approved" ? "Approved — thank you" : "Thank you for your feedback"}
      >
        {outcome.message}
      </Callout>,
    );
  }

  const dead = quote.state?.status && quote.state.status !== "open";
  const expiresAt = quote.state?.expiresAt ? new Date(quote.state.expiresAt) : null;

  return shell(
    <>
      <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">Quotation {quote.referenceNo}</h1>
          <span className="text-sm text-muted-foreground">
            {quote.validityDate
              ? `Valid until ${new Date(quote.validityDate).toLocaleDateString()}`
              : "No expiry date"}
          </span>
        </div>
        {(quote.pickupAddress || quote.destinationAddress) && (
          <p className="mt-1 min-w-0 wrap-break-word text-sm text-muted-foreground">
            {[quote.pickupAddress, quote.destinationAddress].filter(Boolean).join(" → ")}
          </p>
        )}

        <div className="mt-4">
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
              {(quote.chargeLines ?? []).map((l, i) => (
                <TRow key={i}>
                  <TD>{l.description}</TD>
                  <TD className="text-right">{Number(l.quantity)}</TD>
                  <TD className="text-right">{money(l.unitPrice, quote.currency)}</TD>
                  <TD className="text-right">{money(l.amount, quote.currency)}</TD>
                </TRow>
              ))}
            </TBody>
          </Table>
        </div>

        <div className="mt-3 text-right text-base font-semibold">
          Total: {money(quote.totalAmount, quote.currency)}
        </div>
      </div>

      {dead ? (
        <Callout type="warning" title="This link is no longer open">
          {DEAD_LINK_COPY[quote.state.status] ?? "Please ask your Consort contact for a new link."}
        </Callout>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-6">
          <div>
            <h2 className="text-sm font-medium">
              {mode === "reject" ? "Request a change" : "Confirm your decision"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Your name and email are recorded with the decision as proof of who approved it.
              {expiresAt ? ` This link expires on ${expiresAt.toLocaleDateString()}.` : ""}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              id="ap-name"
              label="Your name"
              value={name}
              disabled={!!submitting}
              onChange={(e) => setName(e.target.value)}
              placeholder="Who is approving"
              wrapperClassName="w-full min-w-0"
            />
            <Input
              id="ap-email"
              type="email"
              label="Your email"
              value={email}
              disabled={!!submitting}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              wrapperClassName="w-full min-w-0"
            />
          </div>

          {mode === "reject" && (
            <Input
              id="ap-reason"
              type="textarea"
              rows={3}
              label="What needs to change?"
              value={reason}
              disabled={!!submitting}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
              placeholder="Consort will send a revised quotation"
              wrapperClassName="w-full min-w-0"
              textareaClassName="w-full resize-y"
            />
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {mode === "view" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!submitting}
                  onClick={() => setMode("reject")}
                  iconBefore={<XCircle className="h-4 w-4" />}
                >
                  Request a change
                </Button>
                <Button
                  type="button"
                  disabled={!!submitting}
                  loading={submitting === "approved"}
                  loadingText="Approving…"
                  onClick={() => submit("approved")}
                  iconBefore={<CheckCircle2 className="h-4 w-4" />}
                >
                  Approve this quotation
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={!!submitting} onClick={() => setMode("view")}>
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={!!submitting}
                  loading={submitting === "rejected"}
                  loadingText="Sending…"
                  onClick={() => submit("rejected")}
                  iconBefore={<XCircle className="h-4 w-4" />}
                >
                  Send this back to Consort
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Approving creates a binding order with Consort. If you did not expect this link, please
        ignore it and contact your Consort representative.
      </p>
    </>,
  );
};

export default ApproveQuotePage;
