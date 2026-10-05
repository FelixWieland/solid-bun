import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';
import { dirname, resolve } from 'node:path';

/** Class maps of CSS Modules by absolute path, as Bun compiled them. */
export type ClassMaps = ReadonlyMap<string, Readonly<Record<string, string>>>;

type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Binding = { map: Readonly<Record<string, string>>; specifier: Node; statement: Node; source: string; inline: boolean };

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';

/**
 * Replace `styles.name` reads of CSS Module default imports with the class name as a string literal, and join
 * `class={[...]}` lists consisting of such names only. The Solid compiler then writes the class into the template
 * instead of setting it through an effect.
 *
 * An import is only touched when every identifier of its name in the file reads a member of it. Any other
 * occurrence (a shadowing binding, the object passed on, an assignment) leaves that import as it is, so no scope
 * analysis is needed to stay correct. Returns undefined when nothing changes.
 */
export function inlineCssClasses(source: string, path: string, classMaps: ClassMaps) {
  if (!source.includes('.module.css')) return undefined;
  const { program, errors } = parseSync(path, source);
  if (errors.length) return undefined; // the compiler reports it
  const bindings = new Map<string, Binding>();
  for (const statement of (program as unknown as { body: Node[] }).body) {
    const specifier = statement.type === 'ImportDeclaration' && (statement.source as { value: string }).value;
    if (!specifier || !specifier.startsWith('.') || !specifier.endsWith('.module.css')) continue;
    const map = classMaps.get(resolve(dirname(path), specifier));
    const local = (statement.specifiers as Node[]).find(item => item.type === 'ImportDefaultSpecifier');
    if (map && local) bindings.set((local.local as { name: string }).name, { map, specifier: local, statement, source: specifier, inline: true });
  }
  if (!bindings.size) return undefined;

  const reads: { node: Node; binding: Binding; value: string }[] = [];
  const lists: { container: Node; elements: Node[] }[] = [];
  const className = (node: Node): { binding: Binding; value: string } | undefined => {
    if (node.type !== 'MemberExpression' || node.computed) return undefined;
    const binding = bindings.get((node.object as { type: string; name?: string }).type === 'Identifier' ? (node.object as { name: string }).name : '');
    const value = binding?.map[(node.property as { name: string }).name];
    return binding && value !== undefined && Object.hasOwn(binding.map, (node.property as { name: string }).name) ? { binding, value } : undefined;
  };
  const visit = (node: Node, parent: Node | undefined, grandparent: Node | undefined) => {
    if (node.type === 'Identifier') {
      const binding = bindings.get(node.name as string);
      if (!binding || parent === binding.specifier) return;
      if (parent?.type === 'MemberExpression' && parent.object === node) {
        const written = (grandparent?.type === 'AssignmentExpression' && grandparent.left === parent)
          || grandparent?.type === 'UpdateExpression' || (grandparent?.type === 'UnaryExpression' && grandparent.operator === 'delete');
        const name = className(parent);
        if (written) binding.inline = false;
        else if (name) reads.push({ node: parent, ...name });
      } else if (!((parent?.type === 'MemberExpression' && parent.property === node && !parent.computed)
        || (parent?.type === 'Property' && parent.key === node && !parent.computed))) binding.inline = false;
      return;
    }
    if (node.type === 'JSXAttribute' && (node.name as { name?: unknown }).name === 'class' && isNode(node.value) && node.value.type === 'JSXExpressionContainer') {
      const expression = node.value.expression as Node;
      if (expression.type === 'ArrayExpression' && (expression.elements as unknown[]).length) lists.push({ container: node.value, elements: expression.elements as Node[] });
    }
    for (const key in node) {
      const value = node[key];
      if (Array.isArray(value)) { for (const item of value) if (isNode(item)) visit(item, node, parent); }
      else if (isNode(value)) visit(value, node, parent);
    }
  };
  visit(program as unknown as Node, undefined, undefined);

  const edit = new MagicString(source);
  const joined = new Set<Node>();
  for (const { container, elements } of lists) {
    const names = elements.map(element => {
      if (!isNode(element)) return undefined;
      if (element.type === 'Literal') return typeof element.value === 'string' ? element.value : undefined;
      const name = className(element);
      return name?.binding.inline ? name.value : undefined;
    });
    if (names.includes(undefined)) continue;
    edit.overwrite(container.start, container.end, `{${JSON.stringify(names.filter(Boolean).join(' '))}}`);
    for (const element of elements) joined.add(element);
  }
  const inlined = new Set<Binding>();
  for (const { node, binding, value } of reads) {
    if (!binding.inline) continue;
    inlined.add(binding);
    if (!joined.has(node)) edit.overwrite(node.start, node.end, JSON.stringify(value));
  }
  if (!inlined.size) return undefined;
  // An import nothing reads any more would lose its stylesheet; the bare import keeps it, at the same place in the order.
  for (const binding of inlined) edit.prependLeft(binding.statement.start, `import ${JSON.stringify(binding.source)};`);
  return { code: edit.toString(), map: edit.generateMap({ source: path, includeContent: true, hires: true }) };
}
