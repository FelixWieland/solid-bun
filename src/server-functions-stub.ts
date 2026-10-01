/**
 * Replaces `@solidjs/web/server-functions` (and its `/client` and `/server`
 * entries) in client-only applications. `@solidjs/router` imports it
 * statically, which bundles the seroval codec and the server function
 * transport although solid-bun has no server functions. Behaviour matches
 * the real client for applications without server functions: no
 * server-function redirects, actions or flight data exist, so those paths are
 * inert, and calling a server function fails with an explicit error.
 * Written against @solidjs/web and @solidjs/router as pinned by solid-bun.
 */

const unavailable = (name: string) => () => {
  throw new Error(`solid-bun: ${name} needs Solid server functions, which client-only builds replace`);
};

export const REDIRECT_HEADER = 'X-Server-Function-Redirect';

/** Only server functions emit the redirect header. */
export function decodeRedirectHeaderValue(_value: unknown): undefined {
  return undefined;
}

/** No server function responses carry flight data. */
export function subscribeFlightData(..._args: unknown[]): () => void {
  return () => {};
}

/** No URL addresses a server function action. */
export function parseServerFunctionActionUrl(_url: string): undefined {
  return undefined;
}

/**
 * Body of a Response returned by an action. Bodies without the server
 * function format header decode as in the real client: form data and
 * URL-encoded bodies, everything else to undefined.
 */
export async function decodeResponsePayload(response: Response): Promise<{ value: unknown }> {
  if (!response.body) return { value: undefined };
  if (response.headers.has('X-Server-Function-Format')) unavailable('a server function response')();
  const type = response.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) return { value: await response.clone().formData() };
  if (type.startsWith('application/x-www-form-urlencoded')) return { value: new URLSearchParams(await response.clone().text()) };
  return { value: undefined };
}

export const createServerReference = unavailable('createServerReference');
export const decodeFlashCookie = unavailable('decodeFlashCookie');
