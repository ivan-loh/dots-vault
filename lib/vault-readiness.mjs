// Diagnostics are read-only; runtime state is supplied by the actual route.
export const READINESS = Object.freeze({
  mode: 'disabled',
  dataEnabled: false,
  ownerPinned: false,
  dotAccessEnabled: false,
});
/** @param {string} method @param {{userId?:string,email?:string}|null} user @param {{mode?:string,dataEnabled:boolean,ownerPinned:boolean,dotAccessEnabled:boolean,ownerMatches?:boolean}} state */
export function readinessResponse(method, user, state = READINESS) {
  if (method !== 'GET')
    return Response.json(
      { code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { Allow: 'GET' } },
    );
  if (!user?.userId || !user?.email)
    return Response.json({ code: 'AUTHENTICATION_REQUIRED', ...READINESS }, { status: 401 });
  return Response.json({
    ...state,
    identity: {
      subject: user.userId,
      source: 'Sites dispatch',
      status: state.ownerMatches ? 'matches pinned owner' : 'does not establish owner access',
    },
  });
}
export function disabledDataResponse() {
  return Response.json({ code: 'DEPLOYMENT_DISABLED', ...READINESS }, { status: 503 });
}
export function applyReadinessHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
