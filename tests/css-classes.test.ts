import { afterAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { inlineCssClasses } from '../src/css-classes';
import { build } from '../src/index';

const maps = new Map<string, Record<string, string>>([['/app/a.module.css', { root: 'root_x', label: 'root_x label_x' }], ['/app/list.module.css', { empty: 'empty_y' }]]);
const inline = (source: string) => inlineCssClasses(source, '/app/View.tsx', maps)?.code;
const styles = `import styles from './a.module.css';\n`;
const kept = `import "./a.module.css";${styles}`;

describe('inlineCssClasses', () => {
  test('a member read becomes the class name and the stylesheet stays imported', () => {
    expect(inline(`${styles}export const A = () => <div class={styles.root} title={styles?.label} />;`))
      .toBe(`${kept}export const A = () => <div class={"root_x"} title={"root_x label_x"} />;`);
  });

  test('a class list of names and strings only becomes one string', () => {
    expect(inline(`${styles}export const A = () => <div class={[styles.root, 'plain', styles.label]} />;`))
      .toBe(`${kept}export const A = () => <div class={"root_x plain root_x label_x"} />;`);
  });

  test('a class list with a condition keeps its form', () => {
    expect(inline(`${styles}export const A = (p) => <div class={[styles.root, p.on && styles.label]} />;`))
      .toBe(`${kept}export const A = (p) => <div class={["root_x", p.on && "root_x label_x"]} />;`);
  });

  test('unknown names, computed reads and inherited properties stay reads of the import', () => {
    expect(inline(`${styles}export const A = (p) => <div class={styles.root} id={styles.missing} title={styles[p.kind]} lang={styles.toString} />;`))
      .toBe(`${kept}export const A = (p) => <div class={"root_x"} id={styles.missing} title={styles[p.kind]} lang={styles.toString} />;`);
  });

  test('property names and object keys of the same name are no use of the import', () => {
    expect(inline(`${styles}export const A = (p) => <div class={styles.root} title={p.styles.root} data-x={{ styles: 1 }.styles} />;`))
      .toBe(`${kept}export const A = (p) => <div class={"root_x"} title={p.styles.root} data-x={{ styles: 1 }.styles} />;`);
  });

  for (const [name, body] of [
    ['a shadowing parameter', `export const A = (list) => <div class={list.empty} />;`],
    ['a shadowing destructuring', `export const A = ({ list }) => <div class={list.empty} />;`],
    ['the object passed on', `export const A = () => <B classes={list} class={list.empty} />;`],
    ['an assignment to a member', `list.empty = 'x'; export const A = () => <div class={list.empty} />;`],
  ] as const) {
    test(`${name} leaves the import untouched`, () => {
      expect(inline(`import list from './list.module.css';\n${body}`)).toBeUndefined();
    });
  }

  test('each import is judged on its own', () => {
    expect(inline(`${styles}import list from './list.module.css';\nexport const A = (list) => <div class={[styles.root, list.empty]} />;`))
      .toBe(`${kept}import list from './list.module.css';\nexport const A = (list) => <div class={["root_x", list.empty]} />;`);
  });

  test('files without a known CSS Module are not changed', () => {
    expect(inline(`import styles from './other.module.css';\nexport const A = () => <div class={styles.root} />;`)).toBeUndefined();
    expect(inline(`export const A = () => <div class="a" />;`)).toBeUndefined();
  });

  test('positions after an edit still map to the authored line', () => {
    const source = `${styles}export const A = () => <div class={styles.root}>\n  {probe()}\n</div>;`;
    const result = inlineCssClasses(source, '/app/View.tsx', maps)!;
    const offset = result.code.indexOf('probe');
    const before = result.code.slice(0, offset);
    const original = originalPositionFor(new TraceMap(result.map.toString()), { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') - 1 });
    expect([original.line, original.column]).toEqual([3, 3]);
  });
});

describe('build', () => {
  const root = join(import.meta.dir, 'fixtures/css-classes');
  const outdir = join(root, 'dist-test');
  afterAll(() => rm(outdir, { recursive: true, force: true }));

  test('static classes are part of the template and their rules part of the stylesheet', async () => {
    await rm(outdir, { recursive: true, force: true });
    await build({ root, outdir: 'dist-test' });
    const read = async (pattern: string) => Bun.file(join(outdir, [...new Bun.Glob(pattern).scanSync({ cwd: outdir })][0]!)).text();
    const [js, css] = [await read('*.js'), await read('*.css')];
    const [, panel, title, button] = js.match(/<main class=(panel_[\w-]+)><h1 class="(title_[\w-]+) (button_[\w-]+) plain">/) ?? [];
    expect(panel && title && button).toBeTruthy();
    const active = js.match(/"(active_[\w-]+)"/)?.[1];
    for (const name of [panel, title, button, active]) expect(css).toContain(`.${name}{`);
    // Stylesheets keep the order of their imports: shared before App.
    expect(css.indexOf(`.${button}{`)).toBeLessThan(css.indexOf(`.${panel}{`));
  });
});
