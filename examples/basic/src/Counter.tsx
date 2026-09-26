import { createSignal } from 'solid-js';
import styles from './Counter.module.css';

export function Counter() {
  const [count, setCount] = createSignal(0);
  return <main class={styles.panel}>
    <h1>Solid 2 + Bun</h1>
    <p>Client rendering, CSS Modules and TypeScript workers.</p>
    <button onClick={() => setCount(value => value + 1)}>Count: {count()}</button>
    <p id="worker-output">Starting worker…</p>
  </main>;
}
