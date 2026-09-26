# solid-bun

<p align="center">
  <img src="assets/solid-bun-logo.png" alt="SolidBun logo" width="320" />
</p>

Client-side **SolidJS 2 with Bun**: JSX compilation, CSS Modules, component/CSS HMR, TypeScript worker builds and replacement, authored source maps, and `bun:test` support. No Vite or SSR.

Experimental, verified with **Bun 1.4.2** and **Solid/compiler/web 2.0.0-rc.9**. Prerelease versions are deliberately pinned together. The source is public on GitHub; the package is not published to npm. `private: true` prevents npm publication, and `UNLICENSED` remains in place until a license is chosen.

## Try the example

Install Bun 1.4.2 and ensure `bun` is on `PATH`, then:

```sh
git clone https://github.com/FelixWieland/solid-bun.git
cd solid-bun
bun install --frozen-lockfile
bun run example:prepare           # packs the library and installs it in the example
cd examples/basic
bun run dev                       # http://127.0.0.1:3000
```

In another terminal, from `examples/basic`:

```sh
bun test                          # component + native HTTP/SQLite tests
bun run check                     # TypeScript
bun run build                     # static assets in dist/
bun run preview --port 3001        # local production preview
```

Edit `Counter.tsx`, `Counter.module.css` or `greeting.worker.ts` to exercise HMR. Worker/CSS edits retain the counter. Component edits may reset the component's local state. After changing the library, rerun `bun run example:prepare` from the repository root; it refreshes the example using an isolated install cache. The example intentionally does not use a source symlink. Its generated lockfile is ignored because the local archive changes; the library's dependency lockfile is committed.

## Use in your application

```sh
bun add solid-js@2.0.0-rc.9 @solidjs/web@2.0.0-rc.9
bun add -d /absolute/path/to/solid-bun/solid-bun-2.0.0-rc.9.tgz
```

Solid and web are application `dependencies`; `solid-bun` and TypeScript are application `devDependencies`. Solid/web remain optional peers: installation does not add them automatically, and missing or incompatible versions produce an explicit installation hint. The compiler, source-map tools and Happy DOM are direct library dependencies installed with `solid-bun`. No separate Happy DOM installation is needed; it loads only through `solid-bun/test` and stays out of browser bundles.

Add scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "solid-bun dev",
    "build": "solid-bun build",
    "preview": "solid-bun preview",
    "test": "bun test"
  }
}
```

Add `bunfig.toml`:

```toml
[serve.static]
plugins = ["solid-bun/dev-plugin"]

[test]
preload = ["solid-bun/test"]
```

Use `index.html` with `<div id="root"></div>` and `<script type="module" src="./src/main.tsx"></script>`. Minimal `src/main.tsx`:

```tsx
import { render } from '@solidjs/web';
import { App } from './App';

const dispose = render(() => <App />, document.getElementById('root')!);
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(dispose);
}
```

For TypeScript, use `moduleResolution: "Bundler"`, `jsx: "preserve"`, `jsxImportSource: "@solidjs/web"` and `types: ["bun", "solid-bun/types"]`; install `typescript` and `@types/bun` for checking. The example includes a complete configuration. CSS Modules work through `import styles from './App.module.css'`.

## Workers and optional configuration

No `solid-bun.config.ts` is needed for a basic app. Register workers when needed:

```ts
import type { SolidBunOptions } from 'solid-bun';

export default {
  workers: { chart: 'src/chart.worker.ts' },
} satisfies SolidBunOptions;
```

Workers compile to `/workers/chart.js`. For production-only usage, use `new Worker('/workers/chart.js', { type: 'module' })`. For development replacement, import `watchWorker` from `solid-bun/client`:

```ts
const stop = watchWorker('chart', async (url, signal) => {
  // Create candidate worker(s), initialize them, and await application readiness.
  // Honor signal and clean up partial resources on abort/error.
  return {
    activate() { /* synchronously attach the prepared result */ },
    dispose() { /* terminate workers and remove owned resources */ },
  };
}, { hot: Boolean(import.meta.hot), onError: console.error });
```

This fragment describes the lifecycle contract; see [the runnable example](examples/basic/src/main.tsx) for an actual Worker implementation. Call `stop()` during HMR disposal/unmount. The old resource remains active until preparation succeeds; errors, timeouts and superseded builds abort the candidate. `activate()` must be synchronous and exception-safe, and `dispose()` must not throw. OffscreenCanvas consumers must prepare fresh canvases and transfer them to the candidate; state migration is application-owned.

Options: `root` (current directory), `entry` (`index.html`), `outdir` (`dist`), `port` (`3000`), `workers`, `watch` (`src`) and optional HTTP `fetch`. CLI supports `--port`, including `0` for an available port. Imported worker helpers must live under `watch` to trigger rebuilding.

## APIs and boundaries

| Export | Purpose |
| --- | --- |
| `solid-bun` | `dev(options)`, `build(options)`, `preview(options)`, `SolidBunOptions` |
| `solid-bun/plugin` | `createSolidPlugin(hmr?, root?)` for custom Bun pipelines; root selects the application for peer validation |
| `solid-bun/dev-plugin` | Native HTML dev-server plugin configured through bunfig |
| `solid-bun/client` | `watchWorker`, browser-only lifecycle types |
| `solid-bun/test` | Opt-in Happy DOM + real Solid browser builds + runtime JSX/CSS transforms |
| `solid-bun/types` | Ambient CSS Module types |

`dev` and `preview` return `{ url, stop() }`. The optional `fetch(request)` integrates native HTTP handlers; return `undefined` for 404. Application WebSocket orchestration is outside this API. Development uses two loopback listeners in one Bun process to compose native source-map responses while forwarding Bun HMR. Production outputs static files; preview is a local verification server, without SPA routing.

The test preload installs DOM globals for the entire test process. Backend and database tests still use ordinary `bun:test`. Happy DOM does not establish browser layout, real workers, GPU behavior or browser performance. Browser integration remains a separate validation step. JSX stack/coverage remapping inside the test runtime is not guaranteed.

Source maps include source text. Build leaves existing output files in place; use a clean, dedicated output directory for deployment. Worker entry URLs are stable, so deployment cache policy/versioning remains your responsibility. No copying of a `public/` directory, SSR, SolidStart or automatic worker state migration is implemented.

## Library development

```sh
bun run check
bun test
bun run build
bun run verify:package            # pack, isolated consumer install, types/tests/build/HTTP checks
```

The package ships TypeScript for Bun plus generated declarations, with explicit exports and a files allowlist. Implementation rationale and official references: [design](docs/design.md). Validation scope: [verification](docs/verification.md).
