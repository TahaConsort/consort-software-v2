/**
 * verifyMailer.js — prove the Gmail credentials before trusting the Quote button.
 *
 *   node scripts/verifyMailer.js                  # check config + authenticate only
 *   node scripts/verifyMailer.js you@example.com  # also send a real test email
 *
 * `.env` reaches process.env through Prisma's own loader (that is how DATABASE_URL and
 * PORT already arrive), so the prisma import below is load-bearing, not decoration.
 */
import "../config/prisma.js";
import { isMailConfigured, mailConfig, verifyMailer, sendMail } from "../config/mailer.js";
import { buildQuoteRequestEmail } from "../modules/vendor/vendor.mail.js";

const to = process.argv[2];

const c = mailConfig();
console.log("Mail configuration");
console.log("  host     :", c.host);
console.log("  port     :", c.port, c.secure ? "(implicit TLS)" : "(STARTTLS)");
console.log("  user     :", c.user || "(not set)");
console.log("  password :", c.password ? `${c.password.length} chars` : "(not set)");
console.log("  from     :", c.fromAddress ? `"${c.fromName}" <${c.fromAddress}>` : "(not set)");

if (!isMailConfigured()) {
  console.error("\n✗ Not configured. Set MAIL_USER and MAIL_PASSWORD in erp-backend/.env");
  console.error("  MAIL_PASSWORD must be a Google App Password, not your account password.");
  process.exit(1);
}
if (c.password.length !== 16) {
  console.warn(`\n! MAIL_PASSWORD is ${c.password.length} characters — Google App Passwords are 16.`);
}

const v = await verifyMailer();
if (!v.ok) {
  console.error("\n✗ Gmail rejected the credentials:", v.reason);
  console.error("  535 / 'Username and Password not accepted' almost always means a plain");
  console.error("  account password was used, or 2-Step Verification is off.");
  process.exit(1);
}
console.log("\n✓ Authenticated with Gmail.");

if (!to) {
  console.log("  Pass an address to send a test message: node scripts/verifyMailer.js you@example.com");
  process.exit(0);
}

const { subject, text, html } = buildQuoteRequestEmail(
  { name: "Test Vendor", referenceNo: "VEN-TEST", contactName: "Test Contact", email: to },
  { name: "Mailer check", email: c.user },
  "This is a test of the vendor rate-request email. No reply needed.",
);

const r = await sendMail({ to, subject, text, html });
console.log(`✓ Sent to ${to}`);
console.log("  messageId:", r.messageId);
if (r.rejected?.length) console.warn("  rejected :", r.rejected);
process.exit(0);
