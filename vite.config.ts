import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mcpBridgePlugin } from './vite-plugin-mcp-bridge'

/**
 * Dev-only proxies for the AI copilot, so a local run keeps the provider call
 * same-origin. The hosted build is static and has no proxy — the copilot detects
 * the 404 and calls the provider directly, which is why nothing depends on these
 * existing in production.
 */
const COPILOT_PROXIES = {
  '/api/anthropic': {
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/anthropic/, ''),
  },
  '/api/gemini': {
    target: 'https://generativelanguage.googleapis.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/gemini/, ''),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mcpBridgePlugin()],
  // The app now lives at the repo root, which also holds the vendored ngspice
  // sources. Without these, the dep scanner walks emsdk's test .html files (and
  // fails on their fake imports) and the watcher crawls the whole C tree.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5174,
    strictPort: true,
    proxy: COPILOT_PROXIES,
    watch: { ignored: ['**/ngspice-wasm/emsdk/**', '**/ngspice-wasm/ngspice-ngspice/**'] },
  },
  preview: {
    proxy: COPILOT_PROXIES,
  },
})
