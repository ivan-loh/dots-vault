export const MAX_ACTIVE = 50,
  MAX_TOTAL = 5000,
  MAX_REVISION = 2147483647;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const fail = (code) => {
  throw new Error(code);
};
export function ownerId(value) {
  if (
    typeof value !== 'string' ||
    !value.isWellFormed() ||
    value.length < 1 ||
    value.length > 256 ||
    value.trim() !== value
  )
    fail('NOT_AUTHORIZED');
  return value;
}
function object(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail('INVALID_ARGUMENTS');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((k) => !keys.includes(k))) fail('INVALID_ARGUMENTS');
  const out = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value')) fail('INVALID_ARGUMENTS');
    out[key] = d.value;
  }
  return out;
}
function id(value) {
  if (typeof value !== 'string' || !uuid.test(value)) fail('INVALID_ARGUMENTS');
  return value;
}
function revision(value, min, max = MAX_REVISION) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max)
    fail('INVALID_ARGUMENTS');
  return value;
}
export function validate(action, input) {
  const keys = {
    list: [],
    read: ['note_id', 'revision'],
    status: ['note_id', 'operation_id'],
    publish: ['note_id', 'operation_id', 'expected_revision', 'title', 'body'],
    revoke: ['note_id', 'operation_id', 'expected_revision'],
  }[action];
  if (!keys) fail('INVALID_ARGUMENTS');
  const x = object(input, keys);
  if (action === 'list') return Object.freeze(x);
  id(x.note_id);
  if ('operation_id' in x) id(x.operation_id);
  if (action === 'read') revision(x.revision, 1);
  if (action === 'revoke') revision(x.expected_revision, 1, MAX_REVISION - 1);
  if (action === 'publish') {
    revision(x.expected_revision, 0, MAX_REVISION - 2);
    if (
      typeof x.title !== 'string' ||
      !x.title.isWellFormed() ||
      !x.title.trim() ||
      x.title.includes('\0') ||
      [...x.title].length > 120
    )
      fail('INVALID_ARGUMENTS');
    if (
      typeof x.body !== 'string' ||
      !x.body.isWellFormed() ||
      x.body.length > 8192 ||
      new TextEncoder().encode(x.body).length > 8192
    )
      fail('INVALID_ARGUMENTS');
  }
  return Object.freeze(x);
}
export async function operationHash(owner, action, input) {
  const args = validate(action, input);
  ownerId(owner);
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, owner, action, args }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
