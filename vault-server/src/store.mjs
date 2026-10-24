import {encode,parseEnvelope,validateEnvelope,LIMITS,fail} from './codec.mjs';
import {digest} from './server-digest.mjs';
function ownerId(owner){if(typeof owner!=='string'||!owner.length||owner.length>256)fail();}
async function payload(owner,envelope,expected,operationId){
 ownerId(owner);validateEnvelope(envelope);
 if(!Number.isSafeInteger(expected)||expected<0||expected>=LIMITS.revision||envelope.revision!==expected+1)fail('CONFLICT');
 const match=/^([0-9a-f]{32}):(0|[1-9][0-9]{0,9}):([0-9a-f]{32})$/.exec(operationId);
 if(!match||match[1]!==envelope.vaultId||Number(match[2])!==expected)fail('INVALID_OPERATION');
 return {owner_id:owner,vault_id:envelope.vaultId,revision:envelope.revision,envelope:encode(envelope),last_operation_id:operationId,digest:await digest(envelope)};
}
const receipt=row=>({revision:row.revision,digest:row.digest,operationId:row.last_operation_id});
const exposed=row=>row?{envelope:parseEnvelope(row.envelope),...receipt(row)}:null;
function retry(row,next){if(row?.last_operation_id===next.last_operation_id){if(row.digest!==next.digest||row.envelope!==next.envelope)fail('CONFLICT');return receipt(row);}return null;}
export class MemoryStore{
 #rows=new Map();
 async read(owner){ownerId(owner);return exposed(this.#rows.get(owner));}
 async create(owner,envelope,operationId){
  const next=await payload(owner,envelope,0,operationId),row=this.#rows.get(owner),prior=retry(row,next);if(prior)return prior;
  if(row||[...this.#rows.values()].some(r=>r.vault_id===next.vault_id))fail('CONFLICT');this.#rows.set(owner,next);return receipt(next);
 }
 async replace(owner,envelope,expected,operationId){
  if(expected<1)fail('CONFLICT');const next=await payload(owner,envelope,expected,operationId),row=this.#rows.get(owner),prior=retry(row,next);if(prior)return prior;
  if(!row||row.vault_id!==next.vault_id||row.revision!==expected)fail('CONFLICT');this.#rows.set(owner,next);return receipt(next);
 }
}
export class SqlStore{
 constructor(database){this.db=database;}
 async #row(owner){return this.db.prepare('SELECT * FROM vaults WHERE owner_id = ?').bind(owner).first();}
 async read(owner){ownerId(owner);return exposed(await this.#row(owner));}
 async create(owner,envelope,operationId){
  const n=await payload(owner,envelope,0,operationId),r=await this.db.prepare('INSERT OR IGNORE INTO vaults (owner_id,vault_id,revision,envelope,last_operation_id,digest) VALUES (?,?,?,?,?,?)').bind(n.owner_id,n.vault_id,n.revision,n.envelope,n.last_operation_id,n.digest).run();
  if(r.meta.changes===1)return receipt(n);const prior=retry(await this.#row(owner),n);if(prior)return prior;fail('CONFLICT');
 }
 async replace(owner,envelope,expected,operationId){
  if(expected<1)fail('CONFLICT');const n=await payload(owner,envelope,expected,operationId),prior=retry(await this.#row(owner),n);if(prior)return prior;
  const r=await this.db.prepare('UPDATE vaults SET revision = ?, envelope = ?, last_operation_id = ?, digest = ? WHERE owner_id = ? AND vault_id = ? AND revision = ?').bind(n.revision,n.envelope,n.last_operation_id,n.digest,owner,n.vault_id,expected).run();
  if(r.meta.changes===1)return receipt(n);const concurrent=retry(await this.#row(owner),n);if(concurrent)return concurrent;fail('CONFLICT');
 }
}
