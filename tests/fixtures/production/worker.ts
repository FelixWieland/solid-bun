import { createSignal } from 'solid-js';

const [count] = createSignal(0);
postMessage(count());
