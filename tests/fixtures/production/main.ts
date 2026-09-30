import { createSignal } from 'solid-js';
import { render } from '@solidjs/web';

const [count] = createSignal(0);
render(() => String(count()), document.getElementById('root')!);
