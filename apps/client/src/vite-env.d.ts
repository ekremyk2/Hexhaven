/// <reference types="vite/client" />

// docs/02 §9 / T-301 §4: the ws client connects to `VITE_SERVER_URL + /ws`. Unset in production
// (single-container deploy, T-503) where the client is served same-origin with the server; set
// for local dev when the client (Vite, :5173) and server (:8080) run on different ports.
interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
