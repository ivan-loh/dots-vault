# Development

## Requirements and installation

Use Node.js 22.13+, npm, and Git (the source-archive tests create a temporary local repository). Run `npm ci` to install exactly the committed lockfile. The framework build uses Vinext, Vite, React, and Cloudflare's local Worker tooling. Build/install scripts may create only ignored output and local tool state. Install failures are not a successful verification.

## Commands

- `npm test`: source tests using synthetic fixtures and isolated local D1.
- `npm run typecheck`: TypeScript checks without emit.
- `npm run lint`: lint owned code and the retained integration scaffolding.
- `npm run check`: test, typecheck, and lint.
- `npm run build`: build the Worker and browser assets into `dist/`.
- `npm run test:compiled`: exercise the actual compiled Worker against isolated D1; build first.
- `npm run verify`: run all the above, in order.
- `npm run preview:synthetic`: serve the built vault and Shared Notes locally at `http://127.0.0.1:4176/vault`. Build first. Synthetic identity only, no durable database, fake data only.
- `npm run dev`: framework hot-reload server; real data remains unavailable without trusted runtime identity and owner/origin configuration.
- `npm run format:check` / `npm run format`: check/format owned source and docs. Preserved browser/server artifacts, migration snapshots, the lockfile, and vendored plugin source are excluded.
- `npm run archive`: archive the current committed source snapshot to ignored `artifacts/`. Requires a clean tracked worktree and Git. The archive contains no Git history and does not include ignored/untracked files.

`tests/browser-harness.mjs` additionally offers a Shared Notes-only synthetic preview on port 4175. Neither preview is a deployment server. Do not bind it to a public interface, supply real credentials, or use real data.

## Editing boundaries

Keep Shared Notes features together in `shared-notes/`; cross-cutting tests live under `tests/`. Keep existing protocol fields, route paths, and persisted schema identifiers unless a separate versioned migration explicitly changes them. Source gates do not replace runtime authorization.

The private browser bundle and recovered server modules are preserved rather than cosmetically rewritten. Cryptographic changes need a dedicated review and recovery plan, not a formatting pass. Never replace a pinned hash merely to make an unexpected bundle change pass.

`poc/` is a historical directory name retained to avoid needless runtime/import churn. It holds the current MCP protocol runtime and synthetic fixtures, not a private-data access path. The `prepared-hosted/` server directory likewise retains its original import path; `human-runtime.mjs` is active application code.

## Local tooling

The `scripts/` support files include portable and managed-hosting execution profiles. Fresh clones default to the portable profile. Local state stays in ignored `.sites-runtime/` and `.wrangler/`; do not commit it. You do not need an authenticated hosting connection to run the synthetic test suite.
