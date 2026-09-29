# Verification

Checked locally on macOS arm64, 2026-09-26, using Bun **1.4.2 (744846f84)**, Solid/compiler/web **2.0.0-rc.9**, TypeScript **5.9.3**, `@types/bun` **1.4.2**, Happy DOM **20.14.5**. Application servers, compiler transforms, bundling and tests execute with Bun; `tsc` is the installed TypeScript CLI. The CLI shebang requires `bun` on PATH.

## Repeatable checks

- `bun run check`: strict library, tests and verification-script types.
- `bun test`: nine library tests covering the `spa` build/preview fallback (root-relative assets, nested navigations, 404 for assets and non-navigations, disabled by default), authored TSX map locations through minification/refresh, worker imported-helper changes, compile errors, atomic saves, SSE reconnect, readiness/rollback, stale candidates, timeout and disposal. The isolated example adds two tests for real Solid updates/CSS class maps and native HTTP/SQLite: eleven tests in total. Each project uses its own installed peers and test configuration.
- `bun run build`: declaration output for explicit package exports.
- `bun run verify:package`: creates an archive, proves that a bare installation includes Happy DOM/compiler but does not install Solid/web, checks missing/incompatible Solid peer errors, then installs it into an isolated temporary consumer outside this repository, checks consumer types and two tests, builds browser assets, verifies authored TSX sources in production maps, and starts actual CLI dev/preview children on available loopback ports. Checks HTML/JS/CSS/worker responses, the `spa` fallback for a nested navigation, client-only HTML, missing paths and an encoded traversal boundary. Stops children and removes temporary files.

## Real browser checks

The example consumed a packed library archive. T3's collaborative browser rendered the counter and ran the TypeScript worker. Clicking changed `Count: 0` to `Count: 1`. Editing CSS changed the computed background from `rgb(40, 89, 197)` to `rgb(18, 112, 72)` while retaining `Count: 1`. Editing the worker changed the visible message to `Worker hot update verified`, again retaining the count. An invalid worker build preserved this last working message. Restoring valid source recovered the worker; a component edit updated its heading and remounted local state (`Count: 0`). Source edits were restored afterward.

The browser snapshot tool failed, so checks used the same collaborative browser's DOM evaluation and click tools. No screenshot claim is made. These checks establish the observed development behavior, not browser performance or cross-browser compatibility.

## Limits

No production deployment, load benchmark, browser automation suite, publication, Windows/Linux validation or compatibility claim for other Bun/Solid versions. Browser/production source maps have position-level automated coverage; Bun test-runtime stack traces and coverage remapping are not certified. OffscreenCanvas/state migration are consumer responsibilities; this generic example tests an actual messaging worker, not chart rendering. Development worker bundles must be self-contained JavaScript; additional emitted assets are rejected explicitly. Worker source dependencies outside the configured watch tree need a wider `watch` directory or restart.
