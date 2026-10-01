import { afterAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from '../src/index';
import * as stub from '../src/server-functions-stub';

const root = join(import.meta.dir, 'fixtures/router');
const outdir = join(root, 'dist-test');

afterAll(() => rm(outdir, { recursive: true, force: true }));

test('router builds without the server function runtime and seroval', async () => {
  await rm(outdir, { recursive: true, force: true });
  await build({ root, outdir: 'dist-test' });
  const [map] = [...new Bun.Glob('*.js.map').scanSync({ cwd: outdir })];
  const { sources } = await Bun.file(join(outdir, map!)).json() as { sources: string[] };
  expect(sources.some(source => source.includes('@solidjs/router'))).toBe(true);
  expect(sources.some(source => source.endsWith('server-functions-stub.ts'))).toBe(true);
  expect(sources.filter(source => /seroval|server-functions\/dist|serialization\/dist/.test(source))).toEqual([]);
});

describe('server function stub', () => {
  test('redirect header, flight data and action URLs are inert', () => {
    expect(stub.decodeRedirectHeaderValue('302 https://example.test/')).toBeUndefined();
    expect(stub.parseServerFunctionActionUrl('/_server/abc')).toBeUndefined();
    const unsubscribe = stub.subscribeFlightData(() => {});
    expect(unsubscribe()).toBeUndefined();
  });

  test('action responses decode plain bodies like the real client', async () => {
    expect(await stub.decodeResponsePayload(new Response(null, { status: 302 }))).toEqual({ value: undefined });
    expect(await stub.decodeResponsePayload(Response.json({ a: 1 }))).toEqual({ value: undefined });
    const form = await stub.decodeResponsePayload(new Response('a=1', { headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(String(form.value)).toBe('a=1');
  });

  test('server function calls fail explicitly', async () => {
    expect(() => stub.createServerReference()).toThrow('server functions');
    expect(() => stub.decodeFlashCookie()).toThrow('server functions');
    const serialized = new Response('x', { headers: { 'X-Server-Function-Format': 'serialized' } });
    await expect(stub.decodeResponsePayload(serialized)).rejects.toThrow('server functions');
  });
});
