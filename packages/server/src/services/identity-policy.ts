import {createHmac,randomUUID} from 'node:crypto';
export function apiSignature(path:string,body:string,key:string,secret:string,stamp=String(Math.floor(Date.now()/1000)),nonce=randomUUID()){
 const signature=createHmac('sha256',`appId=${key}&appSecret=${secret}&timestamp=${stamp}&nonce=${nonce}`).update(path+(body?(path.includes('?')?'&':'?')+body:'')).digest('hex');
 return {'X-Ca-Key':key,'X-Ca-TimeStamp':stamp,'X-Ca-Nonce':nonce,'X-Ca-Sign':signature,'Content-Type':'application/json'};
}
const value=(v:unknown,max=1000)=>typeof v==='string'?v.trim().slice(0,max):'';
export function directoryUser(r:any){
 if(!r||!value(r.id)||!value(r.name))throw new Error('目录用户缺少稳定 ID 或用户名，同步未应用');
 const path=value(r.groupPath)||'/',expired=Number(r.expiredTime)||0;
 return {id:value(r.id,200),username:value(r.name,200),employee_number:value(r.name,200),display_name:value(r.displayName,200)||value(r.name,200),email:value(r.email,320),group_path:path,department:path.split('/').filter(Boolean).at(-1)||'',external_id:value(r.externalId,200),enabled:String(r.status)==='1'&&String(r.isDeleted??0)==='0'&&(!expired||expired>Date.now()),expires_at:expired>0?new Date(expired).toISOString():null};
}
export function directoryGroup(r:any){if(!r||!value(r.id)||!value(r.name))throw new Error('组织架构缺少 ID 或名称');return {id:value(r.id,200),name:value(r.name,200),parent_path:value(r.path)||'/',path:((value(r.path)||'/').replace(/\/$/,'')+'/'+value(r.name)).replace(/\/+/g,'/'),deleted:String(r.isDeleted??0)!=='0'};}
export function assertSnapshot(rows:{id:string}[],total:number){if(!Number.isSafeInteger(total)||total<0||total!==rows.length||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('目录分页不完整或含重复 ID，保留上次完整同步');}
export function canUseIdentity(r:any,now=Date.now()){return !!r&&r.source_enabled&&r.access_enabled&&!r.missing&&(!r.expires_at||new Date(r.expires_at).getTime()>now);}
export function fixedCallback(origin:string,configured?:string){const base=new URL(origin);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new Error('平台地址无效');const expected=base.origin+'/api/auth/atrust/callback';if(configured&&configured!==expected)throw new Error('零信任回调必须与平台地址一致');return expected;}

export function ssoEndpoints(savedServer:string,browserServer?:string,apiServer?:string){return {ssoServer:(browserServer||savedServer).replace(/\/+$/,''),apiServer:(apiServer||savedServer).replace(/\/+$/,'')};}
