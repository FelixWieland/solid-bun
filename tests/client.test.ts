import { test, expect } from 'bun:test';
import { watchWorker, type WorkerResource } from '../src/client';

test('worker readiness, rollback, obsolete candidates and cleanup', async () => {
  const original = globalThis.EventSource;
  let source: FakeEvents;
  class FakeEvents {
    onmessage?: (event: { data: string }) => void;
    closed = false;
    constructor() { source = this; }
    close() { this.closed = true; }
    send(update: unknown) { this.onmessage?.({ data: JSON.stringify(update) }); }
  }
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, writable: true, value: FakeEvents });
  const pending = new Map<string, { resolve: (resource: WorkerResource) => void; signal: AbortSignal }>();
  const activated: string[] = []; const disposed: string[] = []; const errors: unknown[] = [];
  const url = (name: string) => `/__solid-bun/workers/demo/${name}.js`;
  const update = (name: string) => source.send({ url: url(name) });
  const resource = (name: string): WorkerResource => ({ activate() { activated.push(name); }, dispose() { disposed.push(name); } });
  const stop = watchWorker('demo', (url, signal) => new Promise(resolve => pending.set(url, { resolve, signal })), { hot: true, onError: error => errors.push(error) });
  try {
    update('one'); pending.get(url('one'))!.resolve(resource('one')); await Promise.resolve();
    expect(activated).toEqual(['one']);
    update('two'); expect(disposed).toEqual([]);
    source!.send({ error: 'compile failed' }); expect(pending.get(url('two'))!.signal.aborted).toBe(true);
    pending.get(url('two'))!.resolve(resource('two')); await Promise.resolve();
    expect(disposed).toEqual(['two']); expect(activated).toEqual(['one']);
    update('three'); update('one');
    expect(pending.get(url('three'))!.signal.aborted).toBe(true);
    pending.get(url('three'))!.resolve(resource('three')); await Promise.resolve();
    update('four'); pending.get(url('four'))!.resolve(resource('four')); await Promise.resolve();
    expect(activated).toEqual(['one', 'four']); expect(disposed).toContain('one');
    expect(errors).toHaveLength(1);
  } finally { stop(); stop(); Object.defineProperty(globalThis, 'EventSource', { configurable: true, writable: true, value: original }); }
  expect(source!.closed).toBe(true); expect(disposed.filter(value => value === 'four')).toHaveLength(1);
});

test('readiness timeout aborts preparation and disposes a late resource', async () => {
  let signal: AbortSignal | undefined;
  let finish!: (resource: WorkerResource) => void;
  let disposed = false; let activated = false;
  const errors: unknown[] = [];
  const stop = watchWorker('demo', (_url, value) => { signal = value; return new Promise(resolve => { finish = resolve; }); }, { timeout: 10, onError: error => errors.push(error) });
  try {
    await Bun.sleep(30); expect(signal!.aborted).toBe(true); expect(errors).toHaveLength(1);
    finish({ activate() { activated = true; }, dispose() { disposed = true; } }); await Promise.resolve();
    expect(disposed).toBe(true); expect(activated).toBe(false);
  } finally { stop(); }
});
