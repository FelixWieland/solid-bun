/** An already-prepared candidate. activate must be synchronous and exception-safe. */
export interface WorkerResource {
  activate(): void;
  dispose(): void;
}

export interface WorkerWatchOptions {
  /** Pass Boolean(import.meta.hot) from the application entry. Defaults to false. */
  hot?: boolean;
  timeout?: number;
  onError?: (error: unknown) => void;
}

/** Prepare a worker (or group) before replacing the last working resource.
 * Honor signal during preparation and dispose partial resources when it aborts.
 */
export function watchWorker(
  name: string,
  prepare: (url: string, signal: AbortSignal) => Promise<WorkerResource>,
  options: WorkerWatchOptions = {},
): () => void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid worker name: ${name}`);
  const report = options.onError ?? console.error;
  let active: WorkerResource | undefined;
  let activeUrl = '';
  let pending: AbortController | undefined;
  let pendingUrl = '';
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() { clearTimeout(timer); pending?.abort(); pending = undefined; pendingUrl = ''; }
  async function replace(url: string) {
    if (stopped || url === pendingUrl) return;
    cancel();
    if (url === activeUrl) return;
    const controller = new AbortController();
    pending = controller; pendingUrl = url;
    timer = setTimeout(() => {
      if (pending === controller) { cancel(); report(new Error(`Worker ${name} readiness timed out`)); }
    }, options.timeout ?? 5000);
    let candidate: WorkerResource | undefined;
    try {
      candidate = await prepare(url, controller.signal);
      if (stopped || controller.signal.aborted) { candidate.dispose(); return; }
      candidate.activate();
      const previous = active;
      active = candidate; activeUrl = url;
      clearTimeout(timer); pending = undefined; pendingUrl = '';
      previous?.dispose();
    } catch (error) {
      if (candidate !== active) candidate?.dispose();
      if (!controller.signal.aborted && !stopped) { cancel(); report(error); }
    }
  }
  const events = options.hot ? new EventSource(`/__solid-bun/workers/${name}/events`) : undefined;
  if (events) events.onmessage = event => {
    try {
      const update: unknown = JSON.parse(event.data);
      if (!update || typeof update !== 'object') throw new Error('Invalid worker update');
      if ('error' in update && typeof update.error === 'string') { cancel(); report(new Error(update.error)); }
      else if ('url' in update && typeof update.url === 'string' && update.url.startsWith(`/__solid-bun/workers/${name}/`)) void replace(update.url);
      else throw new Error('Invalid worker update');
    } catch (error) { report(error); }
  };
  else void replace(`/workers/${name}.js`);
  return () => { if (stopped) return; stopped = true; events?.close(); cancel(); active?.dispose(); active = undefined; };
}
