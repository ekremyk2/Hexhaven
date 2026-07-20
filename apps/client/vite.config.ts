import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Base path. Defaults to "/" for the single-port server build (apps/server serves the client at
  // the domain root) and local dev. The GitHub Pages workflow sets VITE_BASE=/Hexhaven/ so assets
  // and routes resolve under https://<user>.github.io/Hexhaven/. `import.meta.env.BASE_URL` mirrors
  // this and drives the router basename in App.tsx.
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});
