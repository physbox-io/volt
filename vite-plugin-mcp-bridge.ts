import type { Plugin, ViteDevServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

export function mcpBridgePlugin(): Plugin {
  return {
    name: 'vite-plugin-mcp-bridge',

    configureServer(server: ViteDevServer) {
      const wss = new WebSocketServer({ noServer: true });

      const controllers = new Set<WebSocket>();
      const browsers    = new Set<WebSocket>();

      function broadcast(targets: Set<WebSocket>, data: string) {
        for (const ws of targets) {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        }
      }

      wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        const url  = new URL(req.url!, 'http://localhost');
        const role = url.searchParams.get('role') ?? 'controller';
        const set  = role === 'browser' ? browsers : controllers;
        set.add(ws);

        ws.send(JSON.stringify({ event: 'CONNECTED', role }));

        ws.on('message', (raw: Buffer | string) => {
          const data = raw.toString();
          if (role === 'browser') broadcast(controllers, data);
          else                    broadcast(browsers,    data);
        });

        ws.on('close', () => set.delete(ws));
        ws.on('error', () => set.delete(ws));
      });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (req.url?.split('?')[0] !== '/mcp') return;
        wss.handleUpgrade(req, socket as import('stream').Duplex, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      });
    },
  };
}
