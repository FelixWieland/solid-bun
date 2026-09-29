# Design and references

The API favors explicit boundaries: tooling imports Bun/compiler dependencies, the browser entry imports none of them, and the test preload is opt-in. No framework behavior is mocked. Solid and web are exact optional peer dependencies to avoid a second incompatible reactive runtime; the official compiler is an exact tool dependency. Happy DOM is a direct library dependency, installed automatically and loaded only through the test entry. Consumers install the Solid peers explicitly; build/dev and test preload validate the required versions against packages resolved from the application. Development dependencies keep the library itself testable without becoming consumer dependencies.

## Use native mechanisms

- [Bun HTML development server](https://bun.com/docs/bundler/fullstack): HTML entry and `bunfig.toml` plugin registration. Keep this visible two-line registration instead of generating hidden configuration or spawning a second runtime.
- [Bun plugins](https://bun.com/docs/bundler/plugins): transform JSX through `@solidjs/compiler`. Its output retains TypeScript, so the adapter returns the `ts` loader. CSS Modules are compiled by Bun, not by a custom class-name parser.
- [Bun HMR](https://bun.com/docs/bundler/hot-reloading): use direct `import.meta.hot` calls. An internal facade adapts the official Solid refresh transform to this constraint. Component edits can remount local state; entry effects require explicit disposal.
- [Bun DOM testing](https://bun.com/docs/test/dom): preload a DOM environment for `bun:test`. rc.9 resolves server builds under Bun, so preload redirects to the installed peers' real browser implementations. Those internal paths are version-sensitive and covered by consumer tests.

## Compatibility adaptations

The current native dev CSS Module path does not supply the required module value reliably. In development the adapter asks Bun to compile the class map and injects CSS through an accepted JS module. Production uses extracted CSS. CSS text is updated in place; whole-stylesheet deletion and CSS asset URL edge cases are not exhaustively covered.

Bun's final map describes plugin output instead of composing the embedded compiler map. `@jridgewell/remapping` composes actual mappings through refresh, compatibility edits and JSX compilation. `magic-string` maps facade edits. A small loopback proxy composes native `.map` HTTP responses and relays HMR WebSockets with bounded queues; build postprocessing handles production maps. This is why a plugin alone is insufficient for the complete development experience.

Workers have independent, serialized build graphs. Each worker watches the configured source tree, retains four content-addressed successful bundles and sends SSE updates. Build failure preserves the last good artifact. Streams cap connected clients (32 per worker) and close slow readers; heartbeat keeps connections alive. The browser helper aborts obsolete preparations, waits for readiness and disposes the old resource only after successful activation. It does not invent an application message protocol. Assets emitted separately by worker builds are not currently supported in the development artifact cache; use workers whose output is a single JavaScript bundle.

## Client-side routing

`spa` is opt-in because it changes build output: the HTML entry is built with Bun's `publicPath: '/'`, so a page loaded at `/a/b` still requests `/index-*.js` instead of `/a/index-*.js`. The site must then be served from the root. Dev and preview answer only navigations (`GET`/`HEAD` whose `Accept` includes `text/html`) that no worker route or application `fetch` handled; scripts, styles, maps and API calls keep their 404. Dev fetches the native HTML route at `/` so Bun's HMR entry is reused rather than duplicated.

## Package conventions

Follow [npm package fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/): explicit `exports`, executable `bin`, an allowlist in `files`, and framework `peerDependencies`. Ship [TypeScript declarations](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html) alongside Bun-executed source. Commit lockfiles, verify the archive in a separate consumer directory, and test browser-facing behavior independently of DOM emulation. The CLI requires Bun on PATH; type checking uses the installed TypeScript CLI, not Bun's transpiler.

Origin: extracted from MINT's `experiments/solid2-bun-only`. Its historical reports and raw evidence remain untouched. This library owns its own validation and does not imply broader compatibility than the versions actually checked.
