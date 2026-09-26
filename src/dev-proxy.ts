import { composeSourceMap } from './source-maps';
import type { ServerWebSocket } from 'bun';

type Peer = { upstream: WebSocket; queued: (string | Buffer)[]; bytes: number };
const limit = 1024 * 1024;

// Native Bun's reserved /_bun map routes bypass application fetch handlers.
// A loopback front server can compose those responses while forwarding Bun HMR.
export function serveDevelopment(upstreamUrl: URL, port: number) {
  const peers = new Set<ServerWebSocket<Peer>>();
  const server = Bun.serve<Peer>({
    hostname: '127.0.0.1', port, development: false,
    async fetch(request, server) {
      const url = new URL(new URL(request.url).pathname + new URL(request.url).search, upstreamUrl);
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        url.protocol = 'ws:';
        const protocols = request.headers.get('sec-websocket-protocol')?.split(',').map(value => value.trim());
        const upstream = new WebSocket(url, protocols);
        upstream.binaryType = 'arraybuffer';
        if (server.upgrade(request, { data: { upstream, queued: [], bytes: 0 } })) return;
        upstream.close();
        return new Response('Upgrade failed', { status: 400 });
      }
      const headers = new Headers(request.headers);
      headers.delete('host');
      if (url.pathname.endsWith('.map')) headers.delete('if-none-match');
      const response = await fetch(new Request(url, request), { headers });
      if (url.pathname.endsWith('.map') && response.ok) {
        const headers = new Headers(response.headers);
        headers.delete('content-length'); headers.delete('etag'); headers.delete('content-encoding');
        headers.set('cache-control', 'no-store');
        return new Response(composeSourceMap(await response.text()), { status: response.status, headers });
      }
      return response;
    },
    websocket: {
      maxPayloadLength: limit, backpressureLimit: limit, closeOnBackpressureLimit: true,
      open(socket) {
        peers.add(socket);
        const { upstream } = socket.data;
        upstream.onopen = () => {
          for (const message of socket.data.queued) upstream.send(message);
          socket.data.queued = []; socket.data.bytes = 0;
        };
        upstream.onmessage = event => socket.send(event.data);
        upstream.onclose = () => socket.close();
        upstream.onerror = () => socket.close(1011, 'HMR upstream failed');
      },
      message(socket, message) {
        const { upstream } = socket.data;
        if (upstream.readyState === WebSocket.OPEN) {
          if (upstream.bufferedAmount > limit) socket.close(1013, 'HMR client too slow');
          else upstream.send(message);
        } else if (upstream.readyState === WebSocket.CONNECTING) {
          socket.data.bytes += Buffer.byteLength(message);
          if (socket.data.bytes > limit) socket.close(1009, 'HMR queue exceeded');
          else socket.data.queued.push(typeof message === 'string' ? message : Buffer.from(message));
        }
      },
      close(socket) { peers.delete(socket); socket.data.upstream.close(); },
    },
  });
  return { server, stop() { for (const peer of peers) { peer.data.upstream.close(); peer.close(); } return server.stop(true); } };
}
