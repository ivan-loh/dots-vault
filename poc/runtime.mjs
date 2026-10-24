import { listFixtures, readFixture } from './fixtures.mjs';
import { parseRequest, object } from './rpc.mjs';
import { PROTOCOL_VERSION, validateProtocol, protocolError, completeResult } from './protocol.mjs';
import { sharedTools, callSharedTool } from '../shared-notes/adapter.mjs';

const safeString = (value, max) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  value.isWellFormed() &&
  value.trim() === value;
export function config(pins) {
  try {
    if (
      !safeString(pins?.VAULT_OWNER_SUBJECT, 256) ||
      !safeString(pins?.VAULT_CANONICAL_ORIGIN, 2048)
    )
      return null;
    const url = new URL(pins.VAULT_CANONICAL_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== pins.VAULT_CANONICAL_ORIGIN) return null;
    return {
      owner: pins.VAULT_OWNER_SUBJECT,
      origin: url.origin,
      hosts: [url.host, ...(url.port ? [] : [url.host + ':443'])],
    };
  } catch {
    return null;
  }
}
export function pocNamespace(pathname) {
  let decoded = pathname;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    /* Classification only; exact authorization still rejects malformed URLs. */
  }
  return /^\/mcp(?:\/|$)/i.test(decoded.replaceAll('\\', '/').replace(/\/{2,}/g, '/'));
}
export function rejectPocAlias(url) {
  return (
    pocNamespace(url.pathname) &&
    (url.pathname !== '/mcp' || url.href.includes('?') || url.hash !== '')
  );
}
const headers = () => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
});
const json = (body, status = 200, head = false) =>
  new Response(head ? null : JSON.stringify(body), { status, headers: headers() });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const content = (value) => [{ type: 'text', text: JSON.stringify(value) }];
const tools = [
  {
    name: 'list_poc_fixtures',
    description:
      'List fixed invented proof-of-connection fixtures only. Never lists your encrypted vault.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'read_poc_fixture',
    description:
      'Read one fixed invented fixture. Dummy credentials work on no real account. No user-created vault data is accessible.',
    inputSchema: {
      type: 'object',
      properties: {
        fixture_id: { type: 'string', enum: ['note-demo', 'contact-demo', 'credential-demo'] },
      },
      required: ['fixture_id'],
      additionalProperties: false,
    },
  },
];
export async function boundedBody(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > 65536))
    throw new Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_REQUEST');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('INVALID_REQUEST');
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error('BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
/**
 * Values supplied by the Sites adapter are validated at runtime before use.
 * @param {Request} request
 * @param {{enabled?: boolean, sharedEnabled?: boolean, getSharedStore?: (() => any), pins?: {VAULT_OWNER_SUBJECT?: unknown, VAULT_CANONICAL_ORIGIN?: unknown}, getIdentity?: (() => unknown), diagnostic?: ((reason: string) => void)}} [options]
 * @returns {Promise<Response>}
 */
export async function handlePocRequest(
  request,
  { enabled = false, sharedEnabled = false, getSharedStore, pins, getIdentity, diagnostic } = {},
) {
  if (enabled !== true) return json({ code: 'CONNECTOR_POC_DISABLED' }, 503);
  // Diagnostics receive only these hard-coded reasons, never request values.
  const note = (reason) => {
    try {
      diagnostic?.(reason);
    } catch {
      /* Logging must not alter access decisions. */
    }
  };
  const denied = (reason) => {
    note(reason);
    return json({ code: 'NOT_AUTHORIZED' }, 403, request.method === 'HEAD');
  };
  const configuration = config(pins);
  if (!configuration) {
    note('unconfigured');
    return json({ code: 'CONNECTOR_POC_UNCONFIGURED' }, 503);
  }
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return json({ code: 'NOT_FOUND' }, 404);
  }
  if (url.origin !== configuration.origin) return denied('url_origin');
  // Sites dispatch supplies the canonical Request URL and authenticated identity.
  // Raw Host is redundant and may be omitted by a Fetch-based transport. If it
  // exists, accept only the same ASCII authority, never forwarded-header claims.
  const host = request.headers.get('host');
  if (
    host !== null &&
    (!/^[\x21-\x7e]+$/.test(host) || !configuration.hosts.includes(host.toLowerCase()))
  )
    return denied('host');
  if (url.pathname !== '/mcp' || url.href.includes('?') || url.hash)
    return json({ code: 'NOT_FOUND' }, 404, request.method === 'HEAD');
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== configuration.origin) return denied('origin');
  let identity;
  try {
    identity = await getIdentity();
  } catch {
    return denied('identity_error');
  }
  if (!identity) return denied('identity_missing');
  if (identity.userId !== configuration.owner) return denied('owner_mismatch');
  if (!safeString(identity.email, 320)) return denied('email_missing');
  if (request.method !== 'POST')
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, request.method === 'HEAD');
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get('content-type') ?? '',
    ) ||
    request.headers.has('content-encoding')
  )
    return json({ code: 'CONTENT_TYPE' }, 415);
  let rpc;
  try {
    rpc = parseRequest(await boundedBody(request));
  } catch (error) {
    return error?.message === 'BODY_TOO_LARGE'
      ? json({ code: 'BODY_TOO_LARGE' }, 413)
      : json(rpcError(null, -32600, 'Invalid request.'), 400);
  }
  try {
    validateProtocol(request, rpc);
  } catch (error) {
    return json({ jsonrpc: '2.0', id: rpc.id, error: protocolError(error) }, 400);
  }
  if (!['server/discover', 'tools/list', 'tools/call'].includes(rpc.method))
    return json(rpcError(rpc.id, -32601, 'Method not found; supported protocol: 2026-07-28.'), 404);
  if (rpc.method === 'server/discover')
    return json({
      jsonrpc: '2.0',
      id: rpc.id,
      result: completeResult(
        { supportedVersions: [PROTOCOL_VERSION], capabilities: { tools: {} } },
        true,
      ),
    });
  if (rpc.method === 'tools/list')
    return json({
      jsonrpc: '2.0',
      id: rpc.id,
      result: completeResult(
        { tools: sharedEnabled === true ? [...tools, ...sharedTools] : tools },
        true,
      ),
    });
  try {
    const { name, arguments: args = {} } = rpc.params;
    let result;
    if (typeof name !== 'string') throw new Error('INVALID_ARGUMENTS');
    if (name === 'list_poc_fixtures') {
      object(args, []);
      result = listFixtures();
    } else if (name === 'read_poc_fixture') {
      object(args, ['fixture_id']);
      if (!safeString(args.fixture_id, 80)) throw new Error('INVALID_ARGUMENTS');
      result = readFixture(args.fixture_id);
      if (!result) throw new Error('UNAVAILABLE');
    } else if (sharedEnabled === true && sharedTools.some((tool) => tool.name === name))
      result = await callSharedTool(name, args, configuration.owner, getSharedStore);
    else throw new Error('UNKNOWN_TOOL');
    return json({
      jsonrpc: '2.0',
      id: rpc.id,
      result: completeResult({ content: content(result), isError: false }),
    });
  } catch (error) {
    const code = ['INVALID_ARGUMENTS', 'UNAVAILABLE', 'UNKNOWN_TOOL'].includes(error?.message)
      ? error.message
      : 'INTERNAL_ERROR';
    return json({
      jsonrpc: '2.0',
      id: rpc.id,
      result: completeResult({ content: content({ error: code }), isError: true }),
    });
  }
}
