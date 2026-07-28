/**
 * Front-end link builders for auth flows (activation, password reset, portal
 * invite). The base URL is the customer-facing SPA, NOT this API — the token is
 * consumed by a page (e.g. /activate), which then calls the API.
 *
 * Configure with APP_URL; falls back to the deployed client in production and
 * the Vite dev server otherwise. Trailing slashes are trimmed so we never emit
 * a `//activate`.
 */
const appBaseUrl = () => {
  const configured = process.env.APP_URL;
  const fallback =
    process.env.NODE_ENV === "production"
      ? "https://consort-erp-client.vercel.app"
      : "http://localhost:5173";
  return (configured || fallback).replace(/\/+$/, "");
};

// e.g. buildAuthLink("/activate", raw) → https://app.example.com/activate?token=<raw>
export const buildAuthLink = (path, token) =>
  `${appBaseUrl()}${path}?token=${encodeURIComponent(token)}`;

export const buildActivationLink = (token) => buildAuthLink("/activate", token);
export const buildResetPasswordLink = (token) => buildAuthLink("/reset-password", token);
