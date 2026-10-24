// Bounded JSON-RPC parser derived from the independently reviewed local contract.
const fail = (code) => {
  throw new Error(code);
};
export const object = (value, required, optional = []) => {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail('INVALID_ARGUMENTS');
  const keys = Reflect.ownKeys(value);
  if (
    required.some((key) => !keys.includes(key)) ||
    keys.some((key) => ![...required, ...optional].includes(key))
  )
    fail('INVALID_ARGUMENTS');
  for (const key of keys)
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
      fail('INVALID_ARGUMENTS');
  return value;
};
const text = (value) => typeof value === 'string' && value.isWellFormed();
const utf8 = new TextEncoder();
export function parseRequest(input) {
  let raw;
  if (typeof input === 'string') {
    if (input.length > 65536 || !input.isWellFormed() || utf8.encode(input).length > 65536)
      fail('INVALID_REQUEST');
    raw = input;
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > 65536) fail('INVALID_REQUEST');
    raw = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } else fail('INVALID_REQUEST');
  const parsed = JSON.parse(raw);
  // JSON.parse validates syntax; this nonrecursive structural pass rejects
  // duplicate decoded keys, escaped lone surrogates, deep objects and rounded IDs.
  const stack = [];
  const tokens = raw.matchAll(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/gs);
  for (const [token] of tokens) {
    const top = stack.at(-1);
    if (token[0] === '"') {
      const value = JSON.parse(token);
      if (!value.isWellFormed()) fail('INVALID_REQUEST');
      if (top?.kind === 'object' && top.key) {
        if (top.keys.has(value)) fail('INVALID_REQUEST');
        top.keys.add(value);
        top.key = false;
        top.currentKey = value;
      }
    } else if (token === '{' || token === '[') {
      if (stack.length >= 16) fail('INVALID_REQUEST');
      // Only params._meta is opaque protocol metadata. A similarly named key in
      // tool arguments is not metadata and does not relax argument validation.
      const metadata =
        top?.metadata === true ||
        (stack.length === 2 && stack[0].currentKey === 'params' && top?.currentKey === '_meta');
      stack.push(
        token === '{'
          ? { kind: 'object', key: true, keys: new Set(), metadata }
          : { kind: 'array', metadata },
      );
    } else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && top?.kind === 'object') top.key = true;
    else if (/^-?\d/.test(token)) {
      const number = Number(token);
      if (top?.metadata === true) {
        if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER)
          fail('INVALID_REQUEST');
      } else {
        const isId = stack.length === 1 && top?.kind === 'object' && top.currentKey === 'id';
        const canonical = isId ? /^(0|-?[1-9]\d*)$/ : /^(0|[1-9]\d*)$/;
        if (!canonical.test(token) || !Number.isSafeInteger(number) || String(number) !== token)
          fail('INVALID_REQUEST');
      }
    }
  }
  object(parsed, ['jsonrpc', 'id', 'method'], ['params']);
  if (
    parsed.jsonrpc !== '2.0' ||
    !text(parsed.method) ||
    !(
      Number.isSafeInteger(parsed.id) ||
      (text(parsed.id) && [...parsed.id].length > 0 && [...parsed.id].length <= 64)
    )
  )
    fail('INVALID_REQUEST');
  return parsed;
}
