import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { Server as SocketIO } from "socket.io";

// Embedded copy of the excalidraw-room relay (MIT, excalidraw/excalidraw-room)
// plus static hosting for the bundled Excalidraw web app on the same port.
// Pure message relay: it never sees plaintext, the room key stays in the link.

const MARKER = "Excalidraw collaboration server is up :)";
const RELAY_HEADER = "x-excalidraw-relay";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

let server: http.Server | undefined;
let io: SocketIO | undefined;

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, (res) => {
      if (res.headers[RELAY_HEADER] === "1") {
        res.resume();
        return resolve(true);
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body.includes(MARKER)));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

function buildBrowserIndexHtml(template: string): string {
  const config = {
    content: [],
    contentType: "application/json",
    theme: "light",
    name: "Excalidraw Live",
    browserMode: true,
  };
  const b64Config = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  return template
    .replace("{{data-excalidraw-config}}", b64Config)
    .replace("{{excalidraw-asset-path}}", "./");
}

async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  resolvedWebRoot: string | undefined
) {
  if (req.url?.startsWith("/socket.io")) return;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request");
    return;
  }

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", [RELAY_HEADER]: "1" });
    res.end(req.method === "HEAD" ? undefined : MARKER);
    return;
  }

  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!resolvedWebRoot) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", [RELAY_HEADER]: "1" });
    res.end(req.method === "HEAD" ? undefined : MARKER);
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    try {
      const raw = await fs.promises.readFile(path.join(resolvedWebRoot, "index.html"), "utf8");
      const html = buildBrowserIndexHtml(raw);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        [RELAY_HEADER]: "1",
      });
      res.end(req.method === "HEAD" ? undefined : html);
    } catch {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", [RELAY_HEADER]: "1" });
      res.end(req.method === "HEAD" ? undefined : MARKER);
    }
    return;
  }

  const relPath = pathname.replace(/^\/+/, "");
  const target = path.resolve(resolvedWebRoot, relPath);
  if (target !== resolvedWebRoot && !target.startsWith(resolvedWebRoot + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";
    const cache = relPath.startsWith("assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    const data = await fs.promises.readFile(target);
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": cache });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
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
 * Make sure a local relay + web server answers on serverUrl. Only local URLs are started.
 * Returns a human-readable note when something was started or is wrong.
 */
export async function ensureLocalRelay(
  serverUrl: string,
  webRoot?: string
): Promise<string | undefined> {
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

  const resolvedWebRoot = webRoot ? path.resolve(webRoot) : undefined;

  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      void handleHttpRequest(req, res, resolvedWebRoot);
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
      resolve(`Started local collaboration server on port ${port}.`);
    });
  });
}

export function stopRelay() {
  io?.close();
  server?.close();
  io = undefined;
  server = undefined;
}
