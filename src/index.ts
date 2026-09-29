import { resolve, relative, isAbsolute } from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { createSolidPlugin } from './solid-plugin';
import { composeSourceMap } from './source-maps';
import { serveDevelopment } from './dev-proxy';
import { createWorkerDevelopment } from './worker-dev';
import { requireSolidPeers } from './peers';

export { createSolidPlugin } from './solid-plugin';

export interface SolidBunOptions {
  /** Project directory; defaults to the current working directory. */
  root?: string;
  /** HTML entry relative to root; defaults to index.html. */
  entry?: string;
  /** Build output relative to root; defaults to dist. Existing files are not deleted. */
  outdir?: string;
  /** Loopback port; defaults to 3000. Zero requests a free port. */
  port?: number;
  /** Worker name → TypeScript entry relative to root. URLs: /workers/<name>.js. */
  workers?: Record<string, string>;
  /** Source tree watched for worker dependencies; defaults to src. */
  watch?: string;
  /** Optional native HTTP backend; return undefined to continue to the 404 response. */
  fetch?: (request: Request) => Response | undefined | Promise<Response | undefined>;
  /**
   * Client-side routing: dev/preview answer unmatched HTML navigations with the entry,
   * and builds reference assets from the site root so nested URLs resolve them.
   */
  spa?: boolean;
}

export interface RunningServer {
  url: URL;
  stop(): Promise<void>;
}

function settings(options: SolidBunOptions) {
  const root = resolve(options.root ?? process.cwd());
  const outdir = resolve(root, options.outdir ?? 'dist');
  const inside = relative(root, outdir);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('outdir must be a child of root');
  const workers = Object.entries(options.workers ?? {});
  for (const [name] of workers) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid worker name: ${name}`);
  }
  return { root, outdir, workers, entry: resolve(root, options.entry ?? 'index.html') };
}

/** A browser page load (not a script, style or API request) that may receive the HTML entry. */
function isNavigation(request: Request): boolean {
  return (request.method === 'GET' || request.method === 'HEAD') && (request.headers.get('accept') ?? '').includes('text/html');
}

/** Build static browser assets. Source maps are composed back to authored TSX. */
export async function build(options: SolidBunOptions = {}): Promise<void> {
  const { root, outdir, entry, workers } = settings(options);
  requireSolidPeers(root);
  await mkdir(outdir, { recursive: true });
  const entries = [{ entry, outdir, naming: '[name].[ext]', publicPath: options.spa ? '/' : undefined }, ...workers.map(([name, path]) => ({
    entry: resolve(root, path), outdir: resolve(outdir, 'workers'), naming: `${name}.[ext]`, publicPath: undefined,
  }))];
  for (const item of entries) {
    const result = await Bun.build({ entrypoints: [item.entry], outdir: item.outdir,
      naming: { entry: item.naming, chunk: '[name]-[hash].[ext]', asset: '[name]-[hash].[ext]' },
      ...(item.publicPath ? { publicPath: item.publicPath } : {}),
      target: 'browser', minify: true, sourcemap: 'linked', plugins: [createSolidPlugin(false, root)] });
    if (!result.success) throw new AggregateError(result.logs, result.logs.map(String).join('\n'));
    for (const output of result.outputs) {
      if (output.path.endsWith('.map')) await Bun.write(output.path, composeSourceMap(await output.text()));
    }
  }
}

/** Uses Bun's native HTML server. Configure solid-bun/dev-plugin in bunfig.toml. */
export async function dev(options: SolidBunOptions = {}): Promise<RunningServer> {
  const { root, entry, workers } = settings(options);
  requireSolidPeers(root);
  const services: Awaited<ReturnType<typeof createWorkerDevelopment>>[] = [];
  let upstream: ReturnType<typeof Bun.serve> | undefined;
  let proxy: ReturnType<typeof serveDevelopment> | undefined;
  try {
    for (const [name, path] of workers) services.push(await createWorkerDevelopment(resolve(root, path), resolve(root, options.watch ?? 'src'), name));
    const html = (await import(entry)).default;
    upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, development: { hmr: true, console: true },
      routes: { '/': html },
      async fetch(request, server) {
        for (const service of services) { const response = service.fetch(request); if (response) return response; }
        const custom = await options.fetch?.(request); if (custom) return custom;
        if (options.spa && isNavigation(request)) return fetch(new URL('/', server.url), { headers: { accept: 'text/html' } });
        return new Response('Not found', { status: 404 });
      },
    });
    proxy = serveDevelopment(upstream.url, options.port ?? 3000);
    return { url: proxy.server.url, async stop() {
      for (const service of services) service.stop();
      await proxy!.stop(); await upstream!.stop(true);
    } };
  } catch (error) {
    for (const service of services) service.stop();
    await proxy?.stop(); await upstream?.stop(true); throw error;
  }
}

/** Local preview of an existing build. Not a deployment server or SPA router. */
export async function preview(options: SolidBunOptions = {}): Promise<RunningServer> {
  const { outdir } = settings(options);
  const directory = await realpath(outdir);
  const server = Bun.serve({ hostname: '127.0.0.1', port: options.port ?? 3000, development: false,
    async fetch(request) {
      const custom = await options.fetch?.(request); if (custom) return custom;
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      let pathname: string;
      try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response('Bad path', { status: 400 }); }
      const serve = (file: ReturnType<typeof Bun.file>) =>
        new Response(request.method === 'HEAD' ? null : file, { headers: { 'content-type': file.type } });
      const notFound = () => options.spa && isNavigation(request)
        ? serve(Bun.file(resolve(directory, 'index.html'))) : new Response('Not found', { status: 404 });
      try {
        const path = await realpath(resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`));
        const within = relative(directory, path);
        if (within.startsWith('..') || isAbsolute(within)) return new Response('Not found', { status: 404 });
        const file = Bun.file(path);
        if (!(await file.exists()) || !(await file.stat()).isFile()) return notFound();
        return serve(file);
      } catch { return notFound(); }
    },
  });
  return { url: server.url, async stop() { await server.stop(true); } };
}
