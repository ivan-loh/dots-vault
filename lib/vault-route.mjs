import { handleHostedRequest } from '../vault-server/prepared-hosted/entry.mjs';
import { securityHeaders } from '../vault-server/src/http.mjs';
// Plain external-script UI policy prepared independently of React hydration.
// Current responses are disabled and contain no forms, assets or secret fields.
export async function disabledVaultRoute(request) {
  const response = await handleHostedRequest();
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers,
  });
}
