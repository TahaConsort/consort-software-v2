/**
 * Socket.IO client (ADR-007, WORKFLOW §7). Real-time is purely additive —
 * events are invalidation hints, never authoritative state (EDGE-T-05), so the
 * app is fully usable without it.
 *
 * `socket.io-client` is imported DYNAMICALLY: the user installs it manually, so
 * if it is absent connectSocket() resolves to null and nothing breaks. Install
 * with:  npm i socket.io-client
 */
let socket = null;
let connecting = null;

// Listeners/joins registered BEFORE the socket finishes connecting are parked
// here and replayed once it exists — pages mount faster than the dynamic
// import resolves, and silently dropping their subscriptions broke live
// tracking (WORKFLOW §10's v1 failure mode).
const pendingListeners = new Set(); // { event, handler }
const joinedRooms = new Set(); // "type:id" — re-joined on (re)connect

const SOCKET_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000/api").replace(/\/api\/?$/, "");

const replayOnto = (s) => {
  for (const l of pendingListeners) s.on(l.event, l.handler);
  for (const room of joinedRooms) {
    const [type, ...rest] = room.split(":");
    s.emit("room:join", { type, id: rest.join(":") });
  }
};

export const connectSocket = async (token) => {
  if (socket?.connected) return socket;
  if (connecting) return connecting;

  connecting = (async () => {
    let io;
    try {
      // Variable specifier + @vite-ignore so the bundler doesn't try to resolve
      // socket.io-client at build time (the user installs it manually).
      const pkg = "socket.io-client";
      ({ io } = await import(/* @vite-ignore */ pkg));
    } catch {
      console.warn("socket.io-client not installed — live updates disabled (REST unaffected).");
      connecting = null;
      return null;
    }
    socket = io(SOCKET_URL, {
      auth: { token },
      withCredentials: true,
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    replayOnto(socket);
    // On every (re)connect, re-join resource rooms (WORKFLOW §7.3 reconnect rule).
    socket.on("connect", () => {
      for (const room of joinedRooms) {
        const [type, ...rest] = room.split(":");
        socket.emit("room:join", { type, id: rest.join(":") });
      }
    });
    connecting = null;
    return socket;
  })();

  return connecting;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  joinedRooms.clear();
};

/**
 * Subscribe to an event; returns an unsubscribe fn. Safe to call before the
 * socket connects — the listener is parked and attached on connect.
 */
export const onSocket = (event, handler) => {
  const entry = { event, handler };
  pendingListeners.add(entry);
  if (socket) socket.on(event, handler);
  return () => {
    pendingListeners.delete(entry);
    socket?.off(event, handler);
  };
};

/**
 * Join a resource room (e.g. joinRoom("shipment", id)) — re-authorised
 * server-side, re-joined automatically on reconnect. Returns a leave fn.
 */
export const joinRoom = (type, id) => {
  if (!type || !id) return () => {};
  const key = `${type}:${id}`;
  joinedRooms.add(key);
  socket?.emit("room:join", { type, id });
  return () => {
    joinedRooms.delete(key);
    socket?.emit("room:leave", { type, id });
  };
};

export const emitSocket = (event, payload) => {
  socket?.emit(event, payload);
};
