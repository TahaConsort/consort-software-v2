export class AppError extends Error {
  /**
   * @param details optional machine-readable fields merged into the response body, for
   *   refusals a client can act on rather than only display. The optimistic-concurrency
   *   gates use it to return the CURRENT `rowVersion` on a 412/428, which lets the client
   *   refetch and retry once by itself instead of telling the user to reload the page.
   *   Only ever put data the caller is already entitled to see here.
   */
  constructor(message, statusCode, details) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.details = details ?? null;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const globalErrorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const status = err.status || "error";

  // 🔥 SERVER LOG
  console.error("🔥 ERROR LOG START");
  console.error("Time:", new Date().toISOString());
  console.error("Message:", err.message);
  console.error("Status:", status);
  console.error("Stack:", err.stack);
  console.error("Path:", req.originalUrl);
  console.error("Method:", req.method);
  console.error("Body:", req.body);
  console.error("🔥 ERROR LOG END");

  // Unexpected (non-operational) errors must never leak internals — Prisma
  // invocations, stack fragments, setup instructions — to the client. The full
  // detail is in the server log above; the user gets a safe generic message.
  const isOperational = err.isOperational || (err.statusCode && err.statusCode < 500);
  const message = isOperational
    ? err.message
    : "Something went wrong on our side — please try again. Nothing was saved.";

  res.status(statusCode).json({
    success: false,
    status,
    message,
    // Only for operational errors: a 500's internals must never reach the client.
    ...(isOperational && err.details ? err.details : {}),
  });
};