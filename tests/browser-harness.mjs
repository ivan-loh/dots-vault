// Local browser QA only. No production bindings, secrets or persistent records.
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
const root = resolve(process.argv[2] ?? '.');
const origin = 'https://vault.example',
  owner = 'compiled-synthetic-owner';
const configuration = JSON.parse(readFileSync(root + '/dist/server/wrangler.json', 'utf8'));
const moduleFiles = readdirSync(root + '/dist/server', { recursive: true }).filter((f) =>
  /\.m?js$/.test(f),
);
// Miniflare's Node transport rewrites raw Host. This in-memory test ingress
// restores ONLY the explicit synthetic Host case; the actual built Worker and
// every authorization predicate remain byte-unmodified. Never packaged/deployed.
const entry = {
  type: 'ESModule',
  path: root + '/dist/server/synthetic-test-entry.mjs',
  contents: `import worker from './index.js'; export default {fetch(request,env,ctx){const headers=new Headers(request.headers);const host=headers.get('x-local-synthetic-host');headers.delete('x-local-synthetic-host');const origin=headers.get('x-local-synthetic-origin');headers.delete('x-local-synthetic-origin');if(origin===null)headers.delete('origin');else headers.set('origin',origin);if(host===null||host==='__absent__')headers.delete('host');else headers.set('host',host);return worker.fetch(new Request(request,{headers}),env,ctx)}}`,
};
const mf = new Miniflare({
  modules: [
    entry,
    ...[configuration.main, ...moduleFiles.filter((f) => f !== configuration.main)].map((path) => ({
      type: 'ESModule',
      path: root + '/dist/server/' + path,
    })),
  ],
  modulesRoot: root + '/dist/server',
  compatibilityDate: configuration.compatibility_date,
  compatibilityFlags: configuration.compatibility_flags,
  bindings: { VAULT_OWNER_SUBJECT: owner, VAULT_CANONICAL_ORIGIN: origin },
  d1Databases: ['DB'],
  cf: false,
  port: 0,
  inspectorPort: 0,
  assets: {
    directory: root + '/dist/client',
    binding: 'ASSETS',
    routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
  },
  outboundService: () => new Response('Synthetic test: outbound blocked', { status: 403 }),
});

const db = await mf.getD1Database('DB');
for (const file of readdirSync(root + '/drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort())
  for (const sql of readFileSync(root + '/drizzle/' + file, 'utf8')
    .split('--> statement-breakpoint')
    .map((x) => x.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
const browserOrigin = 'http://127.0.0.1:4175';
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== '127.0.0.1:4175' || !req.url.startsWith('/shared-notes')) {
      res.writeHead(403);
      res.end('Synthetic Shared Notes QA only.');
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const headers = {
      'x-local-synthetic-host': 'vault.example',
      'oai-authenticated-user-id': owner,
      'oai-authenticated-user-email': 'synthetic@example.invalid',
    };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (req.headers.origin)
      headers['x-local-synthetic-origin'] =
        req.headers.origin === browserOrigin ? origin : req.headers.origin;
    const response = await (
      await mf.getWorker()
    ).fetch(origin + req.url, {
      method: req.method,
      headers,
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Synthetic QA request unavailable.');
  }
});
server.listen(4175, '127.0.0.1', () =>
  console.log(
    JSON.stringify({
      url: browserOrigin + '/shared-notes',
      synthetic: true,
      workerSHA256: createHash('sha256')
        .update(readFileSync(root + '/dist/server/index.js'))
        .digest('hex'),
    }),
  ),
);
process.on('SIGINT', () =>
  server.close(async () => {
    await mf.dispose();
    process.exit(0);
  }),
);
