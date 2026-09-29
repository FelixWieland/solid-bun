import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build, preview, type RunningServer } from '../src/index';

const root = join(import.meta.dir, 'fixtures/spa');
const outdir = 'dist-test';
const html = { accept: 'text/html,application/xhtml+xml' };

describe('spa option', () => {
  let server: RunningServer;

  beforeAll(async () => {
    await rm(join(root, outdir), { recursive: true, force: true });
    await build({ root, outdir, spa: true });
    server = await preview({ root, outdir, port: 0, spa: true });
  });

  afterAll(async () => {
    await server?.stop();
    await rm(join(root, outdir), { recursive: true, force: true });
  });

  test('build references assets from the site root', async () => {
    const index = await Bun.file(join(root, outdir, 'index.html')).text();
    const script = index.match(/src="([^"]+\.js)"/)?.[1];
    expect(script?.startsWith('/')).toBe(true);
    expect((await fetch(new URL(script!, server.url))).status).toBe(200);
  });

  test('preview answers nested page navigations with the entry', async () => {
    const response = await fetch(new URL('/auth/login', server.url), { headers: html });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
  });

  test('missing assets and non-navigation requests stay 404', async () => {
    expect((await fetch(new URL('/missing.js', server.url))).status).toBe(404);
    expect((await fetch(new URL('/auth/login', server.url), { headers: { accept: 'application/json' } })).status).toBe(404);
  });

  test('without the option nested navigations stay 404', async () => {
    const plain = await preview({ root, outdir, port: 0 });
    try {
      expect((await fetch(new URL('/auth/login', plain.url), { headers: html })).status).toBe(404);
    } finally {
      await plain.stop();
    }
  });
});
