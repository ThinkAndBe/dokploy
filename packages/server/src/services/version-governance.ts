import postgres from 'postgres';
import {dbUrl} from '../db/constants';
const state=globalThis as unknown as {apphubVersionLocks?:ReturnType<typeof postgres>};
// Keep lock waiters separate from the pool used to read project permissions and history.
export const versionLocks=state.apphubVersionLocks??=postgres(dbUrl,{max:2});
import {giteaToken} from './gitea-integration';
import {versionAdvice,assertNextVersion} from './version-number-policy';
export function withVersionLock<T>(projectId:string,fn:()=>Promise<T>):Promise<T>{return versionLocks.begin(async q=>{await q`select pg_advisory_xact_lock(hashtext(${projectId}),63009)`;return fn();}) as Promise<T>;}
export async function allVersionNames(base:string,organizationId?:string,projectId?:string){
 const names:string[]=[];
 for(let page=1;page<=100;page++){
  const r=await fetch(`${base}/tags?limit=100&page=${page}`,{headers:{Authorization:`token ${giteaToken()}`},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(r.status===409)break;if(!r.ok)throw new Error('无法核对完整版本历史，请稍后重试');const rows=await r.json();if(!Array.isArray(rows))throw new Error('版本历史响应无效');names.push(...rows.map(t=>String(t.name)));if(rows.length<100)break;if(page===100)throw new Error('版本记录过多，请管理员核查');
 }
 if(organizationId&&projectId)names.push(...await (await import('./version-recycle')).recycledNames(organizationId,projectId));
 return names;
}
export async function enforceVersion(base:string,name:string,organizationId?:string,projectId?:string){const names=await allVersionNames(base,organizationId,projectId);if(names.includes(name))throw new Error('版本号已使用或已进入回收站，不可重复使用');assertNextVersion(name,names);}
export async function nextVersion(base:string,organizationId?:string,projectId?:string){return versionAdvice(await allVersionNames(base,organizationId,projectId));}
