import { plugin } from 'bun';
import { Window } from 'happy-dom';
import { mock } from 'bun:test';
import { dirname, join } from 'node:path';
import solid from './solid-plugin';
import { compileCssModule } from './css-module';
import { requireSolidPeers } from './peers';

requireSolidPeers(process.cwd());
const window = new Window();
for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLButtonElement', 'DocumentFragment', 'Event', 'MouseEvent', 'CustomEvent', 'MutationObserver'] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
// Resolve the consumer's installed peers, then select their real browser builds.
// Solid 2's Bun condition selects server builds; no framework behavior is mocked.
const solidBrowser = join(dirname(Bun.resolveSync('solid-js', process.cwd())), 'solid.js');
const webBrowser = join(dirname(Bun.resolveSync('@solidjs/web', process.cwd())), 'web.js');
mock.module('solid-js', () => import(solidBrowser));
mock.module('@solidjs/web', () => import(webBrowser));
plugin(solid);
plugin({ name: 'solid-bun-test-css', setup(builder) {
  builder.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => ({
    contents: (await compileCssModule(path)).javascript, loader: 'js',
  }));
} });
