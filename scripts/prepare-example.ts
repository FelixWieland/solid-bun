import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dir, '..');
const example = join(root, 'examples/basic');
const cache = await mkdtemp(join(tmpdir(), 'solid-bun-example-cache-'));
async function run(args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, ...args], { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error(`Failed: bun ${args.join(' ')}`);
}
try {
  await run(['pm', 'pack'], root);
  // Local archives with unchanged names can remain cached even with --force.
  await rm(join(example, 'bun.lock'), { force: true });
  await run(['install', '--force', '--cache-dir', cache], example);
} finally { await rm(cache, { recursive: true, force: true }); }
