import { action, createRouter, useAction } from '@solidjs/router';
import { render } from '@solidjs/web';

const save = action(async () => 'saved');
const Home = () => {
  const run = useAction(save);
  void run;
  return 'home';
};
const Router = createRouter({ routes: [{ path: '/', component: Home }] });
render(() => Router({}), document.getElementById('root')!);
