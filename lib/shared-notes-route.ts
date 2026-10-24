import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';
import { SHARED_NOTES_ENABLED } from './shared-notes-activation.mjs';
import { handleSharedRequest } from '../shared-notes/ingress.mjs';
import { SharedStore } from '../shared-notes/store.mjs';
import html from '../shared-notes/index.html.txt?raw';
import stylesheet from '../shared-notes/styles.css.txt?raw';
import app from '../shared-notes/app.mjs?raw';
import session from '../shared-notes/session.mjs?raw';
import transport from '../shared-notes/transport.mjs?raw';
import model from '../shared-notes/model.mjs?raw';
const assets = {
  '/shared-notes': { body: html, type: 'text/html; charset=utf-8' },
  '/shared-notes/styles.css': { body: stylesheet, type: 'text/css; charset=utf-8' },
  '/shared-notes/app.mjs': { body: app, type: 'text/javascript; charset=utf-8' },
  '/shared-notes/transport.mjs': { body: transport, type: 'text/javascript; charset=utf-8' },
  '/shared-notes/session.mjs': { body: session, type: 'text/javascript; charset=utf-8' },
  '/shared-notes/model.mjs': { body: model, type: 'text/javascript; charset=utf-8' },
};

export async function sharedNotesRoute(request: Request) {
  return handleSharedRequest(request, {
    enabled: SHARED_NOTES_ENABLED,
    assets,
    pins: {
      VAULT_OWNER_SUBJECT: env.VAULT_OWNER_SUBJECT,
      VAULT_CANONICAL_ORIGIN: env.VAULT_CANONICAL_ORIGIN,
    },
    getIdentity: getChatGPTUser,
    getStore: () => new SharedStore(env.DB),
  });
}
