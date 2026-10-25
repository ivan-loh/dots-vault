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
    'validateItem',
    'randomId',
    'digest',
    'writeEnvelope',
    epoch + ui + '\nreturn {state,render,lock,refresh,gate,edit,modal,temporarySessions};',
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
      new Function(
        'fail',
        'utf8',
        'LIMITS',
        source.slice(source.indexOf('function validString'), source.indexOf('function encrypted')) +
          'return validateItem;',
      )(
        (code) => {
          throw new VaultError(code ?? 'INVALID_DATA');
        },
        (value) => new TextEncoder().encode(value),
        { item: 32768 },
      ),
      async () => 'synthetic-operation',
      async () => 'synthetic-hash',
      async () => {},
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
test('unlocked navigation has three content sections and secondary Settings', () => {
  const h = harness();
  h.state.session = { locked: false, items: () => [] };
  h.render();
  assert.ok(h.el('settings-button'));
  assert.equal(h.el('settings-button').hidden, false);
  assert.deepEqual(
    h
      .el('navigation')
      .children.map((e) => e.textContent.replace(/[\u25a6\u25ce\u25a4\u25c7]/g, '').trim()),
    ['Logins', 'Private notes', 'Contacts'],
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

function unlocked(h, items = []) {
  h.state.session = { locked: false, envelope: { revision: 1 }, items: () => items, discard() {} };
  h.render();
  return h;
}
function modalElements(h, tag) {
  const root =
    tag === 'dialog'
      ? h.document.body
      : (walk(h.document.body).find((e) => e.tagName === 'DIALOG') ?? h.document.body);
  return walk(root).filter((e) => e.tagName === tag.toUpperCase());
}
test('FOCUSED: Add directly opens one type without a selector and uses a specific save label', () => {
  for (const [type, heading, save] of [
    ['login', 'Add login', 'Save login'],
    ['note', 'Add private note', 'Save private note'],
    ['contact', 'Add contact', 'Save contact'],
  ]) {
    const h = unlocked(harness());
    h.edit(null, type);
    assert.equal(modalElements(h, 'select').length, 0);
    assert.ok(modalElements(h, 'h2').some((e) => e.textContent === heading));
    assert.ok(modalElements(h, 'button').some((e) => e.textContent === save));
  }
});
test('FOCUSED: optional fields start closed but expand when editing populated details', () => {
  for (const [type, item] of [
    [
      'login',
      {
        type: 'login',
        title: 'Synthetic',
        username: 'u',
        password: 'p',
        url: 'https://example.test',
        notes: 'kept',
      },
    ],
    [
      'contact',
      {
        type: 'contact',
        name: 'Synthetic',
        organization: 'Org',
        emails: ['a@example.test', 'b@example.test'],
        phones: ['1', '2'],
        addresses: ['One', 'Two'],
        notes: 'kept',
      },
    ],
  ]) {
    const fresh = unlocked(harness());
    fresh.edit(null, type);
    assert.equal(modalElements(fresh, 'details')[0].getAttribute('open'), null);
    const h = unlocked(harness());
    h.edit(item, type);
    const disclosure = modalElements(h, 'details')[0];
    assert.notEqual(disclosure.getAttribute('open'), null);
    assert.equal(modalElements(h, 'summary')[0].textContent, 'More details');
    assert.ok(modalElements(h, 'textarea').some((e) => e.value === 'kept'));
  }
});
test('FOCUSED: optional fields survive collapsing and submitting without losing multi-values', async () => {
  const item = {
    type: 'contact',
    name: 'Synthetic',
    organization: 'Org',
    emails: ['a@example.test', 'b@example.test'],
    phones: ['1', '2'],
    addresses: ['One', 'Two'],
    notes: 'kept',
  };
  const h = unlocked(harness());
  let captured;
  h.state.session.put = async (data) => {
    captured = data;
    throw Object.assign(Error(), { code: 'INVALID_DATA' });
  };
  h.edit(item, 'contact');
  modalElements(h, 'details')[0].removeAttribute('open');
  await modalElements(h, 'form')[0].emit('submit');
  assert.deepEqual(captured, item);
});
test('FOCUSED: list chrome is quiet and search remains local', async () => {
  const h = unlocked(harness(), [
    { id: 'one', type: 'login', title: 'Match', username: 'u' },
    { id: 'two', type: 'login', title: 'Other', username: 'v' },
  ]);
  assert.doesNotMatch(h.text(), /ENCRYPTED IN THIS BROWSER|Local search only|Passwords and logins/);
  const search = h.find('input')[0];
  search.value = 'Match';
  await search.emit('input');
  assert.match(h.text(), /Match/);
  assert.doesNotMatch(h.text(), /Other/);
});
test('FOCUSED: settings groups are disclosures with advanced actions out of the ordinary list', () => {
  const h = unlocked(harness());
  h.state.view = 'security';
  h.render();
  assert.ok(h.find('h1').some((e) => e.textContent === 'Settings'));
  assert.deepEqual(
    h.find('summary').map((e) => e.textContent),
    ['Encrypted backup', 'Master password', 'Recovery key', 'Advanced', 'Security & help'],
  );
  assert.ok(h.find('button').some((e) => e.textContent === 'Export encrypted backup'));
  assert.ok(h.find('button').some((e) => e.textContent === 'Rotate vault keys'));
});
test('FOCUSED: Lock remains visible while unresolved saves still own keys', () => {
  const h = unlocked(harness());
  h.state.pending = { session: h.state.session };
  h.render();
  assert.equal(h.el('lock-button').hidden, false);
  assert.equal(h.el('topbar').hidden, false);
  assert.match(h.text(), /Check save status/);
});

test('REVIEW: successful Add restores connected main focus after replacing the opener', async () => {
  const h = unlocked(harness());
  const add = h.find('button').find((e) => e.textContent === 'Add login');
  add.focus();
  await add.emit('click');
  modalElements(h, 'input')[0].value = 'Synthetic';
  h.state.session.put = async () => ({ envelope: { revision: 2 } });
  h.state.session.accept = () => {
    h.state.session.envelope = { revision: 2 };
  };
  await modalElements(h, 'form')[0].emit('submit');
  assert.equal(h.document.activeElement, h.el('main'));
  assert.equal(h.document.activeElement.isConnected, true);
});
test('REVIEW: cancelled preparation releases only its own busy state', async () => {
  const h = unlocked(harness()),
    first = deferred(),
    second = deferred();
  let calls = 0;
  h.state.session.put = () => (++calls === 1 ? first.promise : second.promise);
  h.edit(null, 'login');
  modalElements(h, 'input')[0].value = 'First';
  const old = modalElements(h, 'form')[0].emit('submit');
  await tick();
  await modalElements(h, 'button')
    .find((e) => e.textContent === 'Cancel')
    .emit('click');
  h.edit(null, 'login');
  modalElements(h, 'input')[0].value = 'Second';
  const next = modalElements(h, 'form')[0].emit('submit');
  await tick();
  assert.equal(calls, 2);
  assert.equal(h.state.busy, true);
  first.resolve({ envelope: { revision: 2 } });
  await old;
  assert.equal(h.state.busy, true);
  second.reject(Object.assign(Error(), { code: 'INVALID_DATA' }));
  await next;
  assert.equal(h.state.busy, false);
});
test('REVIEW: modal retains an actionable Lock button while keys are owned', async () => {
  const h = unlocked(harness());
  h.state.session.lock = function () {
    this.locked = true;
  };
  h.edit(null, 'login');
  const dialog = modalElements(h, 'dialog')[0];
  const lock = walk(dialog).find((e) => e.tagName === 'BUTTON' && e.textContent === 'Lock');
  assert.ok(lock);
  await lock.emit('click');
  assert.equal(h.state.session, null);
  assert.equal(modalElements(h, 'dialog').length, 0);
  assert.equal(h.document.activeElement, h.el('main'));
});
test('REVIEW: invalid hidden optional data is exposed with actionable focused feedback', async () => {
  const h = unlocked(harness());
  h.edit(null, 'login');
  const fields = modalElements(h, 'input');
  fields[0].value = 'Synthetic';
  const url = fields.at(-1);
  url.value = 'example.invalid';
  const disclosure = modalElements(h, 'details')[0];
  disclosure.removeAttribute('open');
  await modalElements(h, 'form')[0].emit('submit');
  assert.notEqual(disclosure.getAttribute('open'), null);
  assert.match(h.document.activeElement.textContent, /Website.*https/);
  assert.equal(h.document.activeElement.getAttribute('role'), 'alert');
});

test('REVIEW: first-time creation exposes modal Lock as soon as temporary keys exist', () => {
  const h = harness();
  h.modal('Create vault', '', () => {});
  let lock = modalElements(h, 'button').find((e) => e.textContent === 'Lock');
  assert.ok(lock);
  assert.equal(lock.hidden, true);
  const temporary = {
    locked: false,
    lock() {
      this.locked = true;
    },
  };
  h.temporarySessions.set(temporary, h.gate.begin());
  h.state.pending = { session: temporary, detached: false };
  h.render();
  lock = modalElements(h, 'button').find((e) => e.textContent === 'Lock');
  assert.equal(lock.hidden, false);
});
