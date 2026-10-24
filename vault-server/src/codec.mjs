export const FORMAT='dots-vault';
export const SUITE='argon2id13-xchacha20poly1305-v1';
export const LIMITS=Object.freeze({envelope:1048576,item:16384,records:100,tombstones:1000,revision:2147483647});
export class VaultError extends Error { constructor(code='INVALID_DATA'){super(code);this.name='VaultError';this.code=code;} }
export const fail=(code='INVALID_DATA')=>{throw new VaultError(code);};
export const utf8=value=>new TextEncoder().encode(value);
export function validString(value,max=1048576){
 if(typeof value!=='string'||value.length>max)fail();
 for(const c of value){const n=c.codePointAt(0);if(n>=0xd800&&n<=0xdfff)fail();}
 return value;
}
export function encode(value){
 function visit(v,depth=0){
  if(depth>20)fail();
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='string')return validString(v);
  if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))fail();return v;}
  if(Array.isArray(v))return v.map(x=>visit(x,depth+1));
  if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();
  const out=Object.create(null);
  for(const key of Object.keys(v).sort()){if(['__proto__','prototype','constructor'].includes(key))fail();validString(key);out[key]=visit(v[key],depth+1);}
  return out;
 }
 return JSON.stringify(visit(value));
}
export function parseCanonical(input,max=LIMITS.envelope){
 try{
  const bytes=typeof input==='string'?utf8(validString(input)):input;
  if(!(bytes instanceof Uint8Array)||bytes.length>max)fail('LIMIT_EXCEEDED');
  if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)fail();
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const value=JSON.parse(text);if(encode(value)!==text)fail();return value;
 }catch(e){if(e instanceof VaultError)throw e;fail();}
}
export function exact(value,fields){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
 if(Object.keys(value).sort().join('|')!==[...fields].sort().join('|'))fail();
 return value;
}
export function b64(bytes){if(!(bytes instanceof Uint8Array))fail();let s='';for(const n of bytes)s+=String.fromCharCode(n);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function unb64(value,length=null,max=LIMITS.envelope){
 if(typeof value!=='string'||value.length>max*2||!value.length||!/^[A-Za-z0-9_-]+$/.test(value))fail();
 try{const bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));if(bytes.length>max||(length!==null&&bytes.length!==length)||b64(bytes)!==value)fail();return bytes;}catch{fail();}
}
export function id(value){if(typeof value!=='string'||!/^[0-9a-f]{32}$/.test(value))fail();return value;}
export function positive(value,max=LIMITS.revision){if(!Number.isSafeInteger(value)||value<1||value>max)fail();return value;}
export function validateKdf(k){exact(k,['algorithm','salt','ops','memory']);if(k.algorithm!=='argon2id13'||k.ops!==3||k.memory!==67108864)fail('UNSUPPORTED_PROFILE');unb64(k.salt,16);return k;}
export function validatePassword(value,isNew=false){validString(value,1024);if(!value.length||utf8(value).length>1024||(isNew&&[...value].length<16))fail('PASSWORD_REQUIREMENTS');return value;}
export function validateItem(item){
 if(item?.type==='contact'){
  exact(item,['type','name','organization','emails','phones','addresses','notes']);
  for(const field of ['name','organization','notes'])validString(item[field],16384);
  if([...item.name].length<1||[...item.name].length>120||[...item.organization].length>200||utf8(item.notes).length>8192)fail('LIMIT_EXCEEDED');
  for(const [field,max]of [['emails',320],['phones',64],['addresses',1000]]){
   if(!Array.isArray(item[field])||item[field].length>10)fail('LIMIT_EXCEEDED');
   for(const value of item[field]){validString(value,2048);if(!value.length||[...value].length>max)fail('LIMIT_EXCEEDED');if(field==='emails'&&!/^[^@\s]+@[^@\s]+$/u.test(value))fail();}
  }
  if(utf8(encode(item)).length>LIMITS.item)fail('LIMIT_EXCEEDED');return item;
 }
 exact(item,['type','title','username','password','url','notes']);
 for(const field of ['type','title','username','password','url','notes'])validString(item[field],16384);
 if(!['login','note'].includes(item.type)||[...item.title].length<1||[...item.title].length>120||[...item.username].length>320||utf8(item.password).length>4096||[...item.url].length>2048||utf8(item.notes).length>8192||utf8(encode(item)).length>LIMITS.item)fail('LIMIT_EXCEEDED');
 if(item.type==='note'&&(item.username||item.password||item.url))fail();
 if(item.url){let u;try{u=new URL(item.url);}catch{fail();}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail();}
 return item;
}
function encrypted(value,max){exact(value,['nonce','ciphertext']);unb64(value.nonce,24);const ct=unb64(value.ciphertext,null,max);if(ct.length<16)fail();}
export function validateEnvelope(e){
 exact(e,['format','version','suite','vaultId','revision','master','passwordWrap','recoveryWrap','manifest','records']);
 if(e.format!==FORMAT||e.version!==1||e.suite!==SUITE)fail('UNSUPPORTED_FORMAT');
 id(e.vaultId);positive(e.revision);exact(e.master,['id','generation']);id(e.master.id);positive(e.master.generation,e.revision);
 for(const [kind,w]of [['password',e.passwordWrap],['recovery',e.recoveryWrap]]){
  if(kind==='recovery'&&w===null)continue;
  exact(w,kind==='password'?['id','kind','createdRevision','kdf','nonce','ciphertext']:['id','kind','createdRevision','nonce','ciphertext']);
  id(w.id);if(w.kind!==kind)fail();positive(w.createdRevision,e.revision);unb64(w.nonce,24);unb64(w.ciphertext,48);if(kind==='password')validateKdf(w.kdf);
 }
 if(e.recoveryWrap&&e.recoveryWrap.id===e.passwordWrap.id)fail();
 encrypted(e.manifest,131072);
 if(!Array.isArray(e.records)||e.records.length>LIMITS.records)fail('LIMIT_EXCEEDED');
 const seen=new Set();for(const r of e.records){exact(r,['id','revision','keyWrap','data']);id(r.id);if(seen.has(r.id))fail();seen.add(r.id);positive(r.revision,e.revision);encrypted(r.keyWrap,48);unb64(r.keyWrap.ciphertext,48);encrypted(r.data,LIMITS.item+16);}
 if(utf8(encode(e)).length>LIMITS.envelope)fail('LIMIT_EXCEEDED');return e;
}
export const parseEnvelope=input=>validateEnvelope(parseCanonical(input));
