import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SharedSession, reviewText } from './session.mjs';
import { handleSharedRequest } from './ingress.mjs';
const code = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/run\(refreshMetadata\);\s*$/, 'const initialLoad=run(refreshMetadata);');
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
function harness({ confirm = () => true, transport: initialTransport } = {}) {
  const els = new Map(),
    timers = new Map(),
    requests = [],
    confirmations = [];
  let count = 0,
    captured,
    transport =
      initialTransport ??
      (async () =>
        new Response(JSON.stringify({ result: { notes: [] } }), {
          headers: { 'content-type': 'application/json' },
        }));
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
      super(
        ...args,
      ); /* eslint-disable-next-line @typescript-eslint/no-this-alias -- Capture the real session for deterministic UI tests. */
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
    transportCode +
      '\n' +
      code +
      '\nreturn typeof initialLoad === \"undefined\" ? Promise.resolve() : initialLoad;',
  );
  const ready = start(
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
    ready,
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
  await h.ready;
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
  await h.ready;
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
  assert.equal(h.requests.filter((r) => r.body.method !== 'list').length, 0);
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
  assert.equal(h.requests.find((r) => r.body.method === 'publish').body.params.body, body);
  assert.equal(h.requests.find((r) => r.body.method === 'publish').body.params.title, title);
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
  assert.equal(h.requests.filter((r) => r.body.method === 'publish').length, 1);
  await h.el('confirm').emit('click');
  await tick();
  assert.equal(h.requests.filter((r) => r.body.method === 'publish').length, 1);
  await h.el('clear').emit('click');
  assert.equal(h.session.view().draft, null);
  assert.equal(h.session.view().busy, true);
  assert.equal(h.session.view().pending.canRetry, false);
  d.resolve(
    new Response(
      JSON.stringify({
        result: {
          note_id: h.requests.find((r) => r.body.method === 'publish').body.params.note_id,
          revision: 1,
          state: 'shared',
        },
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
  const opts = h.requests.find((r) => r.body.method === 'publish').options;
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
  await h.ready;
  const pendingClick = h.el('refresh').emit('click');
  await tick();
  await h.el('clear').emit('click');
  d.resolve(new Response(JSON.stringify({ result: { notes: [] } })));
  await pendingClick;
  await tick();
  assert.deepEqual(h.session.view().notes, []);
  assert.equal(h.el('empty').textContent, 'Refresh to load shared notes.');
});
test('STATE: successful publication refreshes metadata and erases review DOM', async () => {
  const h = harness();
  viaIngress(h, fixtureStore([{ note_id: uuid(), revision: 1, title: 'Existing' }]));
  await h.ready;
  await h.el('refresh').emit('click');
  await tick();
  assert.equal(h.session.view().loaded, true);
  await draft(h);
  await review(h);
  await h.el('confirm').emit('click');
  await tick();
  assert.equal(h.session.view().loaded, true);
  assert.equal(h.requests.at(-1).body.method, 'list');
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
  assert.match(h.el('revision').textContent, /Draft · not saved/);
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
  await h.ready;
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
  await h.ready;
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

test('FOCUSED: initial entry loads metadata only without reading bodies', async () => {
  const h = harness();
  await h.ready;
  assert.deepEqual(
    h.requests.map((r) => r.body.method),
    ['list'],
  );
  assert.equal(h.session.view().loaded, true);
  assert.equal(h.el('empty').textContent, 'No shared notes yet.');
});
test('FOCUSED: initial loading and failed metadata states never imply an empty catalog', async () => {
  const d = deferred(),
    h = harness({ transport: () => d.promise });
  assert.equal(h.el('empty').textContent, 'Loading shared notes…');
  d.reject(Error('STORAGE_UNAVAILABLE'));
  await h.ready;
  assert.equal(h.session.view().loaded, false);
  assert.match(h.el('empty').textContent, /Could not load/);
  assert.match(h.el('status').textContent, /unavailable/);
});
test('FOCUSED: exact row selection opens read-only detail; Edit is explicit', async () => {
  const note = { note_id: uuid(), revision: 3, title: 'Read only' },
    h = harness();
  viaIngress(h, fixtureStore([note]));
  await h.ready;
  await h.el('refresh').emit('click');
  await h.el('notes').children[0].children[0].emit('click');
  assert.equal(h.el('detail-panel').hidden, false);
  assert.equal(h.el('editor').hidden, true);
  assert.equal(h.el('detail-body').textContent, 'Body');
  assert.equal(h.el('body').value, '');
  assert.deepEqual(h.requests.at(-1).body.params, { note_id: note.note_id, revision: 3 });
  assert.equal(h.doc.activeElement, h.el('detail-heading'));
  await h.el('edit').emit('click');
  assert.equal(h.el('detail-panel').hidden, true);
  assert.equal(h.el('editor').hidden, false);
  assert.equal(h.el('body').value, 'Body');
  assert.equal(h.doc.activeElement, h.el('title'));
});
test('A11Y: delayed publish immediately clears review, announces Publishing and focuses pending heading', async () => {
  const d = deferred(),
    h = harness();
  await draft(h);
  h.setTransport(() => d.promise);
  await review(h);
  const pending = h.el('confirm').emit('click');
  await tick();
  assert.equal(h.el('review').open, false);
  assert.equal(h.el('exact').textContent, '');
  assert.equal(h.el('pending').hidden, false);
  assert.equal(h.el('pending-heading').textContent, 'Publishing…');
  assert.equal(h.el('status').textContent, 'Publishing…');
  assert.equal(h.doc.activeElement, h.el('pending-heading'));
  assert.equal(h.el('check').disabled, true);
  d.reject(Error('REQUEST_TIMEOUT'));
  await pending;
  assert.equal(h.el('pending-heading').textContent, 'Publish result not confirmed');
});
test('A11Y: delayed revoke immediately announces Stopping access and focuses pending heading', async () => {
  const note = { note_id: uuid(), revision: 1, title: 'Revokable' },
    h = harness();
  viaIngress(h, fixtureStore([note]));
  await h.ready;
  await h.el('refresh').emit('click');
  await h.el('notes').children[0].children[0].emit('click');
  await h.el('revoke').emit('click');
  const d = deferred();
  h.setTransport(() => d.promise);
  const pending = h.el('confirm').emit('click');
  await tick();
  assert.equal(h.el('pending-heading').textContent, 'Stopping access…');
  assert.equal(h.el('status').textContent, 'Stopping access…');
  assert.equal(h.doc.activeElement, h.el('pending-heading'));
  d.reject(Error('REQUEST_TIMEOUT'));
  await pending;
});
test('A11Y: visible idle clearing focuses surviving non-input list heading and announces clearing', async () => {
  for (const mode of ['list', 'draft', 'review']) {
    const h = harness();
    await h.ready;
    if (mode !== 'list') await draft(h);
    if (mode === 'review') await review(h);
    else h.el(mode === 'draft' ? 'body' : 'new').focus();
    [...h.timers.values()].find((t) => t.ms === 120000).fn();
    assert.equal(h.doc.activeElement, h.el('list-heading'));
    assert.match(h.el('status').textContent, /Local text cleared/);
    assert.equal(h.el('body').value, '');
    assert.equal(h.el('exact').textContent, '');
  }
});
test('A11Y: hidden clearing never steals focus or automatically reloads metadata on return', async () => {
  const h = harness();
  await draft(h);
  h.el('body').focus();
  h.doc.hidden = true;
  const before = h.requests.length;
  await h.event(h.doc, 'visibilitychange');
  assert.equal(h.doc.activeElement, h.el('body'));
  h.doc.hidden = false;
  await h.event(h.doc, 'visibilitychange');
  assert.equal(h.requests.length, before);
  assert.match(h.el('status').textContent, /Local text cleared/);
});
test('STATE: confirmed mutation after concealment cannot reload metadata or steal newer focus', async () => {
  const h = harness(),
    d = deferred();
  await draft(h);
  h.setTransport(() => d.promise);
  await review(h);
  const pending = h.el('confirm').emit('click');
  await tick();
  await h.el('clear').emit('click');
  const before = h.requests.length;
  h.el('clear').focus();
  const args = h.requests.find((r) => r.body.method === 'publish').body.params;
  d.resolve(
    new Response(
      JSON.stringify({ result: { note_id: args.note_id, revision: 1, state: 'shared' } }),
    ),
  );
  await pending;
  assert.equal(h.requests.length, before);
  assert.equal(h.doc.activeElement, h.el('clear'));
  assert.equal(h.session.view().loaded, false);
  assert.equal(h.el('body').value, '');
});
test('A11Y: idle clearing during a mutation announces clearing and retains pending focus', async () => {
  const h = harness(),
    d = deferred();
  await draft(h);
  h.setTransport(() => d.promise);
  await review(h);
  const pending = h.el('confirm').emit('click');
  await tick();
  [...h.timers.values()].find((t) => t.ms === 120000).fn();
  assert.equal(h.doc.activeElement, h.el('pending-heading'));
  assert.match(h.el('status').textContent, /Local text cleared/);
  assert.equal(h.el('body').value, '');
  assert.equal(h.session.view().pending.canRetry, false);
  d.reject(Error('REQUEST_TIMEOUT'));
  await pending;
});
test('A11Y: pending status lookup does not claim another publication is being sent', async () => {
  const h = harness();
  await draft(h);
  h.setTransport(async () => {
    throw Error('REQUEST_TIMEOUT');
  });
  await review(h);
  await h.el('confirm').emit('click');
  const d = deferred();
  h.setTransport(() => d.promise);
  const checking = h.el('check').emit('click');
  await tick();
  assert.equal(h.el('status').textContent, 'Checking status…');
  assert.doesNotMatch(h.el('pending-heading').textContent, /Publishing/);
  d.resolve(
    new Response(
      JSON.stringify({ result: { matched: false, current_revision: null, state: null } }),
    ),
  );
  await checking;
});
test('PRIVACY: read-only body clears on every conceal path without automatic reread', async () => {
  for (const trigger of [
    (h) => h.el('clear').emit('click'),
    async (h) => {
      h.doc.hidden = true;
      await h.event(h.doc, 'visibilitychange');
    },
    (h) => h.event(h.window, 'pagehide'),
    (h) => h.event(h.window, 'pageshow', { persisted: true }),
    async (h) => [...h.timers.values()].find((t) => t.ms === 120000).fn(),
  ]) {
    const h = harness(),
      note = { note_id: uuid(), revision: 1, title: 'Read me' };
    viaIngress(h, fixtureStore([note]));
    await h.ready;
    await h.el('refresh').emit('click');
    await h.el('notes').children[0].children[0].emit('click');
    assert.equal(h.el('detail-body').textContent, 'Body');
    const before = h.requests.length;
    await trigger(h);
    assert.equal(h.el('detail-body').textContent, '');
    assert.equal(h.el('detail-heading').textContent, '');
    assert.equal(h.session.view().draft, null);
    assert.equal(h.requests.length, before);
  }
});
test('REVIEW: stale status completion cannot reset a newer status activity announcement', async () => {
  const h = harness();
  await draft(h);
  h.setTransport(async () => {
    throw Error('REQUEST_TIMEOUT');
  });
  await review(h);
  await h.el('confirm').emit('click');
  const a = deferred(),
    b = deferred();
  let count = 0;
  h.setTransport(() => (++count === 1 ? a.promise : b.promise));
  const first = h.el('check').emit('click');
  await tick();
  await h.el('clear').emit('click');
  const second = h.el('check').emit('click');
  await tick();
  a.resolve(
    new Response(
      JSON.stringify({ result: { matched: false, current_revision: null, state: null } }),
    ),
  );
  await first;
  assert.equal(h.session.view().busy, true);
  assert.match(h.el('status').textContent, /Checking status…/);
  b.resolve(
    new Response(
      JSON.stringify({ result: { matched: false, current_revision: null, state: null } }),
    ),
  );
  await second;
  assert.equal(h.session.view().busy, false);
});
test('REVIEW: confirmed publish followed by failed list refresh stays explicitly confirmed', async () => {
  const h = harness();
  await draft(h);
  h.setTransport((_path, opts) => {
    const request = JSON.parse(opts.body);
    if (request.method === 'list') throw Error('STORAGE_UNAVAILABLE');
    return Promise.resolve(
      new Response(
        JSON.stringify({
          result: { note_id: request.params.note_id, revision: 1, state: 'shared' },
        }),
      ),
    );
  });
  await review(h);
  await h.el('confirm').emit('click');
  assert.equal(h.session.view().pending, null);
  assert.match(h.el('status').textContent, /Published\./);
  assert.match(h.el('status').textContent, /list could not be refreshed/);
  assert.doesNotMatch(h.el('status').textContent, /A write may still have completed/);
});
test('REVIEW: confirmed revoke followed by failed list refresh stays explicitly confirmed', async () => {
  const h = harness(),
    note = { note_id: uuid(), revision: 1, title: 'Revokable' };
  viaIngress(h, fixtureStore([note]));
  await h.ready;
  await h.el('refresh').emit('click');
  await h.el('notes').children[0].children[0].emit('click');
  await h.el('revoke').emit('click');
  h.setTransport((_path, opts) => {
    const request = JSON.parse(opts.body);
    if (request.method === 'list') throw Error('STORAGE_UNAVAILABLE');
    return Promise.resolve(
      new Response(
        JSON.stringify({ result: { note_id: note.note_id, revision: 2, state: 'revoked' } }),
      ),
    );
  });
  await h.el('confirm').emit('click');
  assert.equal(h.session.view().pending, null);
  assert.match(h.el('status').textContent, /Revoked for future reads/);
  assert.match(h.el('status').textContent, /list could not be refreshed/);
});
test('REVIEW: confirmed status receipt followed by failed list refresh stays explicitly confirmed', async () => {
  const h = harness();
  await draft(h);
  h.setTransport(async () => {
    throw Error('REQUEST_TIMEOUT');
  });
  await review(h);
  await h.el('confirm').emit('click');
  h.setTransport((_path, opts) => {
    const request = JSON.parse(opts.body);
    if (request.method === 'list') throw Error('STORAGE_UNAVAILABLE');
    return Promise.resolve(
      new Response(
        JSON.stringify({
          result: { matched: true, kind: 'publish', current_revision: 1, state: 'shared' },
        }),
      ),
    );
  });
  await h.el('check').emit('click');
  assert.equal(h.session.view().pending, null);
  assert.match(h.el('status').textContent, /Published\./);
  assert.match(h.el('status').textContent, /list could not be refreshed/);
});
test('A11Y: confirmed write moves focus to list before delayed metadata refresh settles', async () => {
  const h = harness(),
    list = deferred();
  await draft(h);
  h.setTransport((_path, opts) => {
    const request = JSON.parse(opts.body);
    if (request.method === 'list') return list.promise;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          result: { note_id: request.params.note_id, revision: 1, state: 'shared' },
        }),
      ),
    );
  });
  await review(h);
  const publishing = h.el('confirm').emit('click');
  await tick();
  assert.equal(h.session.view().pending, null);
  assert.equal(h.session.view().busy, true);
  assert.equal(h.el('pending').hidden, true);
  assert.equal(h.doc.activeElement, h.el('list-heading'));
  list.resolve(new Response(JSON.stringify({ result: { notes: [] } })));
  await publishing;
});
test('REVIEW: unmatched status keeps the uncertainty explanation visible with retained draft', async () => {
  const h = harness();
  await draft(h);
  h.setTransport(async () => {
    throw Error('REQUEST_TIMEOUT');
  });
  await review(h);
  await h.el('confirm').emit('click');
  h.setTransport(
    async () =>
      new Response(
        JSON.stringify({ result: { matched: false, current_revision: null, state: null } }),
      ),
  );
  await h.el('check').emit('click');
  assert.ok(h.session.view().pending);
  assert.ok(h.session.view().draft);
  assert.match(h.el('status').textContent, /No matching latest receipt/);
});
test('A11Y: late confirmed mutation moves focus only when cleared pending heading disappears', async () => {
  const h = harness(),
    d = deferred();
  await draft(h);
  h.setTransport(() => d.promise);
  await review(h);
  const publishing = h.el('confirm').emit('click');
  await tick();
  await h.el('clear').emit('click');
  assert.equal(h.doc.activeElement, h.el('pending-heading'));
  const args = h.requests.find((r) => r.body.method === 'publish').body.params;
  d.resolve(
    new Response(
      JSON.stringify({ result: { note_id: args.note_id, revision: 1, state: 'shared' } }),
    ),
  );
  await publishing;
  assert.equal(h.doc.activeElement, h.el('list-heading'));
  assert.equal(h.session.view().loaded, false);
});
