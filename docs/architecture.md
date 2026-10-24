# Architecture and access boundaries

## Identity and transport

The trusted hosting layer enforces owner-private access. The application additionally requires the configured site-scoped owner identity, a nonblank trusted identity email, and its exact configured HTTPS origin. Browser data mutations require same-origin POSTs. MCP uses the canonical `/mcp` route and supported protocol envelopes.

A missing raw Host is tolerated only with the exact canonical request URL and trusted owner identity. Present foreign/malformed Host and cross/opaque Origin are rejected. Caller-supplied labels, headers, or note text never identify an individual dot. The header helper is not an authentication system by itself; the deployment boundary must prevent direct access and strip untrusted identity headers.

## Private encrypted vault

The retained browser bundle owns encryption, unlock state, recovery, and private-item editing. The `vaults` and `mutation_limits` tables hold encrypted envelopes and mutation limits. The server validates envelope shape and revisions without receiving a browser master password or decryption key.

No Shared Notes module receives a private item, master password, or decryption key. A malicious frontend update or compromised unlocked browser remains a risk. Encryption at rest is not protection from malicious delivered JavaScript.

### Preservation boundary

`vault-assets/app.js.txt` is the surviving browser artifact. It contains bundled third-party libsodium code followed by recovered application modules. The final `// web/app.mjs` marker separates the UI suffix from the protected crypto/session/transport prefix. Tests pin that prefix's SHA-256. The original unbundled sources and their exact package lock were not recovered, so rebuilding this artifact from original modules is not currently reproducible.

This source release leaves the entire browser bundle and recovered `vault-server/` modules byte-identical to the candidate it exports. They are intentionally excluded from cosmetic formatting. Do not treat that preservation as an audit, patch the pinned hash casually, or claim the original source has been reconstructed.

The small browser UI suffix remains readable within the bundle. Future work may recover the original modules or undertake a separately reviewed migration, with independent crypto, compatibility, and recovery testing. Neither is part of a repository cleanup.

## Explicit Shared Notes

The browser screen holds an unsaved local draft. A full-value confirmation binds title, body, note ID, expected revision, and operation ID. Review-only Unicode escaping reveals invisible characters without changing actual values. Publication creates a plaintext shared copy. The service and agents using the authorized account connection, including non-dot sessions, can read it while the private vault is locked.

`shared_notes` is owner/note unique. Atomic conditional statements enforce revision compare-and-swap, last-operation replay/substitution checks, and owner capacity. Latest receipts support uncertain-response reconciliation, not permanent historical operation-ID uniqueness. `shared_note_limits` bounds publication attempts; exact latest replay and revocation remain available without quota.

Revocation increments the revision, clears title/body, and replaces the content digest with a revoke-only digest. Tombstones retain IDs to prevent accidental resurrection. It blocks new selections, not copies already delivered, retained backups, or reads selected before revocation. Native database administration is outside the application sharing filter.

An ambiguous write remains unknown until a matching receipt is observed. Missing receipts do not prove noncommit. Exact retries cannot silently substitute values. Clearing local text removes the retry payload, not a published copy. Discarding local tracking does not cancel or revoke a server operation. Hidden/navigation/restored/idle clearing is a best-effort UI privacy measure, not guaranteed memory erasure.

## Agent tools

`poc/` retains the historical module name for compatibility. It implements MCP validation/dispatch, two fictional-fixture tools, and, when enabled, `list_shared_notes` and `read_shared_note` at the exact listed revision. There is no agent write, private catalog, decrypt, generic password, or private-item export tool. Shared Note text is untrusted data, not new action authority.

## Source and hosting support

`app/` and `worker/` retain framework and request-boundary adapters. `shared-notes/` contains the readable feature modules and domain tests. `lib/` holds route adapters and connector contracts. The remaining preview/build scripts are integration support, not production credentials. The vendored Sites plugin keeps its upstream license and is excluded from reformatting.
