import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";
import { setIO } from "./io.js";
import { getPermissionsForRole } from "../modules/auth/auth.middleware.js";
import {
  getUserDepartmentId,
  isMember,
  persistMessage,
  markChannelRead,
} from "../modules/chat/chat.service.js";

/**
 * Socket.IO gateway (ADR-007, WORKFLOW §7) — inter-department real-time.
 *
 * Rooms are assigned SERVER-SIDE from the verified token (user:{id}, role:{role},
 * dept:{id}, customer:{id}); clients may only request resource rooms
 * (channel:{id}, shipment:{id}), which are re-authorised on join.
 *
 * socket.io is imported DYNAMICALLY: the user installs it manually, so if it is
 * absent the gateway is skipped and the REST API keeps working unchanged
 * (ADR-007 §Consequences — REST is complete without sockets). Real-time is
 * purely additive: events are invalidation hints, never authoritative state.
 */
export const initSocket = async (httpServer) => {
  let Server;
  try {
    ({ Server } = await import("socket.io"));
  } catch {
    console.warn("⚠  socket.io not installed — real-time gateway disabled (REST unaffected). Run: npm i socket.io");
    return null;
  }

  const io = new Server(httpServer, {
    cors: {
      origin: [
        "https://consort-erp-client.vercel.app",
        "http://192.168.50.26:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ],
      credentials: true,
    },
  });

  // ── Auth handshake: verify JWT, re-check live user + token_version (EDGE-A-03) ──
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("UNAUTHORIZED"));

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        return next(new Error("UNAUTHORIZED"));
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.sub },
        select: {
          id: true, role: true, isActive: true, tokenVersion: true, customerId: true, email: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      if (!user || !user.isActive || decoded.tv !== user.tokenVersion) {
        return next(new Error("UNAUTHORIZED"));
      }

      const name = user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email;
      socket.data.user = { ...user, name, permissions: getPermissionsForRole(user.role) };
      next();
    } catch (err) {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user;

    // Server-assigned rooms (WORKFLOW §7.1) — never client-requested.
    socket.join(`user:${user.id}`);
    socket.join(`role:${user.role}`);
    if (user.customerId) socket.join(`customer:${user.customerId}`);
    const departmentId = await getUserDepartmentId(user.id);
    if (departmentId) socket.join(`dept:${departmentId}`);

    socket.emit("connected", { userId: user.id, role: user.role });

    // Client may request resource rooms — re-authorised here.
    socket.on("room:join", async ({ type, id } = {}) => {
      try {
        if (type === "channel" && (await isMember(id, user.id))) {
          socket.join(`channel:${id}`);
          socket.emit("room:joined", { type, id });
        } else if (type === "shipment") {
          // Shipment rooms are broadcast-only invalidation hints; membership is
          // re-checked on the REST fetch that follows, so joining is permissive.
          socket.join(`shipment:${id}`);
          socket.emit("room:joined", { type, id });
        } else if (type === "customer" && user.customerId === id) {
          // Portal clients re-join their own customer room on reconnect; it is
          // also auto-joined at connect, so this is an idempotent re-affirm.
          socket.join(`customer:${id}`);
          socket.emit("room:joined", { type, id });
        } else {
          socket.emit("error", { code: "FORBIDDEN" });
        }
      } catch {
        socket.emit("error", { code: "FORBIDDEN" });
      }
    });

    socket.on("room:leave", ({ type, id } = {}) => {
      if (type && id) socket.leave(`${type}:${id}`);
    });

    // chat:send over the socket — persists + broadcasts via the same path as REST.
    socket.on("chat:send", async ({ channelId, clientMessageId, body, replyToId } = {}) => {
      try {
        if (!channelId || !clientMessageId || !body) return;
        if (!user.permissions.includes("chat.send")) return;
        if (!(await isMember(channelId, user.id))) return;
        await persistMessage({ channelId, senderId: user.id, clientMessageId, body, replyToId });
      } catch (err) {
        socket.emit("error", { code: "CHAT_SEND_FAILED", message: err?.message });
      }
    });

    socket.on("chat:typing", async ({ channelId } = {}) => {
      if (channelId && (await isMember(channelId, user.id))) {
        socket.to(`channel:${channelId}`).emit("chat:typing", { channelId, userId: user.id, userName: user.name });
      }
    });

    socket.on("chat:markRead", async ({ channelId, lastReadMessageId } = {}) => {
      if (channelId && lastReadMessageId && (await isMember(channelId, user.id))) {
        await markChannelRead(channelId, user.id, lastReadMessageId);
      }
    });
  });

  setIO(io);
  console.log("Socket.IO gateway ready");
  return io;
};
