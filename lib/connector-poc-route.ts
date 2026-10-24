import { SHARED_NOTES_ENABLED } from './shared-notes-activation.mjs';
import { SharedStore } from '../shared-notes/store.mjs';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';
import { CONNECTOR_POC_ENABLED } from './connector-poc-activation.mjs';
import { handlePocRequest } from '../poc/runtime.mjs';

export async function connectorPocRoute(request: Request) {
  if (!CONNECTOR_POC_ENABLED) return handlePocRequest(request, { enabled: false });
  return handlePocRequest(request, {
    enabled: true,
    sharedEnabled: SHARED_NOTES_ENABLED,
    getSharedStore: () => new SharedStore(env.DB),
    pins: {
      VAULT_OWNER_SUBJECT: env.VAULT_OWNER_SUBJECT,
      VAULT_CANONICAL_ORIGIN: env.VAULT_CANONICAL_ORIGIN,
    },
    getIdentity: getChatGPTUser,
    diagnostic: (reason) => console.warn('DOTS_VAULT_POC_AUTH_REJECTED', reason),
  });
}
