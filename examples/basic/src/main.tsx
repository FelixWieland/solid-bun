import { render } from '@solidjs/web';
import { watchWorker } from 'solid-bun/client';
import { Counter } from './Counter';

const dispose = render(() => <Counter />, document.getElementById('root')!);
const stopWorker = watchWorker('greeting', (url, signal) => new Promise((resolve, reject) => {
  const worker = new Worker(url, { type: 'module' });
  const abort = () => { worker.terminate(); reject(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
  worker.onerror = event => {
    signal.removeEventListener('abort', abort); worker.terminate(); reject(new Error(event.message));
  };
  worker.onmessage = event => {
    signal.removeEventListener('abort', abort);
    resolve({
      activate() { document.getElementById('worker-output')!.textContent = String(event.data); },
      dispose() { worker.terminate(); },
    });
  };
}), { hot: Boolean(import.meta.hot) });

function cleanup() { stopWorker(); dispose(); window.removeEventListener('pagehide', cleanup); }
window.addEventListener('pagehide', cleanup, { once: true });
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(cleanup);
}
