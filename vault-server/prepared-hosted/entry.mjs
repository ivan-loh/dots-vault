import {encode} from '../src/codec.mjs';
import {securityHeaders} from '../src/http.mjs';
// Deliberately no environment switch, alternate enabled export or request reads.
// Activation requires a separately reviewed source change and authorization.
export async function handleHostedRequest(){
 return new Response(encode({code:'DEPLOYMENT_DISABLED',mode:'disabled'}),{status:503,headers:{...securityHeaders,'content-type':'application/json; charset=utf-8'}});
}
