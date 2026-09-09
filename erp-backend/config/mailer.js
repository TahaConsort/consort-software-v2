import nodemailer from "nodemailer";

/**
 * Outbound email — Gmail via nodemailer.
 *
 * Gmail will NOT accept an account password here: with 2-Step Verification on, you
 * generate a 16-character App Password (Google Account → Security → App passwords)
 * and put that in `MAIL_PASSWORD`. Spaces in it are ignored, so pasting it in the
 * grouped form Google displays is fine.
 *
 * Everything is read lazily rather than at import time, so the server still boots
 * with no mail credentials configured — an unconfigured install simply refuses to
 * send and says so, instead of crashing on startup or, worse, reporting success.
 */

let cached = null;

/** Gmail shows the App Password in four groups; the transport wants it unspaced. */
const cleanPassword = (v) => String(v ?? "").replace(/\s+/g, "");

export const mailConfig = () => ({
  host: process.env.MAIL_HOST || "smtp.gmail.com",
  port: Number(process.env.MAIL_PORT || 465),
  // 465 is implicit TLS; 587 upgrades with STARTTLS. Deriving this from the port
  // avoids the classic mismatch where both are set and disagree.
  secure: String(process.env.MAIL_SECURE ?? (Number(process.env.MAIL_PORT || 465) === 465)) === "true",
  user: process.env.MAIL_USER || "",
  password: cleanPassword(process.env.MAIL_PASSWORD),
  fromName: process.env.MAIL_FROM_NAME || "Consort",
  // Gmail rewrites the From header to the authenticated account unless the address
  // is a verified alias, so this defaults to the account itself.
  fromAddress: process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USER || "",
});

/** True once both credentials are present — the only thing callers need to branch on. */
export const isMailConfigured = () => {
  const c = mailConfig();
  return Boolean(c.user && c.password);
};

const transport = () => {
  if (cached) return cached;
  const c = mailConfig();
  cached = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.password },
  });
  return cached;
};

/** Drop the memoised transport so a credential change is picked up without a restart. */
export const resetMailer = () => {
  cached = null;
};

/**
 * Send one message. Throws a plain Error on a bad/absent configuration so the caller
 * can turn it into the right HTTP status rather than leaking SMTP detail to the client.
 */
export const sendMail = async ({ to, subject, text, html, replyTo }) => {
  if (!isMailConfigured()) {
    throw new Error("Email is not configured — set MAIL_USER and MAIL_PASSWORD in the server environment");
  }
  const c = mailConfig();
  const info = await transport().sendMail({
    from: c.fromAddress ? `"${c.fromName}" <${c.fromAddress}>` : undefined,
    to,
    subject,
    text,
    html,
    // Always the requesting user — `User.email` is non-nullable and every caller is
    // behind `protect`, so there is no case needing a configured fallback.
    replyTo: replyTo || undefined,
  });
  return { messageId: info.messageId, accepted: info.accepted ?? [], rejected: info.rejected ?? [] };
};

/** Proves the credentials against Gmail without sending anything. */
export const verifyMailer = async () => {
  if (!isMailConfigured()) return { ok: false, reason: "not_configured" };
  try {
    await transport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || "verify failed" };
  }
};
