import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from './transport.mjs';
import { SharedSession } from './session.mjs';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function start(s) {
  s.newNote();
  s.edit('title', 'Synthetic');
  s.edit('body', 'Exact body 😀');
  s.reviewPublish();
}
test('body deadline cancels transport but reconciles an already committed mutation', async () => {
  let saved,
    signal,
    cancelled = false;
  const api = createApi(async (_url, options) => {
    const req = JSON.parse(options.body);
    signal = options.signal;
    if (req.method === 'publish') {
      saved = req.params;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"result":'));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    }
    return Response.json({
      result: { matched: true, kind: 'publish', current_revision: 1, state: 'shared' },
    });
  }, 15);
  const s = new SharedSession(api);
  start(s);
  await assert.rejects(s.confirm(), /REQUEST_TIMEOUT/);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(s.view().busy, false);
  assert.equal(s.view().pending.canRetry, true);
  assert.match(s.view().message, /Outcome unknown/);
  await s.checkOutcome();
  assert.equal(s.view().pending, null);
  assert.match(s.view().message, /Published/);
  assert.equal(saved.body, 'Exact body 😀');
});
test('late response cannot clear timed-out pending state; retry reuses every approved byte', async () => {
  const first = deferred(),
    calls = [];
  let firstSignal;
  const api = createApi(async (_url, options) => {
    const req = JSON.parse(options.body);
    calls.push(req);
    if (calls.length === 1) {
      firstSignal = options.signal;
      return first.promise;
    }
    return Response.json({ result: { note_id: req.params.note_id, revision: 1, state: 'shared' } });
  }, 15);
  const s = new SharedSession(api);
  start(s);
  await assert.rejects(s.confirm(), /REQUEST_TIMEOUT/);
  assert.equal(firstSignal.aborted, true);
  first.resolve(
    Response.json({ result: { note_id: calls[0].params.note_id, revision: 1, state: 'shared' } }),
  );
  await delay(2);
  assert.ok(s.view().pending);
  assert.equal(s.view().busy, false);
  await s.retry();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(s.view().pending, null);
});
test('body timeout completes even if cancellation never acknowledges', async () => {
  let cancellation = false,
    signal;
  const api = createApi(async (_url, options) => {
    signal = options.signal;
    return new Response(
      new ReadableStream({
        pull() {},
        cancel() {
          cancellation = true;
          return new Promise(() => {});
        },
      }),
    );
  }, 15);
  const result = await Promise.race([
    api.list({}).then(
      () => false,
      (e) => e.message,
    ),
    delay(200).then(() => 'HUNG'),
  ]);
  assert.equal(result, 'REQUEST_TIMEOUT');
  assert.equal(cancellation, true);
  assert.equal(signal.aborted, true);
});
test('clear after timed-out mutation prevents reconstruction of the retry payload', async () => {
  const api = createApi(async () => new Promise(() => {}), 15),
    s = new SharedSession(api);
  start(s);
  await assert.rejects(s.confirm(), /REQUEST_TIMEOUT/);
  s.clear();
  assert.equal(s.view().draft, null);
  assert.equal(s.view().pending.canRetry, false);
  await assert.rejects(s.retry(), /RETRY_PAYLOAD_CLEARED/);
});
