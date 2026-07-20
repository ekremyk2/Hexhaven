// Fastify HTTP server: health check + (in production) the built client, served statically
// with an SPA fallback. docs/02-architecture.md §9 — single container, one port for both
// the static client and the ws endpoint attached in wsHub.ts.
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import pino, { type LevelWithSilent } from "pino";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// apps/server/src/http.ts (dev, via tsx) and apps/server/dist/http.js (built) are both two
// levels below apps/server/ — so this relative path resolves to apps/client/dist in both cases.
const DEFAULT_CLIENT_DIST_DIR = path.resolve(moduleDir, "../../client/dist");

export interface HttpServerOptions {
  /** Directory to serve as the built client. Defaults to apps/client/dist. Mainly for tests. */
  clientDistDir?: string;
  /** Whether to register static client serving + SPA fallback. Defaults to NODE_ENV === "production". */
  serveClient?: boolean;
  /** pino log level. Defaults to LOG_LEVEL env or "info". Tests pass "silent". */
  logLevel?: LevelWithSilent;
}

/**
 * Builds the Fastify instance — does not call `listen()`. `GET /health` always responds
 * `{ ok: true, uptime }`; in production the built client is served from `clientDistDir` with
 * unmatched GET requests falling back to `index.html` (client-side routing survives refresh).
 */
export function createHttpServer(options: HttpServerOptions = {}): FastifyInstance {
  const level = options.logLevel ?? (process.env.LOG_LEVEL as LevelWithSilent | undefined) ?? "info";

  // pino's Logger structurally satisfies FastifyBaseLogger (fastify's logger contract *is*
  // a pino subset); widening here keeps the return type the plain default FastifyInstance.
  const loggerInstance: FastifyBaseLogger = pino({ level });
  const app = Fastify({ loggerInstance });

  app.get("/health", async () => ({
    ok: true,
    uptime: process.uptime(),
  }));

  const serveClient = options.serveClient ?? process.env.NODE_ENV === "production";
  if (serveClient) {
    const clientDistDir = options.clientDistDir ?? DEFAULT_CLIENT_DIST_DIR;

    void app.register(fastifyStatic, {
      root: clientDistDir,
    });

    // SPA fallback: any unmatched GET resolves to index.html so deep links / refreshes on
    // client-side routes work; non-GET unmatched requests stay a plain 404.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET") {
        void reply.code(404).send({ ok: false, error: "not found" });
        return;
      }
      void reply.sendFile("index.html", clientDistDir);
    });
  }

  return app;
}
