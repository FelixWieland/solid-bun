import { mkdtemp, mkdir, cp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { strict as assert } from 'node:assert';

const root = resolve(import.meta.dir, '..');
const temporary = await mkdtemp(join(tmpdir(), 'solid-bun-package-'));
const consumer = join(temporary, 'consumer');
const bin = join(temporary, 'bin');
await mkdir(bin);
await symlink(process.execPath, join(bin, 'bun'));
const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` };

async function run(args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, ...args], { cwd, env, stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  assert.equal(code, 0, args.join(' '));
}

async function expectFailure(args: string[], cwd: string, message: string) {
  const child = Bun.spawn([process.execPath, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  assert.notEqual(code, 0, 'expected a clear dependency error');
  assert.ok((stdout + stderr).includes(message), stdout + stderr);
}

async function checkServer(mode: 'dev' | 'preview') {
  const child = Bun.spawn([process.execPath, 'run', mode, '--port', '0'], { cwd: consumer, env, stdout: 'pipe', stderr: 'inherit' });
  const reader = child.stdout.getReader();
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    let output = '';
    let match: RegExpMatchArray | null = null;
    while (!match) {
      const chunk = await reader.read(); assert.equal(chunk.done, false, 'server exited before reporting its URL');
      output += new TextDecoder().decode(chunk.value);
      match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
    }
    const url = match[0];
    const response = await fetch(url); assert.equal(response.status, 200);
    const html = await response.text(); assert.ok(html.includes('id="root"'));
    assert.ok(!html.includes('Count: 0'), 'client-only HTML');
    for (const [, asset] of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)) {
      assert.equal((await fetch(new URL(asset, url))).status, 200, asset);
    }
    const worker = await fetch(new URL('/workers/greeting.js', url)); assert.equal(worker.status, 200);
    assert.ok((await worker.text()).includes('Hello from a TypeScript worker'));
    const nested = await fetch(new URL('/nested/route', url), { headers: { accept: 'text/html' } });
    assert.equal(nested.status, 200, 'spa: nested navigation serves the entry');
    assert.ok((await nested.text()).includes('id="root"'));
    assert.equal((await fetch(new URL('/missing.js', url))).status, 404);
    assert.equal((await fetch(new URL('/%2e%2e%2fpackage.json', url))).status, 404);
    console.log(`Packed consumer ${mode}: HTML, JS/CSS, worker, SPA fallback, 404 and path boundary passed`);
  } finally {
    clearTimeout(timeout); await reader.cancel(); child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    await child.exited; clearTimeout(kill);
  }
}

try {
  const archive = join(temporary, 'solid-bun.tgz');
  await run(['pm', 'pack', '--filename', archive], root);
  const bare = join(temporary, 'without-peers');
  await mkdir(bare);
  await Bun.write(join(bare, 'package.json'), JSON.stringify({ private: true, type: 'module', devDependencies: { 'solid-bun': `file:${archive}` } }));
  await run(['install'], bare);
  await run(['-e', `
    for (const name of ['solid-js', '@solidjs/web']) {
      let found = false;
      try { Bun.resolveSync(name, process.cwd()); found = true; } catch {}
      if (found) throw new Error(name + ' was unexpectedly installed');
    }
    const library = Bun.resolveSync('solid-bun', process.cwd());
    Bun.resolveSync('@solidjs/compiler', library);
    Bun.resolveSync('happy-dom', library);
    await import('solid-bun');
  `], bare);
  await expectFailure(['-e', "await (await import('solid-bun')).build()"], bare, 'solid-bun: missing solid-js');
  await Bun.write(join(bare, 'node_modules/solid-js/package.json'), JSON.stringify({ name: 'solid-js', version: '1.9.9', main: 'index.js' }));
  await Bun.write(join(bare, 'node_modules/solid-js/index.js'), 'export {};');
  await expectFailure(['-e', "await (await import('solid-bun')).build()"], bare, 'solid-js@1.9.9 is unsupported');
  console.log('Compiler/Happy DOM installed automatically; Solid peers absent; missing/incompatible Solid diagnostics passed.');
  await cp(join(root, 'examples/basic'), consumer, { recursive: true,
    filter: path => !['node_modules', 'dist', 'bun.lock'].includes(basename(path)),
  });
  const manifest = await Bun.file(join(consumer, 'package.json')).json();
  manifest.devDependencies['solid-bun'] = `file:${archive}`;
  assert.equal(manifest.devDependencies['happy-dom'], undefined, 'consumer must not need its own Happy DOM dependency');
  await Bun.write(join(consumer, 'package.json'), JSON.stringify(manifest, null, 2));
  await run(['install'], consumer);
  await run(['run', 'check'], consumer);
  await run(['test'], consumer);
  await run(['run', 'build'], consumer);
  const mapFiles = [...new Bun.Glob('**/*.map').scanSync({ cwd: join(consumer, 'dist'), absolute: true })];
  assert.ok(mapFiles.length > 0);
  let authored = false;
  for (const path of mapFiles) {
    const map = await Bun.file(path).json();
    if (map.sourcesContent?.some((source: string | null) => source?.includes('return <main class={styles.panel}>'))) authored = true;
  }
  assert.ok(authored, 'packed production maps include authored TSX');
  await checkServer('preview');
  await checkServer('dev');
  console.log(`Package verification passed on Bun ${Bun.version}.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
