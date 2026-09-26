import { test, expect } from 'bun:test';
import { render } from '@solidjs/web';
import { Counter } from './Counter';

test('counter responds to a click', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const dispose = render(() => <Counter />, root);
  try {
    const button = root.querySelector('button')!;
    expect(button.textContent).toBe('Count: 0');
    button.click(); await Promise.resolve();
    expect(button.textContent).toBe('Count: 1');
    expect(root.querySelector('main')!.className).not.toBe('');
  } finally { dispose(); root.remove(); }
});
