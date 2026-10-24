import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import('./model.mjs').catch(() => ({}));
const id = '11111111-1111-4111-8111-111111111111',
  op = '22222222-2222-4222-8222-222222222222';
const draft = () => ({
  note_id: id,
  operation_id: op,
  expected_revision: 0,
  title: 'Synthetic',
  body: 'Text 😀\u202e',
});
test('exact immutable scalar snapshot preserves non-enumerable fields', () => {
  assert.equal(typeof m.validate, 'function');
  const x = draft();
  for (const k of Object.keys(x)) Object.defineProperty(x, k, { enumerable: false });
  const a = m.validate('publish', x);
  assert.deepEqual(a, draft());
  assert.equal(Object.isFrozen(a), true);
});
test('reject extra/accessor/prototype/Unicode/UUID/revision data', () => {
  assert.equal(typeof m.validate, 'function');
  for (const x of [
    { ...draft(), secret: 'x' },
    { ...draft(), title: '\ud800' },
    { ...draft(), note_id: id.toUpperCase().replace('1111', 'AAAA') },
    { ...draft(), expected_revision: -1 },
    { ...draft(), expected_revision: 2147483647 },
    Object.assign(Object.create({ x: 1 }), draft()),
    {
      ...draft(),
      get title() {
        throw Error('must not call');
      },
    },
  ])
    assert.throws(() => m.validate('publish', x));
});
test('preserve original values and reject exact UTF8/title bounds without truncation', () => {
  assert.equal(typeof m.validate, 'function');
  assert.equal(m.validate('publish', { ...draft(), body: '😀'.repeat(2048) }).body.length, 4096);
  for (const x of [
    { ...draft(), body: 'A'.repeat(8193) },
    { ...draft(), body: '😀'.repeat(2049) },
    { ...draft(), title: 'x'.repeat(121) },
    { ...draft(), title: ' \t' },
    { ...draft(), title: 'x\0y' },
  ])
    assert.throws(() => m.validate('publish', x));
});
test('exact read/revoke/status schemas reject additional private data', () => {
  assert.equal(typeof m.validate, 'function');
  assert.deepEqual(m.validate('read', { note_id: id, revision: 1 }), { note_id: id, revision: 1 });
  assert.deepEqual(m.validate('status', { note_id: id, operation_id: op }), {
    note_id: id,
    operation_id: op,
  });
  assert.throws(() => m.validate('read', { note_id: id, revision: 0 }));
  assert.throws(() => m.validate('revoke', { ...draft(), expected_revision: 1 }));
  assert.throws(() => m.validate('list', { owner: 'other' }));
});
test('operation digest binds owner/action/content/revision with stable property order', async () => {
  assert.equal(typeof m.operationHash, 'function');
  const a = draft(),
    h = await m.operationHash('owner', 'publish', a);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(
    h,
    await m.operationHash('owner', 'publish', Object.fromEntries(Object.entries(a).reverse())),
  );
  for (const [owner, action, args] of [
    ['other', 'publish', a],
    ['owner', 'publish', { ...a, body: 'different' }],
    ['owner', 'publish', { ...a, expected_revision: 1 }],
  ])
    assert.notEqual(h, await m.operationHash(owner, action, args));
});
