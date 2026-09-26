#!/usr/bin/env bun
import { resolve } from 'node:path';
import { build, dev, preview, type SolidBunOptions } from './index';

const [command, ...args] = process.argv.slice(2);
if (!command || command === '--help') {
  console.log('solid-bun <dev|build|preview> [--port NUMBER]\nReads optional solid-bun.config.ts from the current directory.');
} else {
  try {
    if (!['dev', 'build', 'preview'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const config = resolve('solid-bun.config.ts');
    const options: SolidBunOptions = await Bun.file(config).exists() ? (await import(config)).default : {};
    for (let index = 0; index < args.length; index++) {
      if (args[index] !== '--port' || !/^\d+$/.test(args[index + 1] ?? '')) throw new Error('Expected --port NUMBER');
      options.port = Number(args[++index]);
      if (options.port > 65535) throw new Error('Port must be between 0 and 65535');
    }
    if (command === 'build') { await build(options); console.log('Built browser assets.'); }
    else {
      const server = await (command === 'dev' ? dev(options) : preview(options));
      console.log(`solid-bun ${command}: ${server.url}`);
      let stopping = false;
      const stop = async () => { if (stopping) return; stopping = true; await server.stop(); process.exit(0); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
}
