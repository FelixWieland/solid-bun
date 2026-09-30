import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { dev, type RunningServer } from '../src/index';
import { withBuildErrorRecovery } from '../src/dev-proxy';

// Written at runtime so the fixture can switch between a broken and a working build.
const root = join(import.meta.dir, 'fixtures/.build-error');
const main = join(root, 'main.ts');
const html = { accept: 'text/html' };
let server: RunningServer;

beforeAll(async () => {
  await mkdir(root, { recursive: true });
  await Bun.write(join(root, 'index.html'), '<!doctype html><html><head><title>fixture</title></head><body><div id="root"></div><script type="module" src="./main.ts"></script></body></html>');
  await Bun.write(main, "document.getElementById('root')!.textContent = 'ok';\n");
  server = await dev({ root, port: 0 });
});

afterAll(async () => {
  await server?.stop();
  await rm(root, { recursive: true, force: true });
});

async function waitForStatus(status: number) {
  let response = await fetch(server.url, { headers: html });
  for (let i = 0; i < 50 && response.status !== status; i++) {
    await Bun.sleep(100);
    response = await fetch(server.url, { headers: html });
  }
  return response;
}

test('build error page reloads itself once the build succeeds again', async () => {
  expect((await waitForStatus(200)).status).toBe(200);

  await Bun.write(main, "document.getElementById('root')!.textContent = (;\n");
  const failed = await waitForStatus(500);
  expect(failed.status).toBe(500);
  expect(failed.headers.get('cache-control')).toBe('no-store');
  const page = await failed.text();
  expect(page).toContain('Build Failed');
  expect(page).toContain('fetch(location.href');

  await Bun.write(main, "document.getElementById('root')!.textContent = 'fixed';\n");
  const fixed = await waitForStatus(200);
  expect(fixed.status).toBe(200);
  expect(await fixed.text()).not.toContain('fetch(location.href');
});

test('recovery script is placed before the closing body tag', () => {
  expect(withBuildErrorRecovery('<html><body><p>x</p></body></html>')).toMatch(/<p>x<\/p><script>[\s\S]*<\/script><\/body><\/html>$/);
  expect(withBuildErrorRecovery('<p>x</p>')).toMatch(/^<p>x<\/p><script>/);
});
