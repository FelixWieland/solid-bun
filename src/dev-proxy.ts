import { composeSourceMap } from './source-maps';
import { createProxy, createWebSocketRelay, isUpgrade, type ProxyRules, type Relay } from './proxy';

// Bun 1.4.2's "Build Failed" page parses its embedded error payload into an extra
// phantom error that the HMR "errors cleared" message never removes, so a page
// loaded while the build is broken never reloads after the fix. The injected
// script polls the same URL and reloads once it builds again.
const recoveryScript = `<script>(() => {
  const check = async () => {
    try {
      const response = await fetch(location.href, { headers: { accept: 'text/html' }, cache: 'no-store' });
      if (response.ok) return location.reload();
    } catch {}
    setTimeout(check, 1000);
  };
  setTimeout(check, 1000);
})();</script>`;

/** Adds the reload-after-fix script to Bun's build error page. */
export function withBuildErrorRecovery(html: string): string {
  const end = html.lastIndexOf('</body>');
  return end === -1 ? html + recoveryScript : html.slice(0, end) + recoveryScript + html.slice(end);
}

const isBuildErrorPage = (response: Response) =>
  response.status === 500 && response.headers.get('content-type')?.startsWith('text/html') === true;

// Native Bun's reserved /_bun map routes bypass application fetch handlers.
// A loopback front server can compose those responses while forwarding Bun HMR.
// Proxied paths are forwarded first, so their WebSocket upgrades never reach Bun's HMR server.
export function serveDevelopment(upstreamUrl: URL, port: number, rules?: ProxyRules) {
  const relay = createWebSocketRelay();
  const proxy = createProxy(rules);
  const server = Bun.serve<Relay>({
    hostname: '127.0.0.1', port, development: false,
    async fetch(request, server) {
      const proxied = await proxy.handle(request, server, relay);
      if (proxied !== false) return proxied;
      const url = new URL(new URL(request.url).pathname + new URL(request.url).search, upstreamUrl);
      if (isUpgrade(request)) {
        url.protocol = 'ws:';
        return relay.relay(request, server, url);
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
      if (isBuildErrorPage(response)) {
        const headers = new Headers(response.headers);
        headers.delete('content-length'); headers.delete('etag'); headers.delete('content-encoding');
        headers.set('cache-control', 'no-store');
        return new Response(withBuildErrorRecovery(await response.text()), { status: response.status, headers });
      }
      return response;
    },
    websocket: relay.handlers,
  });
  return { server, stop() { relay.closeAll(); return server.stop(true); } };
}
