import { createSignal } from 'solid-js';
import { render } from '@solidjs/web';
import shared from './shared.module.css';
import styles from './App.module.css';

function App() {
  const [active, setActive] = createSignal(false);
  return <main class={styles.panel}>
    <h1 class={[styles.title, shared.button, 'plain']}>Title</h1>
    <button class={[shared.button, active() && styles.active]} onClick={() => setActive(value => !value)}>Toggle</button>
  </main>;
}

render(() => <App />, document.getElementById('root')!);
