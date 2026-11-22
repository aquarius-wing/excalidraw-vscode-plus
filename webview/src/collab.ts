import { io, Socket } from "socket.io-client";
import {
  CaptureUpdateAction,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

// Implements the same wire protocol as excalidraw.com live collaboration
// (excalidraw-room relay + AES-GCM end-to-end encryption), so browsers and
// excalidraw-room-mcp can join the same room.

export interface CollabStatus {
  active: boolean;
  link?: string;
  peers: number;
  state: "idle" | "connecting" | "connected" | "error";
  error?: string;
}

type Payload =
  | { type: "SCENE_INIT" | "SCENE_UPDATE"; payload: { elements: any[] } }
  | {
      type: "MOUSE_LOCATION";
      payload: {
        socketId: string;
        pointer: { x: number; y: number; tool: "pointer" | "laser" };
        button: "down" | "up";
        selectedElementIds: Record<string, true>;
        username: string;
      };
    };

const ROOM_LINK_RE = /#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)/;

export function parseRoomLink(link: string) {
  const m = link.match(ROOM_LINK_RE);
  return m ? { roomId: m[1], roomKey: m[2] } : null;
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function generateRoomKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 128 },
    true,
    ["encrypt", "decrypt"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return jwk.k!;
}

function importKey(k: string) {
  return crypto.subtle.importKey(
    "jwk",
    { alg: "A128GCM", ext: true, k, key_ops: ["encrypt", "decrypt"], kty: "oct" },
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt", "decrypt"]
  );
}

export class Collab {
  private socket?: Socket;
  private key?: CryptoKey;
  private roomId = "";
  private link = "";
  private initialized = false; // received scene (or we are first in room)
  private sent = new Map<string, number>(); // element id -> last synced version
  private collaborators = new Map<string, any>();
  private username = "VS Code";

  constructor(
    private api: () => ExcalidrawImperativeAPI | undefined,
    private onStatus: (s: CollabStatus) => void
  ) {}

  private status: CollabStatus = { active: false, peers: 0, state: "idle" };
  private setStatus(patch: Partial<CollabStatus>) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  async start(opts: {
    serverUrl: string;
    webUrl: string;
    username?: string;
    link?: string; // join an existing room
  }) {
    this.stop();
    this.username = opts.username || "VS Code";
    try {
      let roomId: string;
      let roomKey: string;
      const parsed = opts.link ? parseRoomLink(opts.link) : null;
      if (opts.link && !parsed) throw new Error("Invalid collaboration link");
      if (parsed) {
        ({ roomId, roomKey } = parsed);
        this.link = opts.link!;
      } else {
        roomId = toHex(crypto.getRandomValues(new Uint8Array(10)));
        roomKey = await generateRoomKey();
        this.link = `${opts.webUrl.replace(/\/+$/, "")}/#room=${roomId},${roomKey}`;
      }
      this.roomId = roomId;
      this.key = await importKey(roomKey);
      // Creating a room: we hold the scene. Joining: wait for a peer's scene.
      this.initialized = !parsed;
      this.sent.clear();
      this.setStatus({
        active: true,
        link: this.link,
        peers: 1,
        state: "connecting",
        error: undefined,
      });

      const socket = io(opts.serverUrl, { transports: ["websocket"] });
      this.socket = socket;
      socket.on("connect_error", (e) =>
        this.setStatus({ state: "error", error: `Cannot reach ${opts.serverUrl}: ${e.message}` })
      );
      socket.on("init-room", () => socket.emit("join-room", this.roomId));
      socket.on("first-in-room", () => {
        this.initialized = true;
        this.setStatus({ state: "connected" });
        this.syncAll();
      });
      socket.on("new-user", () => {
        // a peer joined: hand them the full scene
        this.broadcast({ type: "SCENE_INIT", payload: { elements: this.liveElements(true) } });
      });
      socket.on("room-user-change", (ids: string[]) => {
        for (const id of [...this.collaborators.keys()]) {
          if (!ids.includes(id)) this.collaborators.delete(id);
        }
        this.api()?.updateScene({ collaborators: new Map(this.collaborators) as any });
        this.setStatus({ peers: ids.length, state: this.initialized ? "connected" : "connecting" });
      });
      socket.on("client-broadcast", async (data: ArrayBuffer, iv: Uint8Array) => {
        try {
          await this.handle(await this.decrypt(data, iv));
        } catch (e) {
          console.warn("collab: failed to handle message", e);
        }
      });
    } catch (e) {
      this.stop();
      this.setStatus({ state: "error", error: (e as Error).message });
    }
  }

  stop() {
    this.socket?.disconnect();
    this.socket = undefined;
    this.collaborators.clear();
    this.api()?.updateScene({ collaborators: new Map() as any });
    this.initialized = false;
    this.status = { active: false, peers: 0, state: "idle" };
    this.onStatus(this.status);
  }

  getLink() {
    return this.link;
  }

  /** Called on every local scene change. Sends only changed elements. */
  onLocalChange(elements: readonly any[]) {
    if (!this.socket?.connected || !this.initialized) return;
    const changed = elements.filter((el) => this.sent.get(el.id) !== el.version);
    if (changed.length === 0) return;
    for (const el of changed) this.sent.set(el.id, el.version);
    this.broadcast({ type: "SCENE_UPDATE", payload: { elements: changed } });
  }

  onPointer(p: {
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "down" | "up";
  }) {
    if (!this.socket?.connected || !this.initialized) return;
    const api = this.api();
    this.broadcast(
      {
        type: "MOUSE_LOCATION",
        payload: {
          socketId: this.socket.id!,
          pointer: p.pointer,
          button: p.button,
          selectedElementIds: (api?.getAppState().selectedElementIds ?? {}) as any,
          username: this.username,
        },
      },
      true
    );
  }

  private liveElements(includeDeleted = false) {
    const els = this.api()?.getSceneElementsIncludingDeleted() ?? [];
    return includeDeleted ? [...els] : els.filter((e) => !e.isDeleted);
  }

  private syncAll() {
    const els = this.liveElements(true);
    for (const el of els) this.sent.set(el.id, el.version);
    this.broadcast({ type: "SCENE_INIT", payload: { elements: els } });
  }

  private async encrypt(data: Payload) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.key!,
      new TextEncoder().encode(JSON.stringify(data))
    );
    return { buf, iv };
  }

  private async decrypt(data: ArrayBuffer, iv: Uint8Array): Promise<Payload> {
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      this.key!,
      data
    );
    return JSON.parse(new TextDecoder().decode(buf));
  }

  private async broadcast(data: Payload, volatile = false) {
    if (!this.socket?.connected || !this.key) return;
    const { buf, iv } = await this.encrypt(data);
    this.socket.emit(volatile ? "server-volatile-broadcast" : "server-broadcast", this.roomId, buf, iv);
  }

  private async handle(msg: Payload) {
    const api = this.api();
    if (!api) return;
    switch (msg.type) {
      case "SCENE_INIT":
      case "SCENE_UPDATE": {
        const wasEmpty = api.getSceneElements().length === 0;
        const remote = restoreElements(msg.payload.elements as any, null);
        const merged = reconcileElements(
          api.getSceneElementsIncludingDeleted() as any,
          remote as any,
          api.getAppState() as any
        );
        // Remember versions so applied remote changes are not echoed back.
        for (const el of merged) this.sent.set(el.id, el.version);
        api.updateScene({
          elements: merged,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        if (msg.type === "SCENE_INIT" && !this.initialized) {
          this.initialized = true;
          this.setStatus({ state: "connected" });
          if (wasEmpty) {
            const live = merged.filter((e: any) => !e.isDeleted);
            if (live.length) api.scrollToContent(live, { fitToViewport: true });
          }
          // push anything we had locally that the room does not know yet
          this.onLocalChange(merged);
        }
        break;
      }
      case "MOUSE_LOCATION": {
        const { socketId, pointer, button, selectedElementIds, username } = msg.payload;
        this.collaborators.set(socketId, {
          pointer,
          button,
          selectedElementIds,
          username,
          socketId,
        });
        api.updateScene({ collaborators: new Map(this.collaborators) as any });
        break;
      }
    }
  }
}
