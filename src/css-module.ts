async function compile(contents: string) {
  const result = await Bun.build({
    entrypoints: ['css-map-entry'], target: 'browser',
    plugins: [{ name: 'css-map', setup(builder) {
      builder.onResolve({ filter: /^css-map-entry$/ }, () => ({ path: 'entry', namespace: 'css-map' }));
      builder.onLoad({ filter: /.*/, namespace: 'css-map' }, () => ({ contents, loader: 'js', resolveDir: import.meta.dir }));
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs);
  return {
    javascript: await result.outputs.find(file => file.path.endsWith('.js'))!.text(),
    css: await result.outputs.find(file => file.path.endsWith('.css'))?.text() ?? '',
  };
}

// Ask Bun to compile CSS Modules, including class hashing and imported CSS.
export function compileCssModule(path: string) {
  return compile(`export { default } from ${JSON.stringify(path)}`);
}

/**
 * The class maps of all CSS Modules below root by absolute path, from one build. Bun derives the class names from
 * the file and the working directory, so they are the names the application build of this process emits. A build
 * cannot ask for them while it loads a module (a nested Bun.build does not return there), hence all at once and
 * beforehand.
 */
export async function compileCssClassMaps(root: string) {
  const paths = [...new Bun.Glob('**/*.module.css').scanSync({ cwd: root, absolute: true })].filter(path => !path.includes('/node_modules/'));
  if (!paths.length) return new Map<string, Readonly<Record<string, string>>>();
  const { javascript } = await compile(`${paths.map((path, index) => `import m${index} from ${JSON.stringify(path)};`).join('')}export default [${paths.map((_, index) => `m${index}`).join()}];`);
  const { default: maps } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`) as { default: Readonly<Record<string, string>>[] };
  return new Map(paths.map((path, index) => [path, maps[index]!]));
}
