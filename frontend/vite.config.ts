import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mcpBridgePlugin } from '../../expt_mcp/vite-plugin-mcp-bridge'

export default defineConfig({
  plugins: [react(), tailwindcss(), mcpBridgePlugin()],
  server: { port: 5174, strictPort: true },
})
