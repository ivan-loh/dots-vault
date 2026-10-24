// Internal human-vault adapter. The actual Sites route supplies request-scoped
// identity and runtime bindings; neither comes from request JSON or query data.
import {encode} from '../src/codec.mjs';
import {handleRequest, securityHeaders} from '../src/http.mjs';
import {SqlStore} from '../src/store.mjs';
import {D1MutationLimiter} from '../src/d1-limiter.mjs';

const assetPaths = new Set(['/vault', '/vault/assets/app.js', '/vault/assets/styles.css']);
const apiMethods = new Map([['/api/status', 'GET'], ['/api/vault', 'GET'], ['/api/vault/create', 'POST'], ['/api/vault/replace', 'POST']]);
export function humanPath(path) {return assetPaths.has(path) || apiMethods.has(path);}
export function humanConfiguration(pins) {
 try {
  const ownerId = pins?.VAULT_OWNER_SUBJECT, origin = pins?.VAULT_CANONICAL_ORIGIN;
  if (typeof ownerId !== 'string' || ownerId.length < 1 || ownerId.length > 256 || ownerId.trim() !== ownerId || /[\u0000-\u001f\u007f]/.test(ownerId) || typeof origin !== 'string') return null;
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) return null;
  return {ownerId, origin};
 } catch {return null;}
}
function reply(code, status, method) {
 return new Response(method === 'HEAD' ? null : encode({code}), {status, headers: {...securityHeaders, 'content-type': 'application/json; charset=utf-8'}});
}
export async function schemaReady(db) {
 try {
  for (const sql of ['SELECT owner_id,vault_id,revision,envelope,last_operation_id,digest FROM vaults LIMIT 0', 'SELECT owner_id,window,count FROM mutation_limits LIMIT 0']) {
   const result = await db.prepare(sql).all();
   if (result?.success !== true || !Array.isArray(result.results) || result.results.length !== 0) return false;
  }
  return true;
 } catch {return false;}
}
export async function handleHumanRuntime(request, options = {}) {
 // A source-level gate in the Sites route precedes this internal testable gate.
 if (options.enabled !== true) return reply('DEPLOYMENT_DISABLED', 503);
 const {pins, getIdentity, getDatabase, assets} = options;
 const config = humanConfiguration(pins);
 if (!config) return reply('DEPLOYMENT_DISABLED', 503, request.method);
 try {
  const url = new URL(request.url), origin = new URL(config.origin), method = request.method;
  if (url.origin !== config.origin || request.headers.get('host') !== origin.host || (method === 'POST' && request.headers.get('origin') !== config.origin)) return reply('FORBIDDEN', 403, method);
  const user = await getIdentity();
  if (!user?.email || user.userId !== config.ownerId) return reply('FORBIDDEN', 403, method);
  if (!humanPath(url.pathname)) return reply('NOT_FOUND', 404, method);
  const expected = assetPaths.has(url.pathname) ? 'GET' : apiMethods.get(url.pathname);
  if (method !== expected) return reply('METHOD_NOT_ALLOWED', 405, method);
  if (assetPaths.has(url.pathname)) {
   const asset = assets?.[url.pathname];
   if (!asset || typeof asset.body !== 'string' || typeof asset.type !== 'string') return reply('DEPLOYMENT_DISABLED', 503, method);
   return new Response(asset.body, {headers: {...securityHeaders, 'content-type': asset.type}});
  }
  const db = await getDatabase();
  if (typeof db?.prepare !== 'function' || (url.pathname === '/api/status' && !await schemaReady(db))) return reply('STORAGE_UNAVAILABLE', 503, method);
  return handleRequest(request, {
   // This marks the reviewed platform identity contract, not an assertion that
   // ingress spoof-resistance has been empirically established by local tests.
   config: {...config, mode: 'production', ownerVerified: true, dispatchVerified: true},
   identity: {subject: user.userId, source: 'sites-dispatch'},
   store: new SqlStore(db), limiter: new D1MutationLimiter(db),
  });
 } catch {return reply('REQUEST_FAILED', 503, request.method);}
}
