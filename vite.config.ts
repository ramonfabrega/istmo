import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig({
  plugins: [react(), cloudflare()],
  worker: { format: "es" },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ["studio", "studio.bengal-barb.ts.net"],
  },
  build: { chunkSizeWarningLimit: 1800 },
});
