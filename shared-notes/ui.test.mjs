import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
test('full-value consent starts at heading and warnings, not final confirmation', () => {
  const html = read('index.html.txt'),
    app = read('app.mjs');
  assert.match(html, /aria-describedby="review-warning"/);
  assert.match(html, /id="review-heading" tabindex="-1"/);
  assert.match(app, /elements\['review-heading'\]\.focus\(\)/);
  assert.doesNotMatch(app, /confirm\.focus/);
  assert.match(app, /elements\.exact\.textContent\s*=\s*reviewText/);
});
test('draft UI never silently truncates and dynamic text never becomes HTML', () => {
  const html = read('index.html.txt'),
    app = read('app.mjs');
  assert.doesNotMatch(html, /maxlength|<form|type="password"/i);
  assert.doesNotMatch(
    app,
    /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|indexedDB|sendBeacon|serviceWorker/,
  );
  assert.match(app, /TextEncoder/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /pagehide/);
  assert.match(app, /pageshow/);
  assert.match(app, /120000/);
  assert.match(html, /including non-dot sessions/);
  assert.match(html, /selected before revocation/);
});
test('review action visual order matches keyboard order at phone widths', () =>
  assert.doesNotMatch(read('styles.css.txt'), /column-reverse|row-reverse/));
