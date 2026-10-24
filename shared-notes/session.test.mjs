import test from 'node:test';
import assert from 'node:assert/strict';
const { SharedSession, reviewText } = await import('./session.mjs').catch(() => ({}));
const id = '11111111-1111-4111-8111-111111111111',
  op = '22222222-2222-4222-8222-222222222222';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function setup(api = {}) {
  assert.equal(typeof SharedSession, 'function');
  let now = 0,
    i = 0;
  return {
    s: new SharedSession(
      { list: async () => ({ notes: [] }), ...api },
      { now: () => now, uuid: () => (i++ ? op : id) },
    ),
    tick: () => (now += 60001),
  };
}
function draft(s) {
  s.newNote();
  s.edit('title', 'Synthetic');
  s.edit('body', 'Original 😀\u202e');
}
test('publication requires exact nonexpired review, edits invalidate it', async () => {
  let calls = 0;
  const { s, tick } = setup({
    publish: async () => {
      calls++;
      return { note_id: id, revision: 1, state: 'shared' };
    },
  });
  draft(s);
  assert.throws(() => s.confirm(), /REVIEW_REQUIRED/);
  s.reviewPublish();
  s.edit('body', 'changed');
  assert.throws(() => s.confirm(), /REVIEW_REQUIRED/);
  s.reviewPublish();
  tick();
  assert.throws(() => s.confirm(), /REVIEW_EXPIRED/);
  s.reviewPublish();
  await s.confirm();
  assert.equal(calls, 1);
  assert.equal(s.view().draft, null);
});
test('exact review escapes every non-ASCII code unit without altering payload', async () => {
  assert.equal(typeof reviewText, 'function');
  const value = 'a😀\u202e\u2066\u2028\u034f';
  const shown = reviewText(value);
  assert.doesNotMatch(shown, /[^\x20-\x7e]/);
  assert.equal(JSON.parse(shown), value);
  let sent;
  const { s } = setup({
    publish: async (args) => {
      sent = args;
      return { note_id: id, revision: 1, state: 'shared' };
    },
  });
  draft(s);
  s.edit('body', value);
  s.reviewPublish();
  await s.confirm();
  assert.equal(sent.body, value);
});
test('oversized draft is retained and rejected, never truncated or submitted', () => {
  const { s } = setup();
  draft(s);
  const text = 'x'.repeat(9000);
  s.edit('body', text);
  assert.throws(() => s.reviewPublish(), /INVALID_ARGUMENTS/);
  assert.equal(s.view().draft.body, text);
});
test('duplicate confirm is blocked, conceal removes content even across response', async () => {
  const flight = deferred();
  let calls = 0;
  const { s } = setup({
    publish: async () => {
      calls++;
      return flight.promise;
    },
  });
  draft(s);
  s.reviewPublish();
  const pending = s.confirm();
  assert.throws(() => s.confirm(), /REQUEST_IN_PROGRESS/);
  s.clear();
  assert.equal(s.view().draft, null);
  assert.equal(s.view().pending.canRetry, false);
  assert.equal(s.view().busy, true);
  flight.resolve({ note_id: id, revision: 1, state: 'shared' });
  await pending;
  assert.equal(calls, 1);
  assert.equal(s.view().draft, null);
  assert.equal(s.view().pending, null);
  assert.equal(s.view().busy, false);
});
test('ambiguous mutation refresh/clear cannot deadlock or release a newer status flight', async () => {
  const list = deferred(),
    status = deferred();
  const { s } = setup({
    publish: async () => {
      throw Error('network');
    },
    list: () => list.promise,
    status: () => status.promise,
  });
  draft(s);
  s.reviewPublish();
  await assert.rejects(s.confirm());
  const refresh = s.refresh();
  s.clear();
  assert.equal(s.view().busy, false);
  const check = s.checkOutcome();
  list.resolve({ notes: [] });
  await refresh;
  assert.equal(s.view().busy, true);
  status.resolve({ matched: false, current_revision: null, state: null });
  await check;
  assert.equal(s.view().busy, false);
  assert.ok(s.view().pending);
});
test('stale list/read results cannot revive plaintext after clear', async () => {
  for (const action of ['refresh', 'open']) {
    const flight = deferred();
    const { s } = setup({ list: () => flight.promise, read: () => flight.promise });
    const p = action === 'refresh' ? s.refresh() : s.open({ note_id: id, revision: 1 });
    s.clear();
    flight.resolve(
      action === 'refresh'
        ? { notes: [{ note_id: id, revision: 1, title: 'secret' }] }
        : { note_id: id, revision: 1, title: 'secret', body: 'secret' },
    );
    await p;
    assert.equal(s.view().draft, null);
    assert.deepEqual(s.view().notes, []);
  }
});
test('retry preserves exact approved request and unmatched status remains unknown', async () => {
  const sent = [];
  const { s } = setup({
    publish: async (a) => {
      sent.push(a);
      if (sent.length === 1) throw Error('lost');
      return { note_id: id, revision: 1, state: 'shared' };
    },
    status: async () => ({ matched: false, current_revision: 2, state: 'shared' }),
  });
  draft(s);
  s.reviewPublish();
  await assert.rejects(s.confirm());
  await s.checkOutcome();
  assert.ok(s.view().pending);
  await s.retry();
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(s.view().pending, null);
});
test('revoke review sends exact revision-only args; forgetting tracking is not revoke', async () => {
  let sent;
  const { s } = setup({
    read: async () => ({ note_id: id, revision: 3, title: 'Synthetic', body: 'Body' }),
    revoke: async (a) => {
      sent = a;
      throw Error('lost');
    },
  });
  await s.open({ note_id: id, revision: 3 });
  s.reviewRevoke();
  await assert.rejects(s.confirm());
  assert.deepEqual(Object.keys(sent).sort(), ['expected_revision', 'note_id', 'operation_id']);
  s.clear();
  s.forgetPending();
  assert.equal(s.view().pending, null);
  assert.match(s.view().message, /may have completed/);
});
test('real browser ingress list contract is consumed by the session, not a mock shape', async () => {
  const { handleSharedRequest } = await import('./ingress.mjs');
  const origin = 'https://vault.example';
  const notes = [{ note_id: id, revision: 1, title: 'Synthetic integration' }];
  const api = {
    list: async () => {
      const request = new Request(origin + '/shared-notes/api', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'list', params: {} }),
      });
      const response = await handleSharedRequest(request, {
        enabled: true,
        pins: { VAULT_OWNER_SUBJECT: 'owner', VAULT_CANONICAL_ORIGIN: origin },
        getIdentity: () => ({ userId: 'owner', email: 'owner@example.test' }),
        getStore: () => ({ list: async () => notes }),
      });
      assert.equal(response.status, 200);
      return (await response.json()).result;
    },
  };
  const { s } = setup(api);
  await s.refresh();
  assert.deepEqual(s.view().notes, notes);
});
