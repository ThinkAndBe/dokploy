import {withVersionLock} from './version-governance';
import {changeVersionInput} from './version-api';
import {versionBlockReason,canManageVersions} from './version-recycle-policy';
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
 });})().catch(e=>{ready=undefined;throw e;});}
export async function recycledNames(org:string,pid:string){await recycleSchema();return new Set((await sql`select name from apphub_version_recycle where organization_id=${org} and project_id=${pid}`).map(r=>String(r.name)));}
async function repository(a:Actor,pid:string){const p=await codeProject({...a,name:'AppHub',email:'version@apphub.invalid'},pid);return repositoryPath(pid,p.giteaRepoUrl!);}
async function get(base:string,route:string){const r=await fetch(base+route,{headers:{Authorization:`token ${giteaToken()}`},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('版本引用核验暂时不可用，请刷新后重试');return r.json();}
async function references(q:any,a:Actor,pid:string,sha:string,head:string){
 const [r]=await q`select
 exists(select 1 from apphub_build_job where organization_id=${a.organizationId} and project_id=${pid} and commit_sha=${sha} and status in ('queued','building','built','deploying')) as active,
 exists(select 1 from apphub_build_job j join apphub_build_project bp on bp.project_id=j.project_id where j.organization_id=${a.organizationId} and j.project_id=${pid} and j.commit_sha=${sha} and (j.id=(select id from apphub_build_job where project_id=${pid} and status='ready' order by created_at desc limit 1) or j.id=(select j2.id from apphub_build_job j2 join apphub_release_plan rp on rp.id=j2.plan_id::text where j2.project_id=${pid} and rp.service_id=bp.service_id and rp.status='deployed' order by rp.created_at desc limit 1))) as current,
 exists(select 1 from apphub_build_job j join apphub_release_plan p on (p.payload->'input'->>'testedPlanId'=j.plan_id::text or p.payload->'input'->'configuration'->>'image'=j.image) where j.organization_id=${a.organizationId} and j.project_id=${pid} and j.commit_sha=${sha} and p.organization_id=${a.organizationId} and p.tier='formal' and p.status not in ('failed','cancelled','rejected')) as formal,
 exists(select 1 from apphub_build_job j join apphub_publish_request r on r.tested_plan_id=j.plan_id::text where j.organization_id=${a.organizationId} and j.project_id=${pid} and j.commit_sha=${sha} and r.organization_id=${a.organizationId} and r.status in ('pending','processing')) as request`;
 return versionBlockReason({head:sha===head,active:!!r?.active,current:!!r?.current,formal:!!r?.formal,request:!!r?.request});
}
async function manager(q:any,a:Actor,pid:string){
 const [m]=await q`select m.role,r.role as apphub_role,m."accesedProjects" from member m left join apphub_user_role r on r.organization_id=m.organization_id and r.user_id=m.user_id where m.user_id=${a.id} and m.organization_id=${a.organizationId}`;
 const [project]=await q`select "projectId" from project where "projectId"=${pid} and "organizationId"=${a.organizationId}`;
 const [owner]=await q`select user_id from apphub_project_owner where project_id=${pid} and organization_id=${a.organizationId}`;
 const role=m&&['owner','admin'].includes(m.role)?'admin':m?.apphub_role==='viewer'?'viewer':'developer';
 return !!project&&!!m&&(['owner','admin'].includes(m.role)||m.accesedProjects.includes(pid))&&canManageVersions(role,a.id,owner?.user_id);
}
export async function versionManagement(a:Actor,pid:string){
 await repository(a,pid);await memberRole(a);await recycleSchema();
 const rows=await sql`select name,sha,actor,reason,created_at from apphub_version_protection where organization_id=${a.organizationId} and project_id=${pid}`;
 const events=await sql`select name,sha,actor,action,reason,created_at from apphub_version_event where organization_id=${a.organizationId} and project_id=${pid} order by created_at desc,id desc limit 50`;
 const names=await userNames(a.organizationId,[...rows,...events].map(v=>String(v.actor)));
 const present=(v:any)=>({name:String(v.name),sha:String(v.sha),actor:names.get(String(v.actor))||'未提供姓名',reason:String(v.reason||''),date:new Date(v.created_at).toISOString()});
 return {canManage:await manager(sql,a,pid),protected:rows.map(present),events:events.map(v=>({...present(v),action:String(v.action)}))};
}
export async function listRecycled(a:Actor,pid:string){
 await repository(a,pid);await recycleSchema();const rows=await sql`select name,sha,deleted_at,deleted_by,reason from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${pid} order by deleted_at desc limit 200`;
 const names=await userNames(a.organizationId,rows.map(v=>String(v.deleted_by)));
 return rows.map(r=>({name:String(r.name),sha:String(r.sha),deletedAt:new Date(r.deleted_at).toISOString(),deletedBy:names.get(String(r.deleted_by))||'未提供姓名',reason:String(r.reason||'历史操作未填写原因')}));
}
export async function changeRecycled(a:Actor,input:z.infer<typeof changeVersionInput>){
 input=changeVersionInput.parse(input);requireInteractive(a.apiKey);await assertWrite(a);const base=await repository(a,input.projectId);await recycleSchema();
 if(!await manager(sql,a,input.projectId))throw new Error('只有项目负责人或管理员可以删除、恢复和保护版本');
 return withVersionLock(input.projectId,()=>changeRecycledLocked(a,input,base));
}
async function changeRecycledLocked(a:Actor,input:z.infer<typeof changeVersionInput>,base:string){
 const tag=await get(base,'/tags/'+encodeURIComponent(input.name));if(tag.commit?.sha!==input.commit)throw new Error('版本记录已经变化，请刷新核对后重试');
 const repo=await get(base,'');const branch=await get(base,'/branches/'+encodeURIComponent(String(repo.default_branch||'main')));const head=String(branch.commit?.id||branch.commit?.sha||'');if(!/^[a-f0-9]{40}$/.test(head))throw new Error('无法核验最新代码，未修改版本');
 return sql.begin(async q=>{
  // Match project transfer locking so rights are rechecked after any ownership change.
  await q`select pg_advisory_xact_lock(hashtext(${input.projectId}))`;
  await q`select pg_advisory_xact_lock(hashtext(${input.projectId}),63001)`;
  if(!await manager(q,a,input.projectId))throw new Error('项目权限已经变化，请刷新后重试');
  if(input.action==='delete'){
   const [protectedVersion]=await q`select name from apphub_version_protection where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name}`;
   if(protectedVersion)throw new Error('该版本已标记保护，请先核对并解除保护');
   const reason=await references(q,a,input.projectId,input.commit,head);if(reason)throw new Error(reason+'，不能删除');
   const rows=await q`insert into apphub_version_recycle(organization_id,project_id,name,sha,deleted_by,reason) values(${a.organizationId},${input.projectId},${input.name},${input.commit},${a.id},${input.reason}) on conflict(organization_id,project_id,name) do nothing returning name`;
   if(!rows.length)return {ok:true};
  }else if(input.action==='restore'){
   const rows=await q`delete from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name} and sha=${input.commit} returning name`;if(!rows.length)throw new Error('此版本不在回收站，请刷新版本记录');
  }else if(input.action==='protect'){
   const [removed]=await q`select name from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name}`;if(removed)throw new Error('请先恢复该版本，再标记保护');
   const rows=await q`insert into apphub_version_protection(organization_id,project_id,name,sha,actor,reason) values(${a.organizationId},${input.projectId},${input.name},${input.commit},${a.id},${input.reason}) on conflict do nothing returning name`;if(!rows.length)return {ok:true};
  }else{
   const rows=await q`delete from apphub_version_protection where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name} and sha=${input.commit} returning name`;if(!rows.length)throw new Error('此版本未标记保护，请刷新记录');
  }
  await q`insert into apphub_version_event(organization_id,project_id,name,sha,actor,action,reason) values(${a.organizationId},${input.projectId},${input.name},${input.commit},${a.id},${input.action},${input.reason})`;
  return {ok:true};
 });
}
