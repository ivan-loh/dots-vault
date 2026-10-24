# Third-party notices and source limits

## Retained browser crypto artifact

`vault-assets/app.js.txt` contains libsodium-sumo and libsodium-wrappers-sumo code, identified by the bundled module comments, plus a WebAssembly payload. The original dependency lockfile and prebundle sources were not recovered, so this repository does not assert exact bundled package versions or a reproducible browser crypto rebuild.

The upstream projects distribute their code under the ISC license. Copies of the current upstream notices are included at [licenses/libsodium.LICENSE](licenses/libsodium.LICENSE) and [licenses/libsodium-js.LICENSE](licenses/libsodium-js.LICENSE). Upstream sources:

- https://github.com/jedisct1/libsodium
- https://github.com/jedisct1/libsodium.js

These notices do not imply the retained artifact was built from the current upstream revision, that the artifact has been audited, or that original-source provenance has been recovered. Preserve the artifact until a separately reviewed recovery or replacement is possible.

## Sites development plugin

`scripts/vite/sites-vite-plugin.ts` identifies its upstream as `@openai/sites-vite-plugin` 0.2.0. Its MIT notice is retained at `scripts/vite/sites-vite-plugin.LICENSE`. The vendored source is excluded from formatting.

## Package dependencies

Direct and transitive dependency versions and integrity values are pinned in `package-lock.json`. Installed packages carry their own license notices. No third-party license grants a license to the project's original code; no original-code license is declared in this snapshot.
