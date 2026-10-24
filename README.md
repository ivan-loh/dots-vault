# dots-vault

An owner-unlocked encrypted vault for private notes and contacts, with a separate **Shared Notes** channel for intentionally published plaintext copies.

This repository is a sanitized source snapshot, not a deployment or a backup of vault data. It includes the unlock-first mobile UI candidate; publishing source does not deploy it. Do not assume a live installation matches this checkout.

## Security boundaries

- The browser unlocks the private vault. The server stores encrypted envelopes; agent tools cannot decrypt or read private vault records.
- Shared Notes are separate plaintext copies that the owner explicitly publishes, edits, or revokes in the browser. There is no automatic copying from the private vault.
- Agents using the authorized account connection, including non-dot sessions, can read published copies while the private vault is locked. This is not individual-agent isolation.
- Revocation blocks future selection but cannot recall prior reads, copies, backups, or reads selected before revocation.
- A compromised browser or malicious frontend update can expose unlocked data. This project is not independently audited and makes no zero-knowledge guarantee.

## Quick start

Use Node.js **22.13 or newer**, npm, and Git (for source-archive tests). The lockfile is committed.

```sh
npm ci
npm run check
npm run build
npm run test:compiled
npm run preview:synthetic
```

Open `http://127.0.0.1:4176/vault` for the synthetic local preview. It uses an isolated in-memory database and a fictional owner. **Use fake data only.** Stop with Ctrl+C; no real account or hosting credentials are required.

`npm run dev` starts the framework development server. Without valid owner/origin bindings, application data access intentionally stays unavailable. For the complete vault UI, use the synthetic preview above rather than weakening authorization.

See [development](docs/development.md) for command details and [configuration](docs/configuration.md) before any deployment. A raw Worker endpoint is not safe to expose directly: the application relies on a trusted authentication layer that strips untrusted identity headers.

## Source map

| Directory                   | Responsibility                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `app/`, `worker/`           | Framework routes, trusted identity integration, route and security-header boundaries |
| `lib/`                      | Route adapters, source gates, connector contracts, and readiness helpers             |
| `shared-notes/`             | Readable Shared Notes UI, transport, state model, storage, and colocated tests       |
| `poc/`                      | MCP protocol and fictional fixtures; also dispatches read-only Shared Notes tools    |
| `vault-server/`             | Encrypted-envelope persistence and owner-scoped server runtime                       |
| `vault-assets/`             | Retained browser bundle and static vault UI; see the preservation boundary below     |
| `db/`, `drizzle/`           | Schema and append-only D1 migrations                                                 |
| `tests/`                    | Cross-cutting source tests, compiled Worker checks, and local browser harnesses      |
| `scripts/`                  | Build/install tooling, local preview integration, and source archiving               |
| `skills/access-dots-vault/` | Generic agent access skill and public tool-contract reference                        |

Existing wire names, database identifiers, and route paths are retained for compatibility. JavaScript identifiers use camelCase, exported classes/types use PascalCase, source gates use UPPER_SNAKE_CASE, and owned module filenames use kebab-case. Tool argument keys retain their existing snake_case contract.

## Preserved browser bundle

The original prebundle browser crypto/session/transport modules were not recovered. `vault-assets/app.js.txt` is the surviving bundled artifact, including libsodium and the application UI. It is intentionally **not reformatted or rebuilt** in this release; a regression test pins the cryptographic prefix. The UI suffix is readable, but rebuilding the bundle from original modules is not currently reproducible. See [architecture](docs/architecture.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Agent access

Use only the tools actually exposed by the authenticated connection. The included [access skill](skills/access-dots-vault/SKILL.md) documents list-then-read with the exact returned note ID and revision. It grants no permission to publish, edit, revoke, or bypass authentication.

## Contributing and verification

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [verification scope](docs/verification.md). `npm run verify` runs source tests, typecheck, lint, build, and compiled-runtime checks. It does not deploy, certify security, or replace physical-device accessibility testing.

No license for original project code is granted by this snapshot. Third-party code remains subject to its existing notices and licenses.
