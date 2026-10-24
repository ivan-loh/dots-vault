// Server-only SHA256. Never imports password derivation or key-custody code.
import {encode,utf8,b64,fail} from './codec.mjs';
export async function digestBytes(bytes){
 if(!(bytes instanceof Uint8Array))fail();
 return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
}
export const digest=value=>digestBytes(utf8(encode(value)));
