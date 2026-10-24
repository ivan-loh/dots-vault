# Configuration and deployment boundary

This repository contains no configured owner, production URL, project identifier, connector identifier, hosting credentials, or actual vault records.

`.openai/hosting.json` declares the required `DB` D1 binding and canonical MCP capability, with no project binding. A hosting deployment must supply its own project mapping separately. Do not add personal deployment identifiers to the public source tree.

The Worker requires:

| Binding                  | Requirement                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `DB`                     | D1 database with the committed migrations applied in order           |
| `VAULT_OWNER_SUBJECT`    | Exact trusted, site-scoped owner subject; nonempty and unpadded      |
| `VAULT_CANONICAL_ORIGIN` | Exact HTTPS origin, with no path, query, fragment, or trailing slash |

`.dev.vars.example` intentionally leaves both values empty. Missing or invalid pins fail closed. Keep real values in the hosting control plane's configuration, never in the repository or logs. No owner can be established by a caller-provided label or a Shared Note.

## Trusted identity is mandatory

`app/chatgpt-auth.ts` reads identity headers provided by the hosting authentication layer. **Those headers are not self-authenticating.** The deployment must ensure ordinary callers cannot reach the Worker directly and must strip or overwrite incoming identity headers before delivering a verified identity. Do not expose a raw Worker endpoint and assume matching headers prove ownership.

Current source gates enable private-browser routes, fictional fixture tools, and Shared Notes. They still require valid runtime pins and trusted owner identity. The private browser API enforces the configured origin for mutations. The agent route is the canonical `/mcp`, with read-only tools; there is no agent decrypt/write API.

## Deployment checklist

1. Provision the trusted authenticated hosting boundary and a private D1 database.
2. Set the exact owner subject and canonical HTTPS origin through the provider's protected configuration.
3. Apply `drizzle/*.sql` in order without deleting existing data or historical migrations.
4. Run `npm run verify` against this exact source.
5. Use the provider's supported publishing workflow, with its own review and authorization.
6. Verify the actual deployed owner, wrong-owner, anonymous, missing-origin, cross-origin, and noncanonical-path cases. Verify actual connection tool calls, not just discovery metadata.

This source release provides no deployment command, automated deployment workflow, credentials, or guarantee that a current installation uses this version. Do not change permissions or mint access tokens merely to complete a local build.
