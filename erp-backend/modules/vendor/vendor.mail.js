/**
 * The one email the vendor directory sends: a request for rates.
 *
 * Kept beside the module rather than in a generic templates folder because it is the
 * only message here and its wording is the vendor relationship, not infrastructure.
 * Both a text and an HTML part go out — a text/plain alternative is what keeps this
 * out of the spam folder as reliably as anything else we control.
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * @param vendor   the party being asked
 * @param sender   the logged-in user making the request (name/email used to sign it)
 * @param message  optional free text from the requester, appended as their own words
 */
export const buildQuoteRequestEmail = (vendor, sender, message) => {
  const contact = vendor.contactName || vendor.name;
  const senderName = sender?.name || "The Consort team";
  const senderEmail = sender?.email || "";

  const subject = `Request for rates — ${vendor.referenceNo ?? vendor.name}`;

  const lines = [
    `Dear ${contact},`,
    "",
    "We would like to request your current rates for an upcoming shipment.",
    ...(message ? ["", message] : []),
    "",
    "Please reply to this email with your quotation, including validity and any charges not covered by the rate.",
    "",
    "Kind regards,",
    senderName,
    ...(senderEmail ? [senderEmail] : []),
    "Consort",
  ];
  const text = lines.join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;">
      <tr>
        <td style="padding:24px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Dear ${esc(contact)},</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
            We would like to request your current rates for an upcoming shipment.
          </p>
          ${message ? `<p style="margin:0 0 16px;padding:12px 16px;background:#f4f4f5;border-radius:8px;font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(message)}</p>` : ""}
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
            Please reply to this email with your quotation, including validity and any charges
            not covered by the rate.
          </p>
          <p style="margin:0;font-size:15px;line-height:1.6;">
            Kind regards,<br />
            <strong>${esc(senderName)}</strong><br />
            ${senderEmail ? `<a href="mailto:${esc(senderEmail)}" style="color:#2563eb;">${esc(senderEmail)}</a><br />` : ""}
            Consort
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
};
