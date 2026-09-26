import { watch } from 'node:fs';
import { createHash } from 'node:crypto';

type Update = { url: string } | { error: string };

// Dev-only: rebuild the separate worker graph and announce immutable versions.
// Watch the source tree so imported helper edits and atomic saves are included.
export async function createWorkerDevelopment(entrypoint: string, sourceDirectory: string, name: string) {
  const artifacts = new Map<string, string>();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  let state: Update = { error: 'Worker is building' };
  let currentUrl = '';
  let stopped = false;
  let building = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function send(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
    try {
      if ((controller.desiredSize ?? 0) <= 0) { clients.delete(controller); controller.close(); return; }
      controller.enqueue(encoder.encode(text));
    } catch { clients.delete(controller); }
  }
  function publish(update: Update) {
    if (JSON.stringify(update) === JSON.stringify(state)) return;
    state = update;
    for (const client of clients) send(client, `data: ${JSON.stringify(update)}\n\n`);
  }
  async function rebuild() {
    if (building) { dirty = true; return; }
    building = true;
    try {
      do {
        dirty = false;
        try {
          const result = await Bun.build({ entrypoints: [entrypoint], target: 'browser', sourcemap: 'inline' });
          if (stopped) return;
          if (dirty) continue;
          if (!result.success) throw new AggregateError(result.logs, result.logs.map(String).join('\n'));
          if (result.outputs.length !== 1 || !result.outputs[0].path.endsWith('.js')) throw new Error('Development workers must emit a single JavaScript bundle; separate assets are unsupported');
          const code = await result.outputs[0].text();
          const revision = createHash('sha256').update(code).digest('hex').slice(0, 20);
          currentUrl = `/__solid-bun/workers/${name}/${revision}.js`;
          artifacts.delete(currentUrl);
          artifacts.set(currentUrl, code);
          while (artifacts.size > 4) artifacts.delete(artifacts.keys().next().value!);
          publish({ url: currentUrl });
        } catch (error) {
          if (!stopped) publish({ error: String(error).slice(0, 4096) });
        }
      } while (dirty && !stopped);
    } finally { building = false; }
  }
  const watcher = watch(sourceDirectory, { recursive: true }, () => {
    if (stopped) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 50);
  });
  watcher.on('error', error => publish({ error: `Worker watcher: ${error.message}` }));
  const heartbeat = setInterval(() => {
    for (const client of clients) send(client, ': keepalive\n\n');
  }, 5000);
  heartbeat.unref();
  await rebuild();

  return {
    fetch(request: Request): Response | undefined {
      const path = new URL(request.url).pathname;
      if (path === `/__solid-bun/workers/${name}/events`) {
        if (clients.size >= 32) return new Response('Too many worker HMR clients', { status: 503 });
        let controller: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(value) { controller = value; clients.add(value); send(value, `data: ${JSON.stringify(state)}\n\n`); },
          cancel() { clients.delete(controller); },
        });
        return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
      }
      if (path === `/workers/${name}.js` || path.startsWith(`/__solid-bun/workers/${name}/`)) {
        const code = artifacts.get(path === `/workers/${name}.js` ? currentUrl : path);
        return code === undefined ? new Response('Worker unavailable', { status: 404 })
          : new Response(code, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } });
      }
    },
    stop() {
      stopped = true; clearTimeout(timer); clearInterval(heartbeat); watcher.close();
      for (const client of clients) { try { client.close(); } catch {} }
      clients.clear(); artifacts.clear();
    },
  };
}
