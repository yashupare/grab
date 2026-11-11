/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Set by `tauri dev` when developing against a remote device; unused on desktop.
const host = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
  .TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  // Tauri needs a fixed port and visible Rust errors.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },

  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
}));
