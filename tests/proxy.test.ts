import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build, dev, preview, type RunningServer } from '../src/index';

// An application backend behind the proxy: echoes requests, sets cookies, redirects, compresses
// and accepts WebSockets only with a session cookie and an allowed origin, like MINT's API.
const backend = Bun.serve<{ protocol: string }>({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === '/api/realtime') {
      const allowed = request.headers.get('cookie') === 'session=abc' && request.headers.get('origin') === 'http://app.test';
      if (!allowed) return new Response('Unauthorized', { status: 401 });
      const protocol = request.headers.get('sec-websocket-protocol')?.split(',')[0]?.trim() ?? '';
      return server.upgrade(request, { data: { protocol }, headers: protocol ? { 'sec-websocket-protocol': protocol } : {} })
        ? undefined : new Response('Upgrade failed', { status: 400 });
    }
    if (url.pathname === '/api/redirect') return Response.redirect('/api/elsewhere', 302);
    if (url.pathname === '/api/compressed') {
      return new Response(Bun.gzipSync(new TextEncoder().encode('compressed body')), { headers: { 'content-encoding': 'gzip', 'content-type': 'text/plain' } });
    }
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');
    return new Response(JSON.stringify({
      method: request.method,
      path: url.pathname + url.search,
      body: await request.text(),
      cookie: request.headers.get('cookie'),
      origin: request.headers.get('origin'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    }), { headers });
  },
  websocket: {
    open(socket) { socket.send(`welcome ${socket.data.protocol}`); },
    message(socket, message) {
      if (message === 'end') socket.close(4001, 'session-ended');
      else socket.send(`echo ${message}`);
    },
  },
});

afterAll(() => backend.stop(true));

const proxy = { '/api': backend.url.origin };

/** Opens a WebSocket through `server` and collects messages until it closes. */
function connect(server: URL, init: { cookie?: string; origin?: string; protocols?: string[] } = {}) {
  const url = new URL('/api/realtime', server);
  url.protocol = 'ws:';
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  const socket = new (WebSocket as unknown as new (url: URL, options: Bun.WebSocketOptions) => WebSocket)(url, { headers, ...(init.protocols ? { protocols: init.protocols } : {}) });
  const messages: string[] = [];
  socket.onmessage = event => messages.push(String(event.data));
  const opened = new Promise<boolean>(resolve => {
    socket.onopen = () => resolve(true);
    socket.onerror = () => resolve(false);
  });
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener('close', resolve));
  const next = async (count: number) => {
    for (let i = 0; i < 100 && messages.length < count; i++) await Bun.sleep(10);
    return messages.slice(0, count);
  };
  return { socket, messages, opened, closed, next };
}

function behavesAsProxy(server: () => RunningServer) {
  test('forwards HTTP with path, query, body, cookies and origin; adds forwarding headers', async () => {
    const response = await fetch(new URL('/api/echo?x=1', server().url), {
      method: 'POST', body: 'payload', headers: { cookie: 'session=abc', origin: 'http://app.test' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    expect(await response.json()).toEqual({
      method: 'POST', path: '/api/echo?x=1', body: 'payload', cookie: 'session=abc', origin: 'http://app.test',
      forwardedHost: server().url.host, forwardedProto: 'http',
    });
  });

  test('matches whole path segments only', async () => {
    expect((await fetch(new URL('/api', server().url))).status).toBe(200);
    expect((await fetch(new URL('/apiary', server().url))).status).toBe(404);
  });

  test('passes redirects through and decodes compressed bodies once', async () => {
    const redirect = await fetch(new URL('/api/redirect', server().url), { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('/api/elsewhere');
    const compressed = await fetch(new URL('/api/compressed', server().url));
    expect(compressed.headers.get('content-encoding')).toBeNull();
    expect(await compressed.text()).toBe('compressed body');
  });

  test('relays WebSockets with cookies, origin, subprotocol and close codes', async () => {
    const client = connect(server().url, { cookie: 'session=abc', origin: 'http://app.test', protocols: ['mint.v1'] });
    expect(await client.opened).toBe(true);
    expect(client.socket.protocol).toBe('mint.v1');
    client.socket.send('hello');
    expect(await client.next(2)).toEqual(['welcome mint.v1', 'echo hello']);
    client.socket.send('end');
    const closed = await client.closed;
    expect([closed.code, closed.reason]).toEqual([4001, 'session-ended']);
  });

  test('refuses the handshake when the upstream does', async () => {
    const client = connect(server().url, { origin: 'http://app.test' });
    expect(await client.opened).toBe(false);
  });
}

describe('proxy option in preview', () => {
  const root = join(import.meta.dir, 'fixtures/spa');
  const outdir = 'dist-proxy-test';
  let server: RunningServer;

  beforeAll(async () => {
    await rm(join(root, outdir), { recursive: true, force: true });
    await build({ root, outdir });
    server = await preview({ root, outdir, port: 0, proxy });
  });
  afterAll(async () => {
    await server?.stop();
    await rm(join(root, outdir), { recursive: true, force: true });
  });

  behavesAsProxy(() => server);

  test('serves the build outside proxied paths', async () => {
    expect(await (await fetch(server.url)).text()).toContain('id="root"');
  });
});

describe('proxy option in dev', () => {
  // Written at runtime: dev serves the HTML entry with Bun's native HMR server.
  const root = join(import.meta.dir, 'fixtures/.proxy');
  let server: RunningServer;

  beforeAll(async () => {
    await mkdir(root, { recursive: true });
    await Bun.write(join(root, 'index.html'), '<!doctype html><html><head><title>fixture</title></head><body><div id="root"></div><script type="module" src="./main.ts"></script></body></html>');
    await Bun.write(join(root, 'main.ts'), "document.getElementById('root')!.textContent = 'ok';\n");
    server = await dev({ root, port: 0, proxy });
  });
  afterAll(async () => {
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  behavesAsProxy(() => server);

  test('serves the app outside proxied paths', async () => {
    expect(await (await fetch(server.url, { headers: { accept: 'text/html' } })).text()).toContain('id="root"');
  });

  test('still relays Bun HMR WebSockets outside proxied paths', async () => {
    const url = new URL('/_bun/hmr', server.url);
    url.protocol = 'ws:';
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const first = await new Promise<unknown>((resolve, reject) => {
      socket.onmessage = event => resolve(event.data);
      socket.onerror = () => reject(new Error('HMR socket failed'));
    });
    expect(first).toBeDefined();
    socket.close();
  });
});

test('rejects invalid rules before starting a server', async () => {
  await expect(preview({ proxy: { api: backend.url.origin } })).rejects.toThrow('Proxy prefix must be a path');
  await expect(preview({ proxy: { '/api': 'ftp://example.test' } })).rejects.toThrow('Proxy target must be http(s)');
});
