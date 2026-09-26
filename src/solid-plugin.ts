import { transform, transformRefresh } from '@solidjs/compiler';
import MagicString from 'magic-string';
import remapping from '@jridgewell/remapping';
import type { BunPlugin } from 'bun';
import { compileCssModule } from './css-module';
import { requireSolidPeers } from './peers';

// Shared by the browser bundler and the bun:test runtime preload.
export function createSolidPlugin(hmr = false, root = process.cwd()): BunPlugin {
  return {
    name: 'solid-2-client',
    setup(build) {
      requireSolidPeers(root);
      if (hmr) {
        build.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => {
          const { javascript, css } = await compileCssModule(path);
          return { loader: 'js', contents: `${javascript}\n
  const key = ${JSON.stringify(path)};
  let style = [...document.querySelectorAll('style[data-solid-css]')].find(node => node.dataset.solidCss === key);
  if (!style) { style = document.createElement('style'); style.dataset.solidCss = key; document.head.append(style); }
  style.textContent = ${JSON.stringify(css)};
  import.meta.hot.accept();
  ` };
        });
      }
      build.onLoad({ filter: /\.[jt]sx$/ }, async ({ path }) => {
        let source = await Bun.file(path).text();
        const maps = [];
        if (hmr) {
          const refreshed = transformRefresh(source, {
            filename: path, bundler: 'esm', importSource: 'solid-js/refresh', sourceMap: true, fixRender: false,
          });
          // Bun requires direct import.meta.hot API calls; Solid expects a hot object.
          const shim = new MagicString(refreshed.code);
          for (const match of refreshed.code.matchAll(/_\$\$(?:refresh|decline)\w*\("esm", (import\.meta\.hot),/g)) {
            const offset = match.index! + match[0].indexOf('import.meta.hot');
            shim.overwrite(offset, offset + 'import.meta.hot'.length, `{ data: import.meta.hot.data, accept: cb => import.meta.hot.accept(cb), dispose: cb => import.meta.hot.dispose(cb), decline: () => import.meta.hot.decline(), invalidate: () => location.reload() }`);
          }
          source = shim.toString();
          if (refreshed.map) maps.push(shim.generateMap({ source: path, includeContent: true, hires: true }), JSON.parse(refreshed.map));
        }
        const result = transform(source, {
          filename: path, generate: 'dom', hydratable: false, sourceMap: true,
        });
        const composed = remapping([JSON.parse(result.map!), ...maps], () => null);
        const map = result.map
          ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(composed)).toString('base64')}`
          : '';
        return { contents: result.code + map, loader: 'ts' };
      });
    },
  };
}

export default createSolidPlugin();
