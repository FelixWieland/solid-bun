import type { Server, ServerWebSocket, WebSocketHandler } from 'bun';

/** Path prefix → target URL, e.g. `{ '/api': 'http://127.0.0.1:4000' }`. */
export type ProxyRules = Record<string, string>;

export type Relay = { upstream: WebSocket; pending: (string | ArrayBuffer)[]; bytes: number; client?: ServerWebSocket<Relay> };

const limit = 1024 * 1024;
const connectTimeoutMs = 10_000;
// Handshake and hop-by-hop headers belong to each connection; the client sets its own.
const connectionHeaders = ['host', 'connection', 'upgrade', 'content-length', 'keep-alive', 'transfer-encoding',
  'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol'];

export // The DOM lib's WebSocket constructor hides Bun's options overload (headers, protocols).
const BunWebSocket = WebSocket as unknown as new (url: URL, options: Bun.WebSocketOptions) => WebSocket;

export const isUpgrade = (request: Request) => request.headers.get('upgrade')?.toLowerCase() === 'websocket';

/** Close codes 1005, 1006 and 1015 are reserved for reporting and must not be sent. */
const sendable = (code: number) => (code === 1005 ? 1000 : code === 1006 || code === 1015 ? 1011 : code);

/**
 * Relays WebSocket connections to an upstream server with bounded buffers. The upstream
 * connection opens first, so its subprotocol is accepted and a refused upstream answers the
 * client's handshake with 502 instead of an immediately closed socket.
 */
export function createWebSocketRelay() {
  const peers = new Set<ServerWebSocket<Relay>>();

  async function relay(request: Request, server: Server<Relay>, target: URL, headers: Record<string, string> = {}): Promise<Response | undefined> {
    const protocols = request.headers.get('sec-websocket-protocol')?.split(',').map(value => value.trim()).filter(Boolean);
    const upstream = new BunWebSocket(target, { headers, ...(protocols?.length ? { protocols } : {}) });
    upstream.binaryType = 'arraybuffer';
    const data: Relay = { upstream, pending: [], bytes: 0 };
    upstream.onmessage = event => {
      if (data.client) return void data.client.send(event.data);
      data.bytes += typeof event.data === 'string' ? Buffer.byteLength(event.data) : event.data.byteLength;
      if (data.bytes > limit) upstream.close(1009, 'Relay queue exceeded');
      else data.pending.push(event.data);
    };
    const opened = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), connectTimeoutMs);
      upstream.onopen = () => { clearTimeout(timer); resolve(true); };
      upstream.onerror = upstream.onclose = () => { clearTimeout(timer); resolve(false); };
    });
    if (!opened) {
      upstream.close();
      return new Response('WebSocket upstream unavailable', { status: 502 });
    }
    const accepted = upstream.protocol ? { 'sec-websocket-protocol': upstream.protocol } : undefined;
    if (server.upgrade(request, { data, ...(accepted ? { headers: accepted } : {}) })) return undefined;
    upstream.close();
    return new Response('Upgrade failed', { status: 400 });
  }

  const handlers: WebSocketHandler<Relay> = {
    maxPayloadLength: limit, backpressureLimit: limit, closeOnBackpressureLimit: true,
    open(socket) {
      peers.add(socket);
      const { upstream } = socket.data;
      socket.data.client = socket;
      for (const message of socket.data.pending) socket.send(message);
      socket.data.pending = []; socket.data.bytes = 0;
      upstream.onclose = event => socket.close(sendable(event.code), event.reason);
      upstream.onerror = () => socket.close(1011, 'WebSocket upstream failed');
      if (upstream.readyState === WebSocket.CLOSED) socket.close(1011, 'WebSocket upstream closed');
    },
    message(socket, message) {
      const { upstream } = socket.data;
      if (upstream.readyState !== WebSocket.OPEN) return;
      if (upstream.bufferedAmount > limit) socket.close(1013, 'WebSocket upstream too slow');
      else upstream.send(message);
    },
    close(socket, code, reason) {
      peers.delete(socket);
      const { upstream } = socket.data;
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(sendable(code), reason);
    },
  };

  function closeAll() {
    for (const peer of peers) { peer.data.upstream.close(); peer.close(); }
  }

  return { relay, handlers, closeAll };
}

export type WebSocketRelay = ReturnType<typeof createWebSocketRelay>;

/**
 * Forwards requests under path prefixes to other servers, HTTP and WebSocket alike, as a
 * development counterpart of a same-origin reverse proxy. The upstream sees the original
 * cookies, `Origin` and `User-Agent`, plus `X-Forwarded-Host`, `-Proto` and `-For`.
 */
export function createProxy(rules: ProxyRules = {}) {
  const entries = Object.entries(rules).map(([prefix, target]) => {
    if (!/^\/[^?#]*$/.test(prefix)) throw new Error(`Proxy prefix must be a path starting with /: ${prefix}`);
    let url: URL;
    try { url = new URL(target); } catch { throw new Error(`Invalid proxy target for ${prefix}: ${target}`); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Proxy target must be http(s): ${target}`);
    return { prefix: prefix.replace(/\/+$/, ''), base: url.pathname.replace(/\/+$/, ''), url };
  }).sort((a, b) => b.prefix.length - a.prefix.length);

  /** The upstream URL for a request, or undefined if no prefix matches. */
  function target(request: Request): URL | undefined {
    const url = new URL(request.url);
    const entry = entries.find(({ prefix }) => prefix === '' || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
    return entry && new URL(entry.base + url.pathname + url.search, entry.url);
  }

  function forwarded(request: Request, server: Server<Relay>): Headers {
    const headers = new Headers(request.headers);
    for (const name of connectionHeaders) headers.delete(name);
    const url = new URL(request.url);
    headers.set('x-forwarded-host', request.headers.get('host') ?? url.host);
    headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
    const address = server.requestIP(request)?.address;
    if (address) headers.set('x-forwarded-for', address);
    return headers;
  }

  async function handle(request: Request, server: Server<Relay>, relay: WebSocketRelay): Promise<Response | undefined | false> {
    const upstream = target(request);
    if (!upstream) return false;
    const headers = forwarded(request, server);
    if (isUpgrade(request)) {
      upstream.protocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:';
      return relay.relay(request, server, upstream, Object.fromEntries(headers));
    }
    let response: Response;
    try {
      response = await fetch(upstream, {
        method: request.method, headers, redirect: 'manual',
        ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: await request.arrayBuffer() }),
      });
    } catch {
      return new Response('Proxy upstream unavailable', { status: 502 });
    }
    // fetch has already decoded the body; its encoding and length no longer apply.
    const responseHeaders = new Headers(response.headers);
    if (responseHeaders.has('content-encoding')) { responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length'); }
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  }

  return { handle, size: entries.length };
}
