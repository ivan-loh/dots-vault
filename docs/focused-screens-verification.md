# Focused-screen redesign verification

Date: 2026-10-25. This record describes the source redesign, not a claim that any deployment has completed.

## Scope

Private lists have three content tabs, direct type-specific Add forms, preserved optional fields under More details, flat rows, visible Lock and secondary Settings. Shared Notes loads metadata only, opens exact revisions read-only, and requires explicit Edit before drafting. Exact publication/revocation reviews and the two-minute clearing behavior remain intact.

No encryption, server authorization, database, transport, session, dependency or runtime-configuration changes are included. The immutable browser prefix remains SHA256 `f1cee24bd61d87a25bdee35d6134885ae34265e4a56565cb45f5a621529195dd`. Public configuration remains deployment-neutral.

## Independent review

Separate reviews covered private usability/accessibility, Shared Notes asynchronous lifecycle, security contracts and sanitized release provenance. Important findings were reproduced with failing tests before repair: modal post-save focus, cancellation busy ownership, invalid collapsed fields, in-dialog Lock reachability, stale status activity, confirmed outcomes followed by failed refresh, and focus during delayed or late completions.

These reviews are not a professional security audit. Deterministic DOM tests do not faithfully model native dialog inertness, keyboard navigation, CSS or assistive technology.

## Source and compiled checks

The canonical application candidate passed 152 source tests, TypeScript, ESLint, formatting of changed JavaScript and the official production build. The actual compiled Worker passed 120 isolated synthetic ingress/storage checks. The public release passed 156 source tests, TypeScript, zero-warning ESLint, full configured formatting, the official production build and 120 compiled-Worker checks. Existing archive, sanitization and capability-copy tests remain intact. Preserved raw private browser assets are excluded from cosmetic formatting.

## Rendered browser checks

Synthetic desktop Chromium reflow checks passed at 320, 375, 390 and 430 CSS pixels for the locked entry and long exact-review screens, without horizontal page or dialog overflow. At 320px, private login/contact optional fields survived collapse/save/edit; private-note creation, Settings disclosures, Cancel, dirty Close and in-dialog Lock worked. Shared Notes read-only detail, explicit Edit, review cancellation via keyboard, dirty Back, publication, revision-two edit, exact revocation and refresh worked. A 9,000-byte draft was preserved and rejected without opening review; visible status received focus. Full-document browser Back returned to a locked private vault. Eight repeated synthetic publications produced a long list with no overflow; opening the last item focused its detail and Back restored list focus.

Final build smoke verification passed at 320 CSS pixels: first-time creation and dynamic Lock, login save focus, Lock/unlock/readback, closing and reopening the tab into a locked state, and Shared Notes exact publish/read-only detail/revoke. All used isolated synthetic data. Owned preview surfaces were closed and the synthetic listener was verified stopped; pre-existing browser and Terminal surfaces were preserved. No physical iOS/Android device, VoiceOver/TalkBack or production owner-authentication result is claimed. Delayed/unmatched write outcomes and every stale callback remain deterministic-test coverage, not an exhaustive live-browser network matrix. No production vault content is used for testing.

Nonblocking visual limitation: at 320px, a very long private detail title can wrap narrowly beside Lock/Close and occupy much of the modal's first viewport; its content remains reachable by scrolling.
