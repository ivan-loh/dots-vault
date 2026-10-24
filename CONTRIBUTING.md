# Contributing

1. Start from a clean branch and use only fictional test data.
2. Write a failing regression test before behavioral changes.
3. Keep implementation and tests together within the affected domain. Prefer small, named functions and explicit error handling.
4. Run `npm run format:check` and `npm run verify` before proposing changes.
5. Describe verified behavior and untested limits. A source test is not a deployed or physical-device test.

Use camelCase for JavaScript functions/locals, PascalCase for classes/types, UPPER_SNAKE_CASE for static source gates, and kebab-case for owned module filenames. Preserve existing database, wire-format, and MCP names for compatibility.

Never commit local configuration, identity subjects, real email addresses, credentials, cookies, tokens, database dumps, screenshots, vault exports, personal notes, or operational logs. Use `.example` files with empty or clearly synthetic values. Do not include old Git bundles or private history in a public release.

Do not casually rewrite the retained private-vault bundle or recovered server code. See [the preservation boundary](docs/architecture.md). A new source release is not permission to deploy it or widen the sharing audience.
