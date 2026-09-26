# solid-bun

Standalone Bun tooling for client-side SolidJS 2. Provide a small CLI and reusable APIs for JSX compilation, CSS Modules, component/worker HMR, authored source maps and `bun:test`. No Vite, SSR or application-specific chart protocols.

- Target the verified combination Bun 1.4.2 and Solid/compiler/web 2.0.0-rc.9. Pin prerelease peers together; do not assume Solid 1 compatibility. Verify runtime and compiler APIs before upgrades.
- Keep Solid/web optional peers so consumer installation never adds them automatically. Validate application-resolved peers when needed. Ship the compiler and Happy DOM as direct tool dependencies; load Happy DOM only through the test entry.
- Prefer native Bun bundling, HTTP, WebSocket and test APIs. Delegate JSX to the official Solid compiler and CSS Modules to Bun. Keep browser exports independent of tooling and test dependencies.
- Preserve bounded HMR queues, build serialization, last-good worker fallback and deterministic cleanup. Worker replacement readiness and state migration belong to consumer callbacks; OffscreenCanvas requires fresh canvases on replacement.
- Maintain strict public TypeScript contracts, explicit package exports, a package files allowlist and a committed Bun lockfile. Type declarations are built; Bun executes shipped TypeScript source.
- Run `bun run check`, `bun test`, `bun run build`, and a packed-package consumer check for package/API changes. Use the example to verify real browser HMR when changing transforms or lifecycle behavior. Unit DOM tests cannot establish browser worker/layout behavior.
- Keep README concise; detailed design, evidence and limitations belong in `docs/`. Preserve the source MINT experiment and its historical results.
- Bind development/preview servers to loopback. Clean up only owned processes. No publication, license change, remote creation or sub-agent delegation without user instruction.
