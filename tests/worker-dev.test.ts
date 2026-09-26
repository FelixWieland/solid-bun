import { test, expect } from 'bun:test';
import { mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerDevelopment } from '../src/worker-dev';

test('worker watcher handles imported helpers, failed builds, atomic saves and reconnects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solid-bun-worker-'));
  const entry = join(directory, 'worker.ts');
  const helper = join(directory, 'helper.ts');
  await Bun.write(entry, 'import { value } from "./helper"; self.postMessage(value);');
  await Bun.write(helper, 'export const value = "one";');
  const dev = await createWorkerDevelopment(entry, directory, 'demo');
  const request = (path: string) => new Request(`http://localhost${path}`);
  const reader = dev.fetch(request('/__solid-bun/workers/demo/events'))!.body!.getReader();
  const next = async (): Promise<{ url?: string; error?: string }> => {
    let timeout: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        (async () => {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) throw new Error('Worker event stream ended');
            const text = new TextDecoder().decode(chunk.value);
            if (text.startsWith('data: ')) return JSON.parse(text.slice(6));
          }
        })(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('No worker update')), 3000); }),
      ]);
    } finally { clearTimeout(timeout!); }
  };
  try {
    const initial = await next();
    expect(initial.url).toMatch(/^\/__solid-bun\/workers\/demo\/[a-f0-9]+\.js$/);
    const oldCode = await dev.fetch(request(initial.url!))!.text();
    expect(oldCode).toContain('"one"');

    await Bun.write(helper, 'export const value = "two";');
    const updated = await next();
    expect(updated.url).not.toBe(initial.url);
    expect(await dev.fetch(request(updated.url!))!.text()).toContain('"two"');
    expect(await dev.fetch(request(initial.url!))!.text()).toBe(oldCode);

    await Bun.write(helper, 'export const value = ;');
    expect((await next()).error).toBeTruthy();
    expect(await dev.fetch(request('/workers/demo.js'))!.text()).toContain('"two"');

    // Editors commonly save by rename, rather than modifying the watched inode.
    await Bun.write(join(directory, 'replacement.tmp'), 'export const value = "three";');
    await rename(join(directory, 'replacement.tmp'), helper);
    const restored = await next();
    expect(restored.url).not.toBe(updated.url);
    expect(await dev.fetch(request(restored.url!))!.text()).toContain('"three"');
    const reconnect = dev.fetch(request('/__solid-bun/workers/demo/events'))!.body!.getReader();
    expect(new TextDecoder().decode((await reconnect.read()).value)).toContain(restored.url!);
    await reconnect.cancel();
    expect(dev.fetch(request('/__solid-bun/workers/demo/missing.js'))!.status).toBe(404);
  } finally {
    await reader.cancel(); dev.stop(); await rm(directory, { recursive: true, force: true });
  }
}, 10000);
