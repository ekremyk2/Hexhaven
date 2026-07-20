import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { startServer, type ServerHandle } from "./index.js";

function boundPort(handle: ServerHandle): number {
  const address = handle.app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a bound TCP address");
  }
  return address.port;
}

describe("index (boot + graceful shutdown)", () => {
  let handle: ServerHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("startServer boots http + ws hub together; GET /health responds 200", async () => {
    handle = await startServer({ port: 0, host: "127.0.0.1", logLevel: "silent" });
    const port = boundPort(handle);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; uptime: number };
    expect(body.ok).toBe(true);

    // the hub is attached to the same listener
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.terminate();
  });

  it("close() closes ws sockets and the http listener; a second close() is a no-op", async () => {
    handle = await startServer({ port: 0, host: "127.0.0.1", logLevel: "silent" });
    const port = boundPort(handle);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const socketClosed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await handle.close();
    await socketClosed;

    // listener is gone: connecting again must fail
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();

    await handle.close(); // idempotent — must not reject
  });
});
