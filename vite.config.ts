import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mcpBridgePlugin } from './vite-plugin-mcp-bridge'

export default defineConfig({
  plugins: [react(), tailwindcss(), mcpBridgePlugin()],
  // The app now lives at the repo root, which also holds the vendored ngspice
  // sources. Without these, the dep scanner walks emsdk's test .html files (and
  // fails on their fake imports) and the watcher crawls the whole C tree.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5174,
    strictPort: true,
    watch: { ignored: ['**/ngspice-wasm/emsdk/**', '**/ngspice-wasm/ngspice-ngspice/**'] },
  },
})
