import { afterAll, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from '../src/index';

const root = join(import.meta.dir, 'fixtures/production');
const outdir = join(root, 'dist-test');

afterAll(() => rm(outdir, { recursive: true, force: true }));

test('build bundles the production exports of Solid for the entry and workers', async () => {
  await rm(outdir, { recursive: true, force: true });
  await build({ root, outdir: 'dist-test', workers: { probe: './worker.ts' } });

  const maps = [...new Bun.Glob('**/*.js.map').scanSync({ cwd: outdir })];
  expect(maps.length).toBe(2);
  for (const path of maps) {
    const { sources } = await Bun.file(join(outdir, path)).json() as { sources: string[] };
    expect(sources.some((source) => source.includes('solid-js/dist/solid.js'))).toBe(true);
    expect(sources.filter((source) => /\bdev\b|\.dev\./.test(source))).toEqual([]);
  }
});
