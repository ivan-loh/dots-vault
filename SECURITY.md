# Security

This is an unaudited application and a sanitized source snapshot, not a security certification. Prefer synthetic data while evaluating it.

## Important limits

- Encryption protects stored private envelopes, not an unlocked or compromised browser, malicious frontend update, stolen recovery material, or compromised endpoint.
- Shared Notes are plaintext copies. The authorized account connection is the audience; individual dots are not separately attested.
- Revocation cannot retract prior copies, backups, or reads already selected.
- The hosting layer must authenticate the owner and prevent forged identity headers or direct unauthenticated Worker access.
- Local synthetic test harnesses deliberately provide a fictional identity. They must never be exposed publicly or used for real data.
- Missing original prebundle crypto source limits reproducibility and maintainability. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Reporting

Do not place passwords, recovery keys, real note contents, personal information, or exploitable production details in a public issue. Use the repository host's private vulnerability-reporting channel if enabled, or contact the maintainer through an existing private channel. This repository does not promise a response SLA or a bug bounty.

Provide the affected commit, minimal synthetic reproduction, expected/actual behavior, and impact. Redact secrets and identifiers before attaching logs. Do not test against someone else's account or deployment without authorization.
