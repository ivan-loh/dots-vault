import { config, boundedBody } from '../poc/runtime.mjs';
import { parseRequest } from '../poc/rpc.mjs';
import { validate } from './model.mjs';

export const sharedHeaders = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
});
const json = (value, status = 200, head = false) =>
  new Response(head ? null : JSON.stringify(value), {
    status,
    headers: { ...sharedHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
export function sharedNamespace(path) {
  let value = path;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(value);
      if (next === value) break;
      value = next;
    }
  } catch {
    /* Classification only. */
  }
  return /^\/shared-notes(?:\/|$)/i.test(value.replaceAll('\\', '/').replace(/\/{2,}/g, '/'));
}
export const sharedPaths = Object.freeze([
  '/shared-notes',
  '/shared-notes/api',
  '/shared-notes/app.mjs',
  '/shared-notes/session.mjs',
  '/shared-notes/transport.mjs',
  '/shared-notes/model.mjs',
  '/shared-notes/styles.css',
]);
export const rejectSharedAlias = (url) =>
  !sharedPaths.includes(url.pathname) || url.href.includes('?') || Boolean(url.hash);
/** @param {Request} request
 * @param {{enabled?:boolean,pins?:object,getIdentity?:()=>any,getStore?:()=>any,assets?:Record<string,{body:string,type:string}>}} [options] */
export async function handleSharedRequest(
  request,
  { enabled = false, pins, getIdentity, getStore, assets = {} } = {},
) {
  if (enabled !== true) return json({ code: 'SHARED_NOTES_DISABLED' }, 503);
  const head = request.method === 'HEAD',
    settings = config(pins);
  if (!settings) return json({ code: 'SHARED_NOTES_UNCONFIGURED' }, 503, head);
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return json({ code: 'NOT_FOUND' }, 404, head);
  }
  if (rejectSharedAlias(url)) return json({ code: 'NOT_FOUND' }, 404, head);
  const host = request.headers.get('host'),
    origin = request.headers.get('origin');
  if (
    url.origin !== settings.origin ||
    (host !== null &&
      (!/^[\x21-\x7e]+$/.test(host) || !settings.hosts.includes(host.toLowerCase()))) ||
    (origin !== null && origin !== settings.origin)
  )
    return json({ code: 'NOT_AUTHORIZED' }, 403, head);
  let who;
  try {
    who = await getIdentity();
  } catch {
    return json({ code: 'NOT_AUTHORIZED' }, 403, head);
  }
  if (
    who?.userId !== settings.owner ||
    typeof who?.email !== 'string' ||
    !who.email.isWellFormed() ||
    !who.email ||
    who.email.length > 320 ||
    who.email.trim() !== who.email
  )
    return json({ code: 'NOT_AUTHORIZED' }, 403, head);
  if (url.pathname !== '/shared-notes/api') {
    if (!['GET', 'HEAD'].includes(request.method))
      return json({ code: 'METHOD_NOT_ALLOWED' }, 405, head);
    const asset = assets[url.pathname];
    if (!asset) return json({ code: 'NOT_FOUND' }, 404, head);
    return new Response(head ? null : asset.body, {
      headers: { ...sharedHeaders, 'Content-Type': asset.type },
    });
  }
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405, head);
  if (origin !== settings.origin) return json({ code: 'NOT_AUTHORIZED' }, 403);
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get('content-type') ?? '',
    ) ||
    request.headers.has('content-encoding')
  )
    return json({ code: 'CONTENT_TYPE' }, 415);
  let rpc, args;
  try {
    rpc = parseRequest(await boundedBody(request));
    args = validate(rpc.method, rpc.params);
  } catch (error) {
    return json(
      { code: error?.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INVALID_ARGUMENTS' },
      error?.message === 'BODY_TOO_LARGE' ? 413 : 400,
    );
  }
  try {
    const store = getStore();
    const result =
      rpc.method === 'list'
        ? { notes: await store.list(settings.owner) }
        : await store[rpc.method](settings.owner, args);
    return json({ result });
  } catch (error) {
    const allowed = [
      'UNAVAILABLE',
      'CONFLICT',
      'OPERATION_ID_REUSED',
      'CAPACITY',
      'RATE_LIMIT',
      'INVALID_ARGUMENTS',
    ];
    const code = allowed.includes(error?.message) ? error.message : 'STORAGE_UNAVAILABLE';
    return json(
      { code },
      code === 'RATE_LIMIT'
        ? 429
        : code === 'UNAVAILABLE'
          ? 404
          : code === 'INVALID_ARGUMENTS'
            ? 400
            : code === 'STORAGE_UNAVAILABLE'
              ? 503
              : 409,
    );
  }
}
