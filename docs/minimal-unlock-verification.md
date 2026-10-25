# Minimal unlock refinement verification

Date: 2026-10-25. This describes the source snapshot, not a deployment claim.

## Scope

The normal existing-vault screen is reduced from 66 visible whitespace-separated tokens to nine, including the brand. It retains the visible Master password label, one Unlock action, Recovery & help disclosure and Shared Notes link. The heading remains available to assistive technology without repeating it visually. Recovery mode expands help to keep Use master password discoverable.

The former decryption, browser-risk, secret-handling, timeout and Shared Notes explanations remain inside help. Actionable errors stay beside the input. First-time setup, unavailable storage/owner, loading and pending-write screens are unchanged. No private records are read, changed or reset for verification.

## Checks and independent review

Failing tests preceded the UI change. Four additional regressions cover the visible-word budget and semantic label, recovery round-trip focus/value clearing, recovery error and hidden-page interruption, and the secondary recovery control during a pending unlock. Existing duplicate-submit, late-key invalidation, authorization loss and pending-save reconciliation tests remain intact.

Independent review found no blockers, exercised successful recovery unlock, and compared the unchanged setup/unavailable/loading/pending DOMs with baseline. The immutable 605,659-byte browser prefix remains SHA256 `f1cee24bd61d87a25bdee35d6134885ae34265e4a56565cb45f5a621529195dd`. No crypto, server, session, database, dependency, authorization or runtime-configuration code changed.

The private source passes 156 tests, TypeScript, ESLint, changed-test formatting, official production build and 120 compiled-Worker checks. The sanitized public source passes 160 tests, TypeScript, zero-warning ESLint, configured formatting, official production build and 120 compiled-Worker checks. Raw browser assets remain excluded from cosmetic formatting.

## Browser verification

An isolated synthetic desktop Chromium preview confirmed the 66-to-nine reduction at 320, 375, 390 and 430 CSS pixels. Closed and expanded help have no horizontal overflow. All normal controls fit in the narrow initial viewport; the heading remains accessibility-only. Inputs are 16px; Unlock and disclosure targets are 48px, with 44px recovery and Shared Notes targets.

First-time creation and synthetic recovery-key generation worked. Keyboard focus order, incorrect-password feedback and secret clearing, switching both recovery directions, successful recovery unlock and repeated submissions passed. Navigating to Shared Notes during the observed Unlocking state, then returning with browser Back, restored a locked form with an empty secret and no private navigation.

Native tab-background clearing could not be reliably exercised: the cloud preview did not report a hidden document during the tested tab switch. That behavior remains unverified in this browser; unchanged lifecycle code and deterministic hidden-page/late-key tests provide regression coverage, not a claim of native tab-switch success. No lifecycle behavior was modified to accommodate the test environment.

No physical iOS/Android device or screen-reader test is claimed. Deterministic deferred-response tests cover network timing not reliably reproducible in the browser harness. This is not a professional security audit.
