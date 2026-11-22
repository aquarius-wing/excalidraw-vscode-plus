import * as http from "http";
import { Server as SocketIO } from "socket.io";

// Embedded copy of the excalidraw-room relay (MIT, excalidraw/excalidraw-room).
// Pure message relay: it never sees plaintext, the room key stays in the link.

const MARKER = "Excalidraw collaboration server is up :)";
let server: http.Server | undefined;
let io: SocketIO | undefined;

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body.includes(MARKER)));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

function attach(io: SocketIO) {
  io.on("connection", (socket) => {
    io.to(socket.id).emit("init-room");
    socket.on("join-room", async (roomID: string) => {
      await socket.join(roomID);
      const sockets = await io.in(roomID).fetchSockets();
      if (sockets.length <= 1) {
        io.to(socket.id).emit("first-in-room");
      } else {
        socket.broadcast.to(roomID).emit("new-user", socket.id);
      }
      io.in(roomID).emit("room-user-change", sockets.map((s) => s.id));
    });
    socket.on("server-broadcast", (roomID: string, data: ArrayBuffer, iv: Uint8Array) => {
      socket.broadcast.to(roomID).emit("client-broadcast", data, iv);
    });
    socket.on("server-volatile-broadcast", (roomID: string, data: ArrayBuffer, iv: Uint8Array) => {
      socket.volatile.broadcast.to(roomID).emit("client-broadcast", data, iv);
    });
    socket.on("user-follow", async (p: { userToFollow: { socketId: string }; action: "FOLLOW" | "UNFOLLOW" }) => {
      const roomID = `follow@${p.userToFollow.socketId}`;
      if (p.action === "FOLLOW") await socket.join(roomID);
      else await socket.leave(roomID);
      const followedBy = (await io.in(roomID).fetchSockets()).map((s) => s.id);
      io.to(p.userToFollow.socketId).emit("user-follow-room-change", followedBy);
    });
    socket.on("disconnecting", async () => {
      for (const roomID of Array.from(socket.rooms)) {
        const others = (await io.in(roomID).fetchSockets()).filter((s) => s.id !== socket.id);
        const isFollow = roomID.startsWith("follow@");
        if (!isFollow && others.length > 0) {
          socket.broadcast.to(roomID).emit("room-user-change", others.map((s) => s.id));
        }
        if (isFollow && others.length === 0) {
          io.to(roomID.replace("follow@", "")).emit("broadcast-unfollow");
        }
      }
    });
    socket.on("disconnect", () => {
      socket.removeAllListeners();
      socket.disconnect();
    });
  });
}

/**
 * Make sure a relay answers on serverUrl. Only local URLs are started.
 * Returns a human-readable note when something was started or is wrong.
 */
export async function ensureLocalRelay(serverUrl: string): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return `Invalid relay URL: ${serverUrl}`;
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return undefined;
  const port = Number(url.port || 80);
  if (server?.listening) return undefined;
  if (await probe(port)) return undefined; // already running (other window or manual)

  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(MARKER);
    });
    s.once("error", (e: NodeJS.ErrnoException) =>
      resolve(
        e.code === "EADDRINUSE"
          ? `Port ${port} is in use by another program, not an Excalidraw relay.`
          : `Cannot start relay: ${e.message}`
      )
    );
    s.listen(port, () => {
      server = s;
      io = new SocketIO(s, {
        transports: ["websocket", "polling"],
        cors: { origin: "*", allowedHeaders: ["Content-Type", "Authorization"], credentials: true },
        allowEIO3: true,
      });
      attach(io);
      resolve(`Started local collaboration relay on port ${port}.`);
    });
  });
}

export function stopRelay() {
  io?.close();
  server?.close();
  io = undefined;
  server = undefined;
}
