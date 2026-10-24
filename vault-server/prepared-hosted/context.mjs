// Preparation module, not imported by the exported production entry.
import {SqlStore} from '../src/store.mjs';
import {D1MutationLimiter} from '../src/d1-limiter.mjs';
export async function prepareOwnerContext(request,{config,getIdentity,getDatabase}={}){
 try{
  if(config?.ownerVerified!==true||config.dispatchVerified!==true||typeof config.ownerId!=='string'||!config.ownerId.length||config.ownerId.length>256)return null;
  const origin=new URL(config.origin),url=new URL(request.url);
  if(origin.protocol!=='https:'||origin.origin!==config.origin||url.origin!==config.origin||request.headers.get('host')!==origin.host||request.method==='POST'&&request.headers.get('origin')!==config.origin)return null;
  const identity=await getIdentity();if(identity?.userId!==config.ownerId)return null;
  // Raw D1, not a Drizzle ORM. No replica/session API is used in this version.
  const db=await getDatabase();if(typeof db?.prepare!=='function')return null;
  return {config:{mode:'production',ownerId:config.ownerId,origin:config.origin,ownerVerified:true,dispatchVerified:true},identity:{subject:identity.userId,source:'sites-dispatch'},store:new SqlStore(db),limiter:new D1MutationLimiter(db)};
 }catch{return null;}
}
