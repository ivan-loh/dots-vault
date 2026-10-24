import { getChatGPTUser } from '../../chatgpt-auth';
import { applyReadinessHeaders, readinessResponse } from '../../../lib/vault-readiness.mjs';
import { humanState } from '../../../lib/human-route';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await getChatGPTUser();
  return applyReadinessHeaders(readinessResponse('GET', user, humanState(user)));
}
const reject = () => applyReadinessHeaders(readinessResponse('UNSUPPORTED', null));
export {
  reject as POST,
  reject as PUT,
  reject as PATCH,
  reject as DELETE,
  reject as HEAD,
  reject as OPTIONS,
};
