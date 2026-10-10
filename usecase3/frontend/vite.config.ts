import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server: open http://localhost:5173 on the laptop, or tunnel it for the iPhone.
// /api is proxied to the FastAPI backend on port 8000.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true, // tunnels (cloudflared, ngrok) use random hostnames
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
    fs: { allow: [".."] }, // the shared /data folder lives one level up
  },
  build: { target: "es2020", chunkSizeWarningLimit: 2000, sourcemap: false },
});
