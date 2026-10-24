import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePocRequest } from '../poc/runtime.mjs';
const origin = 'https://vault.example',
  pins = { VAULT_OWNER_SUBJECT: 'owner', VAULT_CANONICAL_ORIGIN: origin };
const opts = {
  enabled: true,
  pins,
  getIdentity: () => ({ userId: 'owner', email: 'owner@example.test' }),
};
const call = (method, params = {}) =>
  new Request(origin + '/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
        ...params,
      },
    }),
  });
test('Shared Notes tools appear only under explicit source gate and expose no mutation', async () => {
  const disabled = await (await handlePocRequest(call('tools/list'), opts)).json();
  assert.equal(disabled.result.tools.length, 2);
  const enabled = await (
    await handlePocRequest(call('tools/list'), { ...opts, sharedEnabled: true })
  ).json();
  assert.deepEqual(
    enabled.result.tools.map((x) => x.name),
    ['list_poc_fixtures', 'read_poc_fixture', 'list_shared_notes', 'read_shared_note'],
  );
});
test('MCP validates exact shared reference before lazy store and never accepts owner or writes', async () => {
  let seen = 0;
  const getSharedStore = () => ({
    list: async (owner) => {
      assert.equal(owner, 'owner');
      seen++;
      return [];
    },
    read: async () => {
      seen++;
      return { body: 'synthetic' };
    },
  });
  const config = { ...opts, sharedEnabled: true, getSharedStore };
  const good = await (
    await handlePocRequest(call('tools/call', { name: 'list_shared_notes', arguments: {} }), config)
  ).json();
  assert.equal(good.result.isError, false);
  assert.equal(seen, 1);
  for (const name of ['publish_shared_note', 'revoke_shared_note', 'read_private_note']) {
    const r = await (
      await handlePocRequest(call('tools/call', { name, arguments: {} }), config)
    ).json();
    assert.equal(r.result.isError, true);
  }
  const invalid = await (
    await handlePocRequest(
      call('tools/call', { name: 'read_shared_note', arguments: { note_id: 'x', revision: 1 } }),
      config,
    )
  ).json();
  assert.equal(invalid.result.isError, true);
  assert.equal(seen, 1);
});
