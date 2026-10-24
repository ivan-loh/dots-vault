import test from 'node:test';
import assert from 'node:assert/strict';
const boundary = await import('../lib/route-boundary.mjs').catch(() => null);
test('pre-routing namespace boundary exists', () => assert.ok(boundary));
if (boundary)
  test('reserved aliases fail before normalization while canonical and readiness assets remain', () => {
    for (const path of [
      '/api/status/',
      '/api/vault/replace/',
      '/api/readiness/',
      '/api//status',
      '/vault/',
      '/vault/assets/app.js/',
      '/api/%76ault/create',
      '/vault/assets/%61pp.js',
      '/API/status',
      '/%61pi/status',
    ])
      assert.equal(boundary.rejectHumanAlias(path), true, path);
    for (const path of [
      '/api/status',
      '/api/vault',
      '/api/vault/create',
      '/api/vault/replace',
      '/vault',
      '/vault/assets/app.js',
      '/vault/assets/styles.css',
      '/api/readiness',
      '/',
      '/identity',
      '/_next/static/css/index.fixture.css',
      '/favicon.svg',
    ])
      assert.equal(boundary.rejectHumanAlias(path), false, path);
  });
