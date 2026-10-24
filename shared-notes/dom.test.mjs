import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SharedSession, reviewText } from './session.mjs';
import { handleSharedRequest } from './ingress.mjs';
const code = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8').replace(
  /^import .*$/gm,
  '',
);
const transportCode = readFileSync(new URL('./transport.mjs', import.meta.url), 'utf8').replace(
  'export function createApi',
  'function createApi',
);
const html = readFileSync(new URL('./index.html.txt', import.meta.url), 'utf8');
const origin = 'https://vault.example';
const uuid = () => crypto.randomUUID();
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setImmediate(r));
function harness({ confirm = () => true } = {}) {
  const els = new Map(),
    timers = new Map(),
    requests = [],
    confirmations = [];
  let count = 0,
    captured,
    transport = async () =>
      new Response(JSON.stringify({ result: { notes: [] } }), {
        headers: { 'content-type': 'application/json' },
      });
  const document = {
    hidden: false,
    listeners: {},
    getElementById(id) {
      return els.get(id);
    },
    addEventListener(name, fn) {
      (this.listeners[name] ??= []).push(fn);
    },
    createElement: (tag) => element(tag),
  };
  function element(id) {
    return {
      id,
      value: '',
      textContent: '',
      hidden: false,
      disabled: false,
      open: false,
      children: [],
      listeners: {},
      classList: { toggle() {} },
      addEventListener(n, fn) {
        (this.listeners[n] ??= []).push(fn);
      },
      replaceChildren() {
        this.children = [];
      },
      append(c) {
        this.children.push(c);
      },
      focus() {
        document.activeElement = this;
      },
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
      emit(n, event = {}) {
        return Promise.all((this.listeners[n] ?? []).map((fn) => fn(event)));
      },
    };
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) els.set(id, element(id));
  const window = {
    listeners: {},
    addEventListener(n, fn) {
      (this.listeners[n] ??= []).push(fn);
    },
  };
  class Session extends SharedSession {
    constructor(...args) {
      super(...args);
      // Expose the constructed test session without changing the application API.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      captured = this;
    }
  }
  const fetch = async (path, options) => {
    requests.push({ path, options, body: JSON.parse(options.body) });
    return transport(path, options);
  };
  const start = new Function(
    'document',
    'window',
    'location',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'SharedSession',
    'reviewText',
    'confirm',
    transportCode + '\n' + code,
  );
  start(
    document,
    window,
    { origin },
    fetch,
    (fn, ms) => {
      timers.set(++count, { fn, ms });
      return count;
    },
    (id) => timers.delete(id),
    Session,
    reviewText,
    (message) => {
      confirmations.push(message);
      return confirm(message);
    },
  );
  return {
    session: captured,
    el: (id) => els.get(id),
    doc: document,
    window,
    timers,
    requests,
    confirmations,
    setTransport: (fn) => (transport = fn),
    async event(target, name, event = {}) {
      await Promise.all((target.listeners[name] ?? []).map((fn) => fn(event)));
      await tick();
    },
  };
}
async function draft(h, title = 'Synthetic', body = 'Body') {
  await h.el('new').emit('click');
  h.el('title').value = title;
  await h.el('title').emit('input');
  h.el('body').value = body;
  await h.el('body').emit('input');
  await tick();
}
async function review(h) {
  await h.el('publish').emit('click');
  await tick();
}
function fixtureStore(notes = []) {
  return {
    list: async () => notes,
    read: async (_owner, args) => ({
      ...notes.find((n) => n.note_id === args.note_id),
      body: 'Body',
    }),
    publish: async (_owner, args) => ({
      note_id: args.note_id,
      revision: args.expected_revision + 1,
      state: 'shared',
    }),
  };
}
function viaIngress(h, store, identity = () => ({ userId: 'owner', email: 'owner@example.test' })) {
  h.setTransport((path, options) =>
    handleSharedRequest(
      new Request(origin + path, { ...options, headers: { ...options.headers, origin } }),
      {
        enabled: true,
        pins: { VAULT_OWNER_SUBJECT: 'owner', VAULT_CANONICAL_ORIGIN: origin },
        getIdentity: identity,
        getStore: () => store,
      },
    ),
  );
}
test('INTEGRATION: real browser ingress list response populates catalog', async () => {
  const h = harness(),
    notes = [{ note_id: uuid(), revision: 1, title: 'Published synthetic' }];
  viaIngress(h, fixtureStore(notes));
  await h.el('refresh').emit('click');
  await tick();
  assert.deepEqual(h.session.view().notes, notes);
  assert.equal(h.el('notes').children.length, 1);
});
test('PRIVACY: all clear/cancel lifecycle paths erase full review text from DOM', async () => {
  for (const trigger of [
    async (h) => h.el('clear').emit('click'),
    async (h) => {
      h.doc.hidden = true;
      await h.event(h.doc, 'visibilitychange');
    },
    async (h) => h.event(h.window, 'pagehide'),
    async (h) => h.event(h.window, 'pageshow', { persisted: true }),
    async (h) => {
      [...h.timers.values()].find((t) => t.ms === 120000).fn();
    },
    async (h) => h.el('cancel').emit('click'),
  ]) {
    const h = harness();
    await draft(h, 'Sensitive synthetic title', 'Sensitive synthetic body');
    await review(h);
    assert.match(h.el('exact').textContent, /Sensitive synthetic body/);
    await trigger(h);
    await tick();
    assert.equal(h.session.view().review, null);
    assert.equal(h.el('review').open, false);
    assert.equal(h.el('exact').textContent, '');
    assert.equal(h.el('review-warning').textContent, '');
  }
});
test('INPUT: oversize is preserved and rejected; controls have no native truncation', async () => {
  assert.doesNotMatch(html, /maxlength/i);
  const h = harness(),
    title = 't'.repeat(300),
    body = 'x'.repeat(9000);
  await draft(h, title, body);
  await review(h);
  assert.equal(h.session.view().draft.title, title);
  assert.equal(h.session.view().draft.body, body);
  assert.equal(h.session.view().review, null);
  assert.equal(h.requests.length, 0);
  assert.match(h.el('status').textContent, /not been truncated/);
});
test('CONSENT: heading receives focus; full ASCII-safe review preserves submitted originals', async () => {
  const h = harness(),
    title = 'Synthetic\u202e',
    body = '<img src=x onerror=alert(1)> 😀 👩‍💻 \u2066\u2028';
  viaIngress(h, fixtureStore());
  await draft(h, title, body);
  await review(h);
  assert.equal(h.doc.activeElement.id, 'review-heading');
  assert.equal(h.el('review').open, true);
  const rendered = h.el('exact').textContent;
  assert.doesNotMatch(rendered, /[^\x20-\x7e]/);
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.args.title, title);
  assert.equal(parsed.args.body, body);
  assert.equal(parsed.destination, origin);
  await h.el('confirm').emit('click');
  await tick();
  assert.equal(h.requests[0].body.params.body, body);
  assert.equal(h.requests[0].body.params.title, title);
  assert.equal(h.session.view().pending, null);
});
test('INTEGRATION: different session owner denies all store access', async () => {
  const h = harness();
  let touches = 0;
  viaIngress(
    h,
    new Proxy(
      {},
      {
        get() {
          touches++;
          throw Error('unexpected');
        },
      },
    ),
    () => ({ userId: 'other', email: 'other@example.test' }),
  );
  await draft(h);
  await review(h);
  await h.el('confirm').emit('click');
  await tick();
  assert.equal(touches, 0);
  assert.ok(h.session.view().pending);
  assert.match(h.el('status').textContent, /not authorized/);
});
test('STATE: duplicate submission cannot issue second mutation; conceal retains uncertainty', async () => {
  const d = deferred(),
    h = harness();
  h.setTransport(() => d.promise);
  await draft(h);
  await review(h);
  const pendingClick = h.el('confirm').emit('click');
  await tick();
  assert.equal(h.requests.length, 1);
  await h.el('confirm').emit('click');
  await tick();
  assert.equal(h.requests.length, 1);
  await h.el('clear').emit('click');
  assert.equal(h.session.view().draft, null);
  assert.equal(h.session.view().busy, true);
  assert.equal(h.session.view().pending.canRetry, false);
  d.resolve(
    new Response(
      JSON.stringify({
        result: { note_id: h.requests[0].body.params.note_id, revision: 1, state: 'shared' },
      }),
    ),
  );
  await pendingClick;
  await tick();
  assert.equal(h.session.view().pending, null);
  assert.equal(h.session.view().draft, null);
});
test('STATE: cleared pending list does not strand busy or steal newer status request', async () => {
  const list = deferred(),
    status = deferred(),
    s = new SharedSession({
      publish: async () => {
        throw Error('lost');
      },
      list: () => list.promise,
      status: () => status.promise,
    });
  s.newNote();
  s.edit('title', 'Synthetic');
  s.reviewPublish();
  await assert.rejects(s.confirm());
  const lp = s.refresh();
  s.clear();
  assert.equal(s.view().busy, false);
  const sp = s.checkOutcome();
  list.resolve({ notes: [] });
  await lp;
  assert.equal(s.view().busy, true);
  status.resolve({ matched: false, current_revision: null, state: null });
  await sp;
  assert.equal(s.view().busy, false);
  assert.ok(s.view().pending);
});
test('STATE: clearing an old status cannot revoke a newer flight ownership', async () => {
  const first = deferred(),
    second = deferred();
  let calls = 0;
  const s = new SharedSession({
    publish: async () => {
      throw Error('lost');
    },
    status: () => (++calls === 1 ? first.promise : second.promise),
  });
  s.newNote();
  s.edit('title', 'Synthetic');
  s.reviewPublish();
  await assert.rejects(s.confirm());
  const p1 = s.checkOutcome();
  s.clear();
  const p2 = s.checkOutcome();
  first.resolve({ matched: false, current_revision: null, state: null });
  await p1;
  assert.equal(s.view().busy, true);
  second.resolve({ matched: false, current_revision: null, state: null });
  await p2;
  assert.equal(s.view().busy, false);
});
test('TRANSPORT: pending mutation uses a finite abort deadline and rejects redirects', async () => {
  const h = harness();
  h.setTransport(
    (_path, opts) =>
      new Promise((_resolve, reject) =>
        opts.signal?.addEventListener('abort', () => reject(Error('AbortError'))),
      ),
  );
  await draft(h);
  await review(h);
  const pendingClick = h.el('confirm').emit('click');
  await tick();
  const opts = h.requests[0].options;
  assert.ok(opts.signal instanceof AbortSignal, 'fetch needs an AbortSignal');
  assert.equal(opts.redirect, 'error');
  const deadline = [...h.timers.values()].find((t) => t.ms > 0 && t.ms < 120000);
  assert.ok(deadline, 'must have a request deadline distinct from conceal timer');
  deadline.fn();
  await pendingClick;
  await tick();
  assert.equal(h.session.view().busy, false);
  assert.ok(h.session.view().pending);
  assert.equal(h.session.view().pending.canRetry, true);
});
test('STATE: stale list completion does not claim an empty refreshed catalog after clear', async () => {
  const d = deferred(),
    h = harness();
  h.setTransport(() => d.promise);
  const pendingClick = h.el('refresh').emit('click');
  await tick();
  await h.el('clear').emit('click');
  d.resolve(new Response(JSON.stringify({ result: { notes: [] } })));
  await pendingClick;
  await tick();
  assert.deepEqual(h.session.view().notes, []);
  assert.equal(h.el('empty').textContent, 'Shared notes haven’t been loaded yet.');
});
test('STATE: successful publication invalidates the loaded catalog and erases review DOM', async () => {
  const h = harness();
  viaIngress(h, fixtureStore([{ note_id: uuid(), revision: 1, title: 'Existing' }]));
  await h.el('refresh').emit('click');
  await tick();
  assert.equal(h.session.view().loaded, true);
  await draft(h);
  await review(h);
  await h.el('confirm').emit('click');
  await tick();
  assert.equal(h.session.view().loaded, false);
  assert.equal(h.el('empty').textContent, 'Shared notes haven’t been loaded yet.');
  assert.equal(h.el('exact').textContent, '');
  assert.equal(h.el('review-warning').textContent, '');
});

test('MOBILE: list is the only initial panel and new note opens a focused editor', async () => {
  const h = harness();
  assert.ok(h.el('list-panel'));
  assert.equal(h.el('list-panel').hidden, false);
  assert.equal(h.el('editor-panel').hidden, true);
  await draft(h);
  assert.equal(h.el('list-panel').hidden, true);
  assert.equal(h.el('editor-panel').hidden, false);
  assert.equal(h.doc.activeElement, h.el('title'));
  assert.match(h.el('revision').textContent, /Draft · not saved or shared/);
});
test('MOBILE: Back clears unsaved fields, returns to list and restores useful focus', async () => {
  const h = harness();
  await draft(h, 'Draft title', 'Draft body');
  assert.ok(h.el('back'));
  await h.el('back').emit('click');
  await tick();
  assert.equal(h.el('editor-panel').hidden, true);
  assert.equal(h.el('list-panel').hidden, false);
  assert.equal(h.el('title').value, '');
  assert.equal(h.el('body').value, '');
  assert.equal(h.session.view().draft, null);
  assert.equal(h.doc.activeElement, h.el('list-heading'));
});
test('MOBILE: unresolved publication replaces editor with reachable pending controls', async () => {
  const h = harness();
  h.setTransport(async () => {
    throw Error('REQUEST_TIMEOUT');
  });
  await draft(h);
  await review(h);
  await h.el('confirm').emit('click');
  await tick();
  assert.ok(h.el('list-panel'));
  assert.equal(h.el('list-panel').hidden, true);
  assert.equal(h.el('editor').hidden, true);
  assert.equal(h.el('pending').hidden, false);
  assert.match(h.el('check').textContent, /Check publish status/);
});
test('A11Y: cancelling exact review restores its initiating control', async () => {
  const h = harness();
  await draft(h);
  await review(h);
  await h.el('cancel').emit('click');
  await tick();
  assert.equal(h.doc.activeElement, h.el('publish'));
  assert.equal(h.el('exact').textContent, '');
});

test('A11Y: uncertain publication and clearing retry text focus the visible pending heading', async () => {
  const h = harness();
  h.setTransport(async () => {
    throw Error('REQUEST_TIMEOUT');
  });
  await draft(h);
  await review(h);
  await h.el('confirm').emit('click');
  await tick();
  assert.equal(h.doc.activeElement, h.el('pending-heading'));
  await h.el('clear').emit('click');
  assert.equal(h.doc.activeElement, h.el('pending-heading'));
  assert.equal(h.el('list-panel').hidden, true);
});
test('STATE: stale opened note cannot remove newer draft discard protection or steal focus', async () => {
  const d = deferred(),
    note = { note_id: uuid(), revision: 1, title: 'Old' },
    h = harness({ confirm: () => false });
  h.setTransport((_path, opts) =>
    JSON.parse(opts.body).method === 'list'
      ? Promise.resolve(new Response(JSON.stringify({ result: { notes: [note] } })))
      : d.promise,
  );
  await h.el('refresh').emit('click');
  await tick();
  const opening = h.el('notes').children[0].children[0].emit('click');
  await tick();
  await h.el('clear').emit('click');
  await draft(h, 'New draft', 'New text');
  h.el('body').focus();
  d.resolve(new Response(JSON.stringify({ result: { ...note, body: 'Old text' } })));
  await opening;
  await tick();
  assert.equal(h.doc.activeElement, h.el('body'));
  await h.el('back').emit('click');
  await tick();
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.session.view().draft.title, 'New draft');
});
test('A11Y: failed note opening focuses a visible error summary after the row is replaced', async () => {
  const h = harness(),
    note = { note_id: uuid(), revision: 1, title: 'Read failure' };
  h.setTransport((_path, opts) =>
    JSON.parse(opts.body).method === 'list'
      ? Promise.resolve(new Response(JSON.stringify({ result: { notes: [note] } })))
      : Promise.reject(Error('UNAVAILABLE')),
  );
  await h.el('refresh').emit('click');
  await tick();
  await h.el('notes').children[0].children[0].emit('click');
  await tick();
  assert.equal(h.doc.activeElement, h.el('status'));
  assert.match(h.el('status').textContent, /no longer available/);
  assert.equal(h.el('list-panel').hidden, false);
});
test('A11Y: oversize publication validation focuses the visible summary without truncating', async () => {
  const h = harness();
  await draft(h, 'Oversized', 'x'.repeat(9000));
  await review(h);
  assert.equal(h.el('body').value.length, 9000);
  assert.equal(h.el('review').open, false);
  assert.equal(h.doc.activeElement, h.el('status'));
  assert.match(h.el('status').textContent, /not been truncated/);
});
