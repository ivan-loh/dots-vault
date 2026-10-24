import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';
import { HUMAN_VAULT_ENABLED } from './human-activation.mjs';
import { disabledVaultRoute } from './vault-route.mjs';
import {
  handleHumanRuntime,
  humanConfiguration,
} from '../vault-server/prepared-hosted/human-runtime.mjs';
import html from '../vault-assets/index.html.txt?raw';
import javascript from '../vault-assets/app.js.txt?raw';
import stylesheet from '../vault-assets/styles.css.txt?raw';

// Browser cryptography is inert response text here, never executed in the Worker.
const assets = Object.freeze({
  '/vault': { body: html, type: 'text/html; charset=utf-8' },
  '/vault/assets/app.js': { body: javascript, type: 'text/javascript; charset=utf-8' },
  '/vault/assets/styles.css': { body: stylesheet, type: 'text/css; charset=utf-8' },
});
export function runtimePins() {
  return {
    VAULT_OWNER_SUBJECT: env.VAULT_OWNER_SUBJECT,
    VAULT_CANONICAL_ORIGIN: env.VAULT_CANONICAL_ORIGIN,
  };
}
export function humanState(user: { userId: string; email: string } | null) {
  const config = humanConfiguration(runtimePins());
  return {
    ownerPinned: Boolean(config),
    ownerMatches: Boolean(config && user?.email && user.userId === config.ownerId),
    dataEnabled: HUMAN_VAULT_ENABLED && Boolean(config),
    dotAccessEnabled: false,
  };
}
export async function humanRoute(request: Request) {
  if (!HUMAN_VAULT_ENABLED) return disabledVaultRoute(request);
  return handleHumanRuntime(request, {
    enabled: true,
    pins: runtimePins(),
    getIdentity: getChatGPTUser,
    getDatabase: () => env.DB,
    assets,
  });
}
