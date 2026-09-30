import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

/** Resolve from the application, never fall back to the tool's development dependencies. */
export function requirePeer(name: string, version: string, root: string): string {
  const install = `bun add ${name}@${version}`;
  let entry: string;
  try { entry = Bun.resolveSync(name, root); }
  catch { throw new Error(`solid-bun: missing ${name} in ${root}. Install it explicitly: ${install}`); }
  let directory = dirname(entry);
  for (;;) {
    let manifest: { name?: string; version?: string } | undefined;
    try { manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')); } catch {}
    if (manifest?.name === name) {
      if (manifest.version !== version) throw new Error(`solid-bun: ${name}@${manifest.version} is unsupported; expected ${version}. Install a compatible version: ${install}`);
      return entry;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`solid-bun: cannot determine the installed version of ${name} from ${entry}`);
    directory = parent;
  }
}

export function requireSolidPeers(root: string): void {
  requirePeer('solid-js', '2.0.0-rc.13', root);
  requirePeer('@solidjs/web', '2.0.0-rc.13', root);
}
