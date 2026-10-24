import {encode,parseCanonical,exact,VaultError,LIMITS,fail} from './codec.mjs';
export const securityHeaders=Object.freeze({
 'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',
 'permissions-policy':'camera=(), microphone=(), geolocation=(), payment=()',
 'content-security-policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
});
export class RateLimiter{
 #windows=new Map();constructor(clock=()=>Date.now()){this.clock=clock;}
 allow(owner){const now=this.clock();let entry=this.#windows.get(owner);if(!entry||now-entry.start>=60000){entry={start:now,count:0};this.#windows.set(owner,entry);}return ++entry.count<=30;}
}
const response=(body,status=200)=>new Response(encode(body),{status,headers:{...securityHeaders,'content-type':'application/json; charset=utf-8'}});
function enabled(config){
 if(config?.mode==='synthetic')return config.ownerId==='synthetic-owner'&&config.origin==='http://127.0.0.1:4175';
 if(config?.mode==='production'){try{return config.ownerVerified===true&&config.dispatchVerified===true&&typeof config.ownerId==='string'&&config.ownerId.length>0&&new URL(config.origin).origin===config.origin&&new URL(config.origin).protocol==='https:';}catch{return false;}}
 return false;
}
async function boundedBody(request){
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')fail('CONTENT_TYPE');
 const max=LIMITS.envelope+2048,reader=request.body?.getReader();if(!reader)fail();const chunks=[];let count=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>max){await reader.cancel();fail('BODY_TOO_LARGE');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(count);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length;}return parseCanonical(bytes,max);
}
export async function handleRequest(request,{config,identity,store,limiter}={}){
 try{
  if(!enabled(config))return response({code:'DEPLOYMENT_DISABLED',mode:'disabled'},503);
  const url=new URL(request.url),expected=new URL(config.origin);
  if(url.origin!==config.origin||request.headers.get('host')!==expected.host)return response({code:'FORBIDDEN'},403);
  if(request.method==='POST'&&request.headers.get('origin')!==config.origin)return response({code:'FORBIDDEN'},403);
  const source=config.mode==='synthetic'?'local-synthetic':'sites-dispatch';
  if(!identity||identity.subject!==config.ownerId||identity.source!==source)return response({code:'FORBIDDEN'},403);
  if(url.pathname==='/api/status'&&request.method==='GET')return response({mode:config.mode,storage:config.mode==='synthetic'?'ephemeral evaluation':'ciphertext',dotAccess:false});
  if(url.pathname==='/api/vault'&&request.method==='GET'){const row=await store.read(config.ownerId);return row?response(row):response({code:'NOT_FOUND'},404);}
  if(request.method!=='POST'||!['/api/vault/create','/api/vault/replace'].includes(url.pathname))return response({code:'NOT_FOUND'},404);
  let admission;try{admission=await limiter?.allow(config.ownerId);}catch{return response({code:'RATE_LIMIT_UNAVAILABLE'},503);}
  if(admission===false)return response({code:'RATE_LIMITED'},429);
  if(admission!==true)return response({code:'RATE_LIMIT_UNAVAILABLE'},503);
  const input=await boundedBody(request);exact(input,['expectedRevision','operationId','envelope']);let result;
  if(url.pathname.endsWith('/create')){if(input.expectedRevision!==0)fail('CONFLICT');result=await store.create(config.ownerId,input.envelope,input.operationId);return response(result,201);}
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('CONFLICT');result=await store.replace(config.ownerId,input.envelope,input.expectedRevision,input.operationId);return response(result);
 }catch(error){
  const code=error instanceof VaultError?error.code:'REQUEST_FAILED';
  const status={CONFLICT:409,CONTENT_TYPE:415,BODY_TOO_LARGE:413,RATE_LIMITED:429}[code]??(code==='REQUEST_FAILED'?500:400);
  return response({code},status);
 }
}
