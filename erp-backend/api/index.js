// api/index.js
// Vercel serverless entry point.
// Vercel manages the HTTP server itself — we just export the Express app.
// DO NOT call app.listen() here.

import { connectDB } from "../config/db.js";
import app from "../app.js";

// Initialize DB connection on first cold start
await connectDB();

export default app;
