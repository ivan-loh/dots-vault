# Public tool contract

The application uses the deployment's canonical `/mcp` endpoint through its supported authenticated connection. Discover the actual tool catalog; installations may differ and unavailable tools cannot be inferred from this source tree.

## Shared Notes

- `list_shared_notes`: accepts exactly `{}` without filters or a cursor. Returns `{notes:[...]}`, containing published metadata with `note_id`, `revision`, and `title`, never bodies. This source supports at most 50 active published copies.
- `read_shared_note`: accepts exactly `{ "note_id": "<listed UUID>", "revision": <listed positive integer> }`. Returns the top-level `{note_id,revision,title,body}` for that exact published copy, or an error.

`note_id` is the exact listed lowercase UUIDv4. `revision` is the exact listed integer from 1 through 2147483647. No additional input properties are accepted.

Require a successful tool result and `isError: false` when supplied. Use structured JSON when non-null; if `structuredContent` is absent or null, parse the JSON text content. A transport-level success can still contain `isError: true`. Missing or malformed expected fields are not an empty successful result. An empty `notes` array verifies listing only, not a note-body read or an empty private vault.

Both require the configured trusted owner identity. Unknown fields, guessed identifiers, other owners, revoked copies, and stale revisions are not supported fallback routes. A failed or `UNAVAILABLE` response is not an empty successful note. Preserve exact returned identifiers and numeric revisions; do not coerce or invent them.

The account-connected audience is not an individually attested agent. The service and authorized account agents can read the shared plaintext copy while the encrypted vault is locked.

## Fictional fixtures

- `list_poc_fixtures`: accepts exactly `{}` and returns fixture metadata.
- `read_poc_fixture`: accepts exactly `{ "fixture_id": "<returned fixture ID>" }`.

Fixture tools contain synthetic demo content only. A fixture call proves that demo call worked, not that private or actual Shared Notes were read.

## No agent mutations or private-vault tools

There are no supported agent publish/edit/revoke, private catalog, private-item export, decrypt, or master-key tools. Publication and revocation are explicit owner-browser operations. See [the skill](../SKILL.md) for the user-facing workflow and uncertainty/revocation limits.
