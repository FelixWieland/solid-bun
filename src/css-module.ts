// Ask Bun to compile CSS Modules, including class hashing and imported CSS.
export async function compileCssModule(path: string) {
  const result = await Bun.build({
    entrypoints: ['css-map-entry'], target: 'browser',
    plugins: [{ name: 'css-map', setup(builder) {
      builder.onResolve({ filter: /^css-map-entry$/ }, () => ({ path: 'entry', namespace: 'css-map' }));
      builder.onLoad({ filter: /.*/, namespace: 'css-map' }, () => ({
        contents: `export { default } from ${JSON.stringify(path)}`, loader: 'js', resolveDir: import.meta.dir,
      }));
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs);
  return {
    javascript: await result.outputs.find(file => file.path.endsWith('.js'))!.text(),
    css: await result.outputs.find(file => file.path.endsWith('.css'))?.text() ?? '',
  };
}
