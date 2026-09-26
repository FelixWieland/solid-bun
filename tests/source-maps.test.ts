import { test, expect } from 'bun:test';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { createSolidPlugin } from '../src/solid-plugin';
import { composeSourceMap } from '../src/source-maps';

for (const hmr of [false, true]) {
  test(`original TSX error location survives ${hmr ? 'refresh and bundling' : 'production minification'}`, async () => {
    const result = await Bun.build({
      entrypoints: ['./tests/fixtures/MapProbe.tsx'], target: 'browser',
      plugins: [createSolidPlugin(hmr)], minify: !hmr, sourcemap: 'external',
    });
    expect(result.success).toBe(true);
    const code = await result.outputs.find(file => file.path.endsWith('.js'))!.text();
    const map = new TraceMap(composeSourceMap(await result.outputs.find(file => file.path.endsWith('.map'))!.text()));
    const offset = code.indexOf('solid-source-map-probe');
    expect(offset).toBeGreaterThan(0);
    const before = code.slice(0, offset);
    const original = originalPositionFor(map, { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') - 1 });
    expect(original.source).toEndWith('/tests/fixtures/MapProbe.tsx');
    expect(original.line).toBe(3);
    expect(map.sourcesContent?.[map.sources.indexOf(original.source!)]).toBe(await Bun.file('./tests/fixtures/MapProbe.tsx').text());
  });
}
