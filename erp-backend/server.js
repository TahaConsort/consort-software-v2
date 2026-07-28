// server.js
import http from 'http';
import app from './app.js';
import { connectDB } from './config/db.js';
import { startOutboxRelay } from './jobs/outboxRelay.js';
import { startScheduler } from './jobs/scheduler.js';
import { initSocket } from './realtime/socket.js';

const PORT = process.env.PORT || 5000;

// Connect DB and start server (local dev only)
await connectDB();

// Only start the HTTP listener when running locally.
// On Vercel (serverless), the platform manages the server — we just export the app.
if (process.env.VERCEL !== '1') {
  const server = http.createServer(app);

  // Attach the Socket.IO gateway (skipped gracefully if socket.io isn't installed —
  // REST is complete without it, ADR-007). The user installs packages manually.
  await initSocket(server);

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Background workers need a resident process — local/VM only (ADR-021).
  // On serverless, drive them via an external cron hitting a drain endpoint.
  startOutboxRelay();
  startScheduler();
}

// Required by Vercel: export the Express app as the default export
export default app;
