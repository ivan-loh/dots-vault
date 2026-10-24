import { SHARED_NOTES_ENABLED } from '../lib/shared-notes-activation.mjs';
import {
  sharedNamespace,
  rejectSharedAlias,
  handleSharedRequest,
  sharedHeaders,
} from '../shared-notes/ingress.mjs';
import { CONNECTOR_POC_ENABLED } from '../lib/connector-poc-activation.mjs';
import { handlePocRequest, pocNamespace, rejectPocAlias } from '../poc/runtime.mjs';
import { disabledVaultRoute } from '../lib/vault-route.mjs';
import { HUMAN_VAULT_ENABLED } from '../lib/human-activation.mjs';
import { humanNamespace, rejectHumanAlias } from '../lib/route-boundary.mjs';
import { humanPath } from '../vault-server/prepared-hosted/human-runtime.mjs';
import { securityHeaders } from '../vault-server/src/http.mjs';
import { applyReadinessHeaders } from '../lib/vault-readiness.mjs';
import handler from 'vinext/server/fetch-handler';
import { runWithConnectorBinding } from '../lib/connector-context';
import type { ConnectorBinding } from '../lib/connector-contract.mjs';

const worker = {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>,
  ) {
    const pathname = new URL(request.url).pathname;
    if (sharedNamespace(pathname)) {
      if (!SHARED_NOTES_ENABLED) return handleSharedRequest(request, { enabled: false });
      if (rejectSharedAlias(new URL(request.url)))
        return new Response(request.method === 'HEAD' ? null : '{"code":"NOT_FOUND"}', {
          status: 404,
          headers: { ...sharedHeaders, 'Content-Type': 'application/json; charset=utf-8' },
        });
    }
    if (pocNamespace(pathname)) {
      if (!CONNECTOR_POC_ENABLED) return handlePocRequest(request, { enabled: false });
      if (rejectPocAlias(new URL(request.url)))
        return applyReadinessHeaders(
          new Response(request.method === 'HEAD' ? null : '{"code":"NOT_FOUND"}', {
            status: 404,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }),
        );
    }
    if (!HUMAN_VAULT_ENABLED && humanNamespace(pathname) && pathname !== '/api/readiness')
      return disabledVaultRoute(request);
    // Vinext normalizes trailing slashes before route handlers. Reject aliases
    // here so no noncanonical path reaches a data handler or another CSP profile.
    // This branch does not read request identity, body or database.
    if (rejectHumanAlias(pathname))
      return applyReadinessHeaders(
        new Response(request.method === 'HEAD' ? null : '{"code":"NOT_FOUND"}', {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
      );
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: 'request_context_expired' };
          return preview.getContext?.() ?? { status: 'binding_unavailable' };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return {
              status: 'request_context_expired',
              message: 'This request has expired. Please try again.',
            };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    if (sharedNamespace(pathname)) {
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(sharedHeaders)) headers.set(name, value);
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        headers,
      });
    }
    if (!humanPath(pathname)) return applyReadinessHeaders(response);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers,
    });
  },
};

export default worker;
