import { humanPath } from '../vault-server/prepared-hosted/human-runtime.mjs';

// Classification is intentionally broader than authorization. Decoded/case/slash
// aliases are rejected, never converted into an authorized canonical route.
export function humanNamespace(pathname) {
  try {
    const classified = decodeURIComponent(pathname)
      .replaceAll('\\', '/')
      .replace(/\/{2,}/g, '/');
    return /^\/(api|vault)(\/|$)/i.test(classified);
  } catch {
    return true;
  }
}
export function rejectHumanAlias(pathname) {
  return humanNamespace(pathname) && pathname !== '/api/readiness' && !humanPath(pathname);
}
