import {retentionSchema,retentionPolicy,retentionCatalog,retentionStates} from './version-retention';
import {retentionPolicyInput} from './version-retention-policy';
import {withVersionLock} from './version-governance';
import {changeVersionInput} from './version-api';
import {canManageVersions} from './version-recycle-policy';
import {buildSchema,sql} from './build-store';
import {codeProject} from './project-code';
import {repositoryPath} from './apphub-versions';
import {giteaToken} from './gitea-integration';
import {assertWrite,memberRole} from './apphub-rbac';
import {requireInteractive} from './release-policy';
import {userNames} from './user-names';
import type {z} from 'zod';
type Actor={id:string;organizationId:string;apiKey?:unknown};
let ready:Promise<void>|undefined;
export function recycleSchema(){return ready??=(async()=>{await buildSchema();await sql.begin(async q=>{
 await q`select pg_advisory_xact_lock(63001,5)`;
 await q`create table if not exists apphub_version_recycle(organization_id text not null,project_id text not null,name text not null,sha text not null,deleted_by text not null,deleted_at timestamptz not null default now(),primary key(organization_id,project_id,name))`;
 await q`create table if not exists apphub_version_event(id bigserial primary key,organization_id text not null,project_id text not null,name text not null,sha text not null,actor text not null,action text not null,created_at timestamptz not null default now())`;
 await q`alter table apphub_version_recycle add column if not exists reason text not null default ''`;
 await q`alter table apphub_version_event add column if not exists reason text not null default ''`;
 await q`create table if not exists apphub_version_protection(organization_id text not null,project_id text not null,name text not null,sha text not null,actor text not null,reason text not null,created_at timestamptz not null default now(),primary key(organization_id,project_id,name))`;
 await retentionSchema(q);
 });})().catch(e=>{ready=undefined;throw e;});}
export async function recycledNames(org:string,pid:string){await recycleSchema();return new Set((await sql`select name from apphub_version_recycle where organization_id=${org} and project_id=${pid}`).map(r=>String(r.name)));}
async function repository(a:Actor,pid:string){const p=await codeProject({...a,name:'AppHub',email:'version@apphub.invalid'},pid);return repositoryPath(pid,p.giteaRepoUrl!);}
async function get(base:string,route:string){const r=await fetch(base+route,{headers:{Authorization:`token ${giteaToken()}`},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('版本引用核验暂时不可用，请刷新后重试');return r.json();}
async function manager(q:any,a:Actor,pid:string){
 const [m]=await q`select m.role,r.role as apphub_role,m."accesedProjects" from member m left join apphub_user_role r on r.organization_id=m.organization_id and r.user_id=m.user_id where m.user_id=${a.id} and m.organization_id=${a.organizationId}`;
 const [project]=await q`select "projectId" from project where "projectId"=${pid} and "organizationId"=${a.organizationId}`;
 const [owner]=await q`select user_id from apphub_project_owner where project_id=${pid} and organization_id=${a.organizationId}`;
 const role=m&&['owner','admin'].includes(m.role)?'admin':m?.apphub_role==='viewer'?'viewer':'developer';
 return !!project&&!!m&&(['owner','admin'].includes(m.role)||m.accesedProjects.includes(pid))&&canManageVersions(role,a.id,owner?.user_id);
}
export async function versionManagement(a:Actor,pid:string){
 const base=await repository(a,pid);const member=await memberRole(a);await recycleSchema();
 const rows=await sql`select name,sha,actor,reason,created_at,expires_at from apphub_version_protection where organization_id=${a.organizationId} and project_id=${pid}`;
 const events=await sql`select name,sha,actor,action,reason,created_at from apphub_version_event where organization_id=${a.organizationId} and project_id=${pid} order by created_at desc,id desc limit 50`;
 const names=await userNames(a.organizationId,[...rows,...events].map(v=>String(v.actor)));
 const present=(v:any)=>({name:String(v.name),sha:String(v.sha),actor:names.get(String(v.actor))||'未提供姓名',reason:String(v.reason||''),date:new Date(v.created_at).toISOString()});
 const catalog=await retentionCatalog(base);
 const states=await retentionStates(sql,a.organizationId,pid,catalog);
 const policy=await retentionPolicy(a.organizationId);
 const policyEvents=member.effectiveRole==='admin'?await sql`select actor,policy,reason,created_at from apphub_version_policy_event where organization_id=${a.organizationId} order by id desc limit 20`:[];
 const policyActors=await userNames(a.organizationId,policyEvents.map(e=>String(e.actor)));
 return {canManage:await manager(sql,a,pid),isAdmin:member.effectiveRole==='admin',...policy,states,policyEvents:policyEvents.map(e=>({actor:policyActors.get(String(e.actor))||'未提供姓名',policy:e.policy,reason:String(e.reason),date:new Date(e.created_at).toISOString()})),protected:rows.map(v=>({...present(v),until:new Date(v.expires_at).toISOString()})),events:events.map(v=>({...present(v),action:String(v.action)}))};
}
export async function listRecycled(a:Actor,pid:string){
 await repository(a,pid);await recycleSchema();const rows=await sql`select name,sha,deleted_at,deleted_by,reason from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${pid} order by deleted_at desc limit 200`;
 const names=await userNames(a.organizationId,rows.map(v=>String(v.deleted_by)));
 return rows.map(r=>({name:String(r.name),sha:String(r.sha),deletedAt:new Date(r.deleted_at).toISOString(),deletedBy:names.get(String(r.deleted_by))||'未提供姓名',reason:String(r.reason||'历史操作未填写原因')}));
}
export async function changeRecycled(a:Actor,input:z.infer<typeof changeVersionInput>){
 input=changeVersionInput.parse(input);requireInteractive(a.apiKey);await assertWrite(a);const base=await repository(a,input.projectId);await recycleSchema();
 if(!await manager(sql,a,input.projectId))throw new Error('只有项目负责人或管理员可以删除和恢复版本');
 return withVersionLock(input.projectId,()=>changeRecycledLocked(a,input,base));
}
async function changeRecycledLocked(a:Actor,input:z.infer<typeof changeVersionInput>,base:string){
 const tag=await get(base,'/tags/'+encodeURIComponent(input.name));if(tag.commit?.sha!==input.commit)throw new Error('版本记录已经变化，请刷新核对后重试');
 const catalog=await retentionCatalog(base);
 return sql.begin(async q=>{
  // Match project transfer locking so rights are rechecked after any ownership change.
  await q`select pg_advisory_xact_lock(hashtext(${input.projectId}))`;
  await q`select pg_advisory_xact_lock(hashtext(${input.projectId}),63001)`;
  await q`select pg_advisory_xact_lock(hashtext(${a.organizationId}),63010)`;
  if(!await manager(q,a,input.projectId))throw new Error('项目权限已经变化，请刷新后重试');
  if(input.action==='delete'){
   const states=await retentionStates(q,a.organizationId,input.projectId,catalog);
   const state=states.find(v=>v.name===input.name&&v.sha===input.commit);
   const [alreadyRemoved]=await q`select name from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name} and sha=${input.commit}`;
   if(alreadyRemoved)return {ok:true};
   if(!state||!state.canDelete)throw new Error((state?.reason||'版本保留状态无法确认')+'，不能删除');
   const rows=await q`insert into apphub_version_recycle(organization_id,project_id,name,sha,deleted_by,reason) values(${a.organizationId},${input.projectId},${input.name},${input.commit},${a.id},${input.reason}) on conflict(organization_id,project_id,name) do nothing returning name`;
   if(!rows.length)return {ok:true};
  }else if(input.action==='restore'){
   const rows=await q`delete from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name} and sha=${input.commit} returning name`;if(!rows.length)throw new Error('此版本不在回收站，请刷新版本记录');
  }else if(input.action==='protect'){
   await administrator(q,a);
   if(!input.holdDays)throw new Error('请选择明确的保留天数（1至365天）');
   const [removed]=await q`select name from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name}`;if(removed)throw new Error('请先恢复该版本，再标记保护');
   const rows=await q`insert into apphub_version_protection(organization_id,project_id,name,sha,actor,reason,expires_at) values(${a.organizationId},${input.projectId},${input.name},${input.commit},${a.id},${input.reason},${new Date(Date.now()+input.holdDays*86400000)}) on conflict(organization_id,project_id,name) do update set reason=excluded.reason,actor=excluded.actor,expires_at=excluded.expires_at returning name`;if(!rows.length)return {ok:true};
  }else{
   await administrator(q,a);
   const rows=await q`delete from apphub_version_protection where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name} and sha=${input.commit} returning name`;if(!rows.length)throw new Error('此版本未标记保护，请刷新记录');
  }
  await q`insert into apphub_version_event(organization_id,project_id,name,sha,actor,action,reason) values(${a.organizationId},${input.projectId},${input.name},${input.commit},${a.id},${input.action},${input.reason})`;
  return {ok:true};
 });
}

async function administrator(q:any,a:Actor){const [m]=await q`select m.role,u.banned from member m join "user" u on u.id=m.user_id where m.user_id=${a.id} and m.organization_id=${a.organizationId}`;if(!m||m.banned||!['owner','admin'].includes(m.role))throw new Error('仅管理员可调整统一保留规则和延长保留');}
export async function saveRetentionPolicy(a:Actor,input:{policy:z.infer<typeof retentionPolicyInput>;revision:number;reason:string}){
 requireInteractive(a.apiKey);await memberRole(a);await recycleSchema();const policy=retentionPolicyInput.parse(input.policy);
 return sql.begin(async q=>{
  await q`select pg_advisory_xact_lock(hashtext(${a.organizationId}),63010)`;await administrator(q,a);
  const previous=await retentionPolicy(a.organizationId,q);if(previous.revision!==input.revision)throw new Error('保留规则已被其他管理员修改，请刷新后重试');
  await q`insert into apphub_version_retention(organization_id,policy,revision,actor) values(${a.organizationId},${q.json(policy)},1,${a.id}) on conflict(organization_id) do update set policy=excluded.policy,revision=apphub_version_retention.revision+1,actor=excluded.actor,updated_at=now()`;
  await q`insert into apphub_version_policy_event(organization_id,actor,previous,policy,reason) values(${a.organizationId},${a.id},${q.json(previous.policy)},${q.json(policy)},${input.reason})`;
  return {ok:true};
 });
}

export async function recordVersionDeployment(a:Actor,input:{projectId:string;name:string;commit:string;service:string;image:string;reason:string}){
 requireInteractive(a.apiKey);await memberRole(a);await recycleSchema();await administrator(sql,a);
 const base=await repository(a,input.projectId);const tag=await get(base,'/tags/'+encodeURIComponent(input.name));if(tag.commit?.sha!==input.commit)throw new Error('版本代码不匹配');
 const {docker}=await import('../constants');
 return withVersionLock(input.projectId,()=>sql.begin(async q=>{
  await q`select pg_advisory_xact_lock(hashtext(${input.projectId}),63001)`;await administrator(q,a);
  const info=await docker.getService(input.service).inspect();
  if(info.Spec.TaskTemplate.ContainerSpec.Image!==input.image||info.UpdateStatus&&info.UpdateStatus.State!=='completed')throw new Error('实际运行镜像不匹配或服务更新尚未完成');
  const [other]=await q`select project_id from apphub_version_deployment where service_id=${info.ID} and (project_id<>${input.projectId} or organization_id<>${a.organizationId}) limit 1`;if(other)throw new Error('服务已关联其他项目');
  const [previous]=await q`select * from apphub_version_deployment where service_id=${info.ID} and project_id=${input.projectId} and organization_id=${a.organizationId} order by id desc limit 1`;
  if(previous?.sha===input.commit&&previous?.image===input.image)return {ok:true};
  const [removed]=await q`select name from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name}`;if(removed)throw new Error('请先恢复部署版本');
  await q`insert into apphub_version_deployment(organization_id,project_id,service_id,sha,image,actor,reason) values(${a.organizationId},${input.projectId},${info.ID},${input.commit},${input.image},${a.id},${input.reason})`;
  await q`insert into apphub_version_event(organization_id,project_id,name,sha,actor,action,reason) values(${a.organizationId},${input.projectId},${input.name},${input.commit},${a.id},'deployment',${input.reason})`;
  return {ok:true};
 }));
}
