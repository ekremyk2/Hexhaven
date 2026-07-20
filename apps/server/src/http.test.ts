import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createHttpServer } from "./http.js";

async function listenEphemeral(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a bound TCP address");
  }
  return address.port;
}

describe("http", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("boots and GET /health returns 200 with ok:true and a numeric uptime", async () => {
    app = createHttpServer({ logLevel: "silent" });
    const port = await listenEphemeral(app);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { ok: boolean; uptime: number };
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("does not serve static/SPA fallback routes outside production", async () => {
    app = createHttpServer({ logLevel: "silent" });
    const port = await listenEphemeral(app);

    const response = await fetch(`http://127.0.0.1:${port}/some/client/route`);
    expect(response.status).toBe(404);
  });

  describe("serveClient (production static + SPA fallback)", () => {
    let clientDistDir: string | undefined;

    afterEach(async () => {
      if (clientDistDir) await rm(clientDistDir, { recursive: true, force: true });
      clientDistDir = undefined;
    });

    it("serves real files directly and falls back to index.html for unmatched GET routes", async () => {
      clientDistDir = await mkdtemp(path.join(tmpdir(), "hexhaven-client-dist-"));
      await writeFile(path.join(clientDistDir, "index.html"), "<!doctype html><title>hexhaven</title>");
      await writeFile(path.join(clientDistDir, "app.js"), "console.log('client bundle');");

      app = createHttpServer({ logLevel: "silent", serveClient: true, clientDistDir });
      const port = await listenEphemeral(app);

      // /health still wins over the wildcard static route.
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);

      // A real file under the dist dir is served as-is.
      const asset = await fetch(`http://127.0.0.1:${port}/app.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("client bundle");

      // An unmatched client-side route (e.g. a deep link) falls back to index.html.
      const deepLink = await fetch(`http://127.0.0.1:${port}/lobby/ABCDE`);
      expect(deepLink.status).toBe(200);
      expect(await deepLink.text()).toContain("<title>hexhaven</title>");
    });
  });
});
