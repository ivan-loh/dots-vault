import { object } from './rpc.mjs';

export const PROTOCOL_VERSION = '2026-07-28';
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const INFO_KEY = 'io.modelcontextprotocol/clientInfo';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) =>
  typeof value === 'string' && value.length > 0 && value.length <= limit && value.isWellFormed();

class ProtocolError extends Error {
  constructor(code, message, data = undefined) {
    super(message);
    this.code = code;
    this.data = data;
  }
}
const invalid = () => {
  throw new ProtocolError(-32602, 'Invalid protocol parameters.');
};
const mismatch = () => {
  throw new ProtocolError(-32020, 'Required request headers are missing or inconsistent.');
};

function decodedName(value) {
  if (!text(value, 512)) return null;
  if (!value.startsWith('=?base64?')) return /^[\x21-\x7e]+$/.test(value) ? value : null;
  if (!value.endsWith('?=')) return null;
  try {
    const encoded = value.slice(9, -2);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
      return null;
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

// Transport metadata is untrusted descriptive input, never an identity or grant.
// The outer 64-KiB/depth/duplicate-key parser bounds all ignored extension data.
export function validateProtocol(request, rpc) {
  const params = rpc.params,
    meta = params?._meta;
  if (
    !record(params) ||
    !record(meta) ||
    !text(meta[VERSION_KEY], 64) ||
    !record(meta[CAPABILITIES_KEY])
  )
    invalid();
  if (Object.hasOwn(meta, INFO_KEY)) {
    const info = meta[INFO_KEY];
    if (!record(info) || !text(info.name, 256) || !text(info.version, 128)) invalid();
  }
  if (
    request.headers.get('mcp-protocol-version') !== meta[VERSION_KEY] ||
    request.headers.get('mcp-method') !== rpc.method
  )
    mismatch();
  if (
    rpc.method === 'tools/call' &&
    (typeof params.name !== 'string' ||
      decodedName(request.headers.get('mcp-name')) !== params.name)
  )
    mismatch();
  if (meta[VERSION_KEY] !== PROTOCOL_VERSION) {
    // The protocol requires the bounded requested version in this JSON error.
    // It is never logged or used as identity, a tool name, or an argument.
    throw new ProtocolError(-32022, 'Unsupported protocol version.', {
      supported: [PROTOCOL_VERSION],
      requested: meta[VERSION_KEY],
    });
  }
  try {
    if (rpc.method === 'server/discover') object(params, ['_meta']);
    if (rpc.method === 'tools/list') {
      object(params, ['_meta'], ['cursor']);
      // This complete two-tool catalog has never issued a pagination cursor.
      if (Object.hasOwn(params, 'cursor')) invalid();
    }
    if (rpc.method === 'tools/call') object(params, ['_meta', 'name'], ['arguments']);
  } catch {
    invalid();
  }
  return params;
}

export function protocolError(error) {
  return error instanceof ProtocolError
    ? {
        code: error.code,
        message: error.message,
        ...(error.data ? { data: error.data } : {}),
      }
    : { code: -32602, message: 'Invalid protocol parameters.' };
}

export function completeResult(fields, cacheable = false) {
  return {
    resultType: 'complete',
    ...fields,
    _meta: {
      'io.modelcontextprotocol/serverInfo': { name: 'dots-vault-fictional-poc', version: '1.1.0' },
    },
    ...(cacheable ? { ttlMs: 0, cacheScope: 'private' } : {}),
  };
}
