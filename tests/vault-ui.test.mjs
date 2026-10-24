import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDOM, walk, tick, deferred } from './dom-harness.mjs';
const source = readFileSync(new URL('../vault-assets/app.js.txt', import.meta.url), 'utf8');
const html = readFileSync(new URL('../vault-assets/index.html.txt', import.meta.url), 'utf8');
const seam = source.lastIndexOf('// web/app.mjs');
const ui = source.slice(seam).replace(/render\(\);\s*refresh\(\);\s*$/, '');
const epoch = source.slice(
  source.indexOf('var OperationEpoch = class'),
  source.indexOf('var VaultSession = class'),
);
function harness(options = {}) {
  const h = createDOM([...html.matchAll(/id="([^"]+)"/g)].map((x) => x[1])),
    timers = [];
  let calls = 0,
    authFailure;
  class VaultError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const api = async (path) => {
    if (options.api) return options.api(path, authFailure);
    return path === '/api/status' ? { mode: 'production' } : { envelope: { revision: 1 } };
  };
  const stub = {
    unlock: async (...args) => {
      calls++;
      return options.unlock
        ? options.unlock(...args)
        : {
            locked: false,
            envelope: { revision: 1 },
            items: () => [],
            lock() {
              this.locked = true;
            },
          };
    },
  };
  const start = new Function(
    'document',
    'window',
    'Node',
    'VaultError',
    'VaultSession',
    'createApi',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'confirm',
    'fetch',
    'fail',
    epoch + ui + '\nreturn {state,render,lock,refresh,gate};',
  );
  Object.assign(
    h,
    start(
      h.document,
      h.window,
      h.Node,
      VaultError,
      stub,
      (_fetch, onAuth) => {
        authFailure = onAuth;
        return api;
      },
      () => 0,
      () => {},
      (fn) => timers.push(fn),
      () => true,
      () => {},
      (code) => {
        throw new VaultError(code);
      },
    ),
  );
  h.state.mode = 'production';
  h.state.envelope = { revision: 1 };
  h.render();
  return {
    ...h,
    timers,
    authFail: () => authFailure(),
    calls: () => calls,
    find: (tag) => walk(h.el('main')).filter((e) => e.tagName === tag.toUpperCase()),
    text: () => h.el('main').textContent,
  };
}
test('immutable pre-UI crypto, session and transport bytes remain baseline', () =>
  assert.equal(
    createHash('sha256').update(source.slice(0, seam)).digest('hex'),
    'f1cee24bd61d87a25bdee35d6134885ae34265e4a56565cb45f5a621529195dd',
  ));
test('locked landing is an inline password form with no private navigation', () => {
  const h = harness();
  assert.equal(h.find('form').length, 1);
  assert.equal(h.find('dialog').length, 0);
  assert.equal(h.el('navigation').children.length, 0);
  assert.match(h.text(), /Unlock your private vault/);
  assert.equal(h.find('input')[0].getAttribute('autocomplete'), 'current-password');
  assert.equal(h.document.activeElement, undefined);
  assert.match(h.text(), /Published copies remain readable/);
  assert.doesNotMatch(h.text(), /Storage|Owner-unlocked|not connected/);
});
test('recovery changes label and mode while clearing the old password', async () => {
  const h = harness();
  const input = h.find('input')[0];
  assert.ok(input, 'inline password exists');
  input.value = 'not a real password';
  const toggle = h.find('button').find((e) => e.textContent === 'Use a recovery key');
  assert.ok(toggle);
  await toggle.emit('click');
  assert.equal(h.find('input')[0].value, '');
  assert.match(h.text(), /Recovery key/);
  assert.match(h.text(), /Use master password/);
});
test('pending write outranks locked view and keeps reconciliation reachable', () => {
  const h = harness();
  h.state.pending = { detached: true };
  h.render();
  assert.equal(h.find('form').length, 0);
  assert.match(h.text(), /Check save status/);
  assert.equal(h.el('navigation').children.length, 0);
});
test('setup and unavailable never render the ordinary unlock form', () => {
  const h = harness();
  h.state.envelope = null;
  h.render();
  assert.match(h.text(), /Create your private vault/);
  assert.equal(h.find('form').length, 0);
  h.state.mode = 'disabled';
  h.render();
  assert.match(h.text(), /Vault unavailable/);
  assert.doesNotMatch(h.text(), /Create your private vault/);
  assert.equal(h.find('input').length, 0);
});
test('unlocked navigation is limited to four private sections', () => {
  const h = harness();
  h.state.session = { locked: false, items: () => [] };
  h.render();
  assert.deepEqual(
    h
      .el('navigation')
      .children.map((e) => e.textContent.replace(/[\u25a6\u25ce\u25a4\u25c7]/g, '').trim()),
    ['Logins', 'Private notes', 'Contacts', 'Security'],
  );
});
test('unlock prevents duplicate submits and background invalidates late keys', async () => {
  const d = deferred(),
    h = harness({ unlock: () => d.promise });
  const form = h.find('form')[0];
  assert.ok(form);
  h.find('input')[0].value = 'synthetic-password';
  const first = form.emit('submit');
  await tick();
  await form.emit('submit');
  assert.equal(h.calls(), 1);
  h.document.hidden = true;
  await h.event(h.document, 'visibilitychange');
  const session = {
    locked: false,
    envelope: { revision: 1 },
    lock() {
      this.locked = true;
    },
  };
  d.resolve(session);
  await first;
  assert.equal(session.locked, true);
  assert.equal(h.state.session, null);
  assert.equal(h.find('input')[0].value, '');
});
test('unlock failure is linked to the field and focus remains actionable', async () => {
  const h = harness({
    unlock: () => {
      throw Object.assign(Error(), { code: 'UNLOCK_FAILED' });
    },
  });
  const form = h.find('form')[0];
  assert.ok(form);
  h.find('input')[0].value = 'synthetic-password';
  await form.emit('submit');
  assert.match(h.text(), /Unable to unlock/);
  assert.equal(h.find('input')[0].getAttribute('aria-invalid'), 'true');
  assert.equal(h.document.activeElement, h.find('input')[0]);
});
test('wrong owner or unavailable storage never becomes empty-vault setup', async () => {
  const h = harness({
    api: async () => {
      throw Object.assign(Error(), { code: 'FORBIDDEN' });
    },
  });
  await h.refresh();
  assert.equal(h.state.mode, 'disabled');
  assert.equal(h.find('input').length, 0);
  assert.doesNotMatch(h.text(), /Create your private vault/);
});
test('owner home goes directly to vault rather than a dashboard', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /redirect\(['"]\/vault['"]\)/);
  assert.doesNotMatch(page, /Connection proof|Open vault/);
});
test('synthetic mode retains explicit evaluation warning', () => {
  const h = harness();
  h.state.mode = 'synthetic';
  h.render();
  assert.equal(h.el('mode-warning').hidden, false);
  assert.match(h.el('mode-warning').textContent, /Synthetic data only/);
});
test('unlock makes encryption claim rather than absolute privacy and keeps browser risk visible', () => {
  const h = harness();
  assert.doesNotMatch(h.text(), /stay private/);
  assert.ok(
    h
      .el('main')
      .children.some(
        (e) => /Not independently audited/.test(e.textContent) && e.tagName !== 'DETAILS',
      ),
  );
});

test('authorization loss during unlock becomes unavailable, not another password prompt', async () => {
  const h = harness({
    api: async (_path, onAuth) => {
      onAuth();
      throw Object.assign(Error(), { code: 'FORBIDDEN' });
    },
  });
  const form = h.find('form')[0];
  h.find('input')[0].value = 'synthetic';
  await form.emit('submit');
  assert.equal(h.state.mode, 'disabled');
  assert.equal(h.find('input').length, 0);
  assert.match(h.text(), /signed-in account/);
});
test('authorization loss retains pending save reconciliation above unavailable screen', () => {
  const h = harness();
  h.state.pending = { detached: true };
  h.authFail();
  assert.equal(h.state.mode, 'disabled');
  assert.match(h.text(), /Check save status/);
  assert.equal(h.find('input').length, 0);
});
test('visible locking restores focus to main without focusing the password keyboard', () => {
  const h = harness();
  h.state.session = {
    locked: false,
    lock() {
      this.locked = true;
    },
  };
  h.document.activeElement = h.el('lock-button');
  h.lock('Locked');
  assert.equal(h.document.activeElement, h.el('main'));
  h.document.hidden = true;
  h.document.activeElement = h.document.body;
  h.lock('');
  assert.equal(h.document.activeElement, h.document.body);
});
test('unlock typing and cleared failure do not create an unsaved-record warning', async () => {
  const h = harness({
    unlock: () => {
      throw Object.assign(Error(), { code: 'UNLOCK_FAILED' });
    },
  });
  const input = h.find('input')[0];
  input.value = 'wrong synthetic';
  await input.emit('input');
  assert.equal(h.state.dirty, false);
  await h.find('form')[0].emit('submit');
  assert.equal(input.value, '');
  assert.equal(h.state.dirty, false);
});
test('vault focus ring uses the higher contrast mobile token', () => {
  const css = readFileSync(new URL('../vault-assets/styles.css.txt', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#64a891/);
  assert.match(css, /outline:3px solid #347863/);
});
