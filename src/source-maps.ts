import remapping, { type SourceMapInput } from '@jridgewell/remapping';
import { TraceMap } from '@jridgewell/trace-mapping';

// Bun currently maps plugin output, rather than following its inline source map.
// Compose the embedded Solid map into Bun's final map, preserving real mappings.
export function composeSourceMap(input: string) {
  const map = new TraceMap(JSON.parse(input));
  const compilerMaps = new Map<string, SourceMapInput>();
  map.resolvedSources.forEach((source, index) => {
    const content = map.sourcesContent?.[index];
    const encoded = content?.match(/\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/)?.[1];
    if (source && encoded) compilerMaps.set(source, JSON.parse(Buffer.from(encoded, 'base64').toString()));
  });
  return JSON.stringify(remapping(JSON.parse(input), (source, context) =>
    context.depth === 1 ? compilerMaps.get(source) : null));
}
