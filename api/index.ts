import { Server, type Socket } from "socket.io";
import "dotenv/config";

/**
 * Chat socket server
 * - Uses process.env.PORT (fallback 3001)
 * - Uses process.env.ORIGIN (comma separated) or '*' as fallback
 * - Emits 'usersOnline' and 'chat:message' (matches frontend)
 */

const origins = (process.env.ORIGIN ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const corsOrigins = origins.length ? origins : ["*"];

const io = new Server({
  cors: {
    origin: corsOrigins
  }
});

const port = Number(process.env.PORT || 3001);

io.listen(port);
console.log(`Chat socket server is running on port ${port}`);
console.log(`Allowed origins: ${corsOrigins.join(", ")}`);

type OnlineUser = { socketId: string; userId: string};

type ChatMessagePayload = {
  userId?: string;
  message?: string;
  timestamp?: string;
  clientId?: string;
  displayName?: string;
};

let onlineUsers: OnlineUser[] = [];

// new: track users per meeting room
const roomUsers: Record<string, OnlineUser[]> = {};

/**
 * Socket.io connection handling
 */
io.on("connection", (socket: Socket) => {
  // register connection with empty userId until client announces
  onlineUsers.push({ socketId: socket.id, userId: "" });
  io.emit("usersOnline", onlineUsers);
  console.log("A user connected with id:", socket.id, "total online:", onlineUsers.length);

  // join specific meeting room
  socket.on("joinRoom", (roomRaw: any, userPayload: any) => {
    const room = (roomRaw ?? "").toString().trim();
    //console.log(`joinRoom received from socket ${socket.id} -> room="${roomRaw}" => trimmed="${room}"`);
    if (!room) return;
    socket.join(room);
    socket.data.room = room;

    let uid: string;

    if (!userPayload) {
      uid = socket.id;
    } else if (typeof userPayload === "string") {
      uid = userPayload;
    } else if (typeof userPayload === "object" && userPayload !== null) {
      uid = String(userPayload.uid ?? userPayload.userId ?? userPayload.id ?? "");
      if (!uid && name) uid = name;
    } else {
      uid = String(userPayload);
    }
    if (!uid) uid = socket.id;

    const users = roomUsers[room] ?? [];
    const existingIdx = users.findIndex(u => u.socketId === socket.id);
    if (existingIdx !== -1) {
      users[existingIdx] = { socketId: socket.id, userId: uid};
    } else {
      users.push({ socketId: socket.id, userId: uid});
    }
    roomUsers[room] = users;

    // store user info on socket for later reference
    socket.data.userId = uid;

    io.to(room).emit("usersOnline", roomUsers[room]);
    //console.log(`Socket ${socket.id} joined room ${room} as ${uid}`);
  });

  // leave specific meeting room
  socket.on("leaveRoom", (roomRaw: any) => {
    const room = (roomRaw ?? "").toString().trim();
    //console.log(`leaveRoom received from socket ${socket.id} -> room="${roomRaw}" => trimmed="${room}"`);
    if (!room) return;
    socket.leave(room);
    const users = roomUsers[room] ?? [];
    roomUsers[room] = users.filter(u => u.socketId !== socket.id);
    io.to(room).emit("usersOnline", roomUsers[room]);
    delete socket.data.room;
    delete socket.data.userId;
    //console.log(`Socket ${socket.id} left room ${room}`);
  });

  // handle incoming chat messages
  socket.on("chat:message", (payload: ChatMessagePayload & { room?: string }) => {
    const trimmedMessage = (payload?.message ?? "").toString().trim();
    if (!trimmedMessage) return;

    // determine room: prefer explicit payload.room, fallback to socket.data.room
    const room = payload.room ?? (socket.data && socket.data.room) ?? null;
    if (!room) {
      // if not in a room, ignore or broadcast globally (choose ignore)
      console.warn("chat:message received without room, ignoring");
      return;
    }

    const users = roomUsers[room] ?? [];
    const sender = users.find(user => user.socketId === socket.id) ?? null;

    const outgoingMessage = {
      userId: payload.userId ?? sender?.userId ?? socket.id,
      message: trimmedMessage,
      timestamp: payload.timestamp ?? new Date().toISOString(),
      clientId: payload.clientId ?? undefined
    };

    io.to(room).emit("chat:message", outgoingMessage);
    //console.log(`Relayed chat message to room ${room} from:`, outgoingMessage.userId);
  });

  // handle disconnection
  socket.on("disconnect", () => {
    // remove from global onlineUsers
    onlineUsers = onlineUsers.filter(user => user.socketId !== socket.id);

    // remove from roomUsers (if joined)
    const room = socket.data && socket.data.room;
    if (room) {
      const users = roomUsers[room] ?? [];
      roomUsers[room] = users.filter(u => u.socketId !== socket.id);
      io.to(room).emit("usersOnline", roomUsers[room]);
    }

    io.emit("usersOnline", onlineUsers);
    //console.log("A user disconnected with id:", socket.id, "total online:", onlineUsers.length);
  });
});