# Verification scope

The source export includes an unlock-first mobile UI candidate and preserves the private browser cryptographic prefix. Source publication is separate from deployment.

## Automated checks

`npm run verify` runs:

1. Source-level Node tests covering validation, authorization, canonical routing, Shared Notes concurrency/replay/revocation, transport recovery, UI state, and preserved-bundle/configuration guards.
2. TypeScript checks and ESLint.
3. A production Worker build.
4. Integration checks against that actual built Worker, using synthetic identity, isolated D1, and blocked outbound requests.

The compiled and browser harnesses restore synthetic Host/Origin fields in a test-only wrapper because the local transport rewrites them. The application authorization predicates and built Worker remain unchanged. The wrapper is not part of production output.

## Manual acceptance still required

Browser emulation is not a physical-phone test. Verify iOS/Android keyboards, password-manager interaction, VoiceOver/TalkBack, real-device focus behavior, zoom/reflow, and foreground/background transitions before treating a release as device-accepted. The source export does not claim these physical-device checks passed.

A local build does not verify production authentication, provider configuration, migration application, plugin discovery, or actual connection calls. Those require separate deployment-specific acceptance with non-sensitive test data. No cryptographic audit, penetration test, or guaranteed absence of secrets is claimed by these checks.
