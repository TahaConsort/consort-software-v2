/**
 * Socket.IO emitter registry (ADR-007).
 *
 * Holds the live `io` instance once the gateway is initialised and exposes tiny
 * emit helpers used across the app (the outbox relay, chat). Every helper is a
 * SAFE NO-OP until `setIO` is called — so the REST API is complete without
 * sockets (ADR-007 §Consequences) and the process never crashes when
 * `socket.io` is not installed yet (the user installs packages manually).
 *
 * Rooms (WORKFLOW §7.1): user:{id}, role:{role}, dept:{id}, customer:{id},
 * shipment:{id}, channel:{id} — all assigned server-side from the token.
 */

let io = null;

export const setIO = (instance) => {
  io = instance;
};

export const getIO = () => io;

/** Emit to a single room (no-op until the gateway is up). */
export const emitToRoom = (room, event, payload) => {
  if (!io) return;
  io.to(room).emit(event, payload);
};

/** Emit to several rooms at once. */
export const emitToRooms = (rooms, event, payload) => {
  if (!io) return;
  for (const r of [...new Set(rooms)].filter(Boolean)) io.to(r).emit(event, payload);
};

export const emitToUser = (userId, event, payload) =>
  emitToRoom(`user:${userId}`, event, payload);

/**
 * Force-disconnect every live socket of a user (EDGE-A-04). Rooms are
 * server-assigned from the verified token, so user:{id} holds all their
 * connections. No-op until the gateway is up.
 */
export const forceDisconnectUser = (userId) => {
  if (!io) return;
  io.in(`user:${userId}`).disconnectSockets(true);
};
