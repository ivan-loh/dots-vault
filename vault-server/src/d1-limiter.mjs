import {fail} from './codec.mjs';
// One atomic statement shared by isolates. Fixed UTC minute, not sliding window.
const SQL=`INSERT INTO mutation_limits (owner_id, window, count) VALUES (?, ?, 1)
ON CONFLICT(owner_id) DO UPDATE SET
 count = CASE WHEN excluded.window > mutation_limits.window THEN 1 ELSE min(mutation_limits.count + 1, 31) END,
 window = max(mutation_limits.window, excluded.window)
RETURNING window, count`;
export class D1MutationLimiter{
 constructor(database,clock=()=>Date.now()){this.db=database;this.clock=clock;}
 async allow(owner){
  if(typeof owner!=='string'||!owner.length||owner.length>256)fail();
  const now=this.clock();if(!Number.isSafeInteger(now)||now<0)fail();
  const window=Math.floor(now/60000),row=await this.db.prepare(SQL).bind(owner,window).first();
  if(!row||!Number.isSafeInteger(row.window)||row.window<window||!Number.isSafeInteger(row.count)||row.count<1||row.count>31)fail('RATE_LIMIT_UNAVAILABLE');
  return row.count<=30;
 }
}
