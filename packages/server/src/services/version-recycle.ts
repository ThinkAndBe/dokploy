import {changeVersionInput} from './version-api';
import {versionBlockReason} from './version-recycle-policy';
import {buildSchema,sql} from './build-store';
import {codeProject} from './project-code';
import {repositoryPath} from './apphub-versions';
import {giteaToken} from './gitea-integration';
import {assertWrite} from './apphub-rbac';
import {requireInteractive} from './release-policy';
type Actor={id:string;organizationId:string;apiKey?:unknown};
let ready:Promise<void>|undefined;
export function recycleSchema(){return ready??=(async()=>{await buildSchema();await sql.begin(async q=>{
 await q`select pg_advisory_xact_lock(63001,5)`;
 await q`create table if not exists apphub_version_recycle(organization_id text not null,project_id text not null,name text not null,sha text not null,deleted_by text not null,deleted_at timestamptz not null default now(),primary key(organization_id,project_id,name))`;
 await q`create table if not exists apphub_version_event(id bigserial primary key,organization_id text not null,project_id text not null,name text not null,sha text not null,actor text not null,action text not null,created_at timestamptz not null default now())`;
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
export async function listRecycled(a:Actor,pid:string){await repository(a,pid);await recycleSchema();return (await sql`select name,sha,deleted_at from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${pid} order by deleted_at desc limit 200`).map(r=>({name:String(r.name),sha:String(r.sha),deletedAt:String(r.deleted_at)}));}
export async function changeRecycled(a:Actor,input:{projectId:string;name:string;commit:string;action:'delete'|'restore'}){
 input=changeVersionInput.parse(input); requireInteractive(a.apiKey);await assertWrite(a);const base=await repository(a,input.projectId);await recycleSchema();
 const tag=await get(base,'/tags/'+encodeURIComponent(input.name));if(tag.commit?.sha!==input.commit)throw new Error('版本记录已经变化，请刷新核对后重试');
 const repo=await get(base,'');const branch=await get(base,'/branches/'+encodeURIComponent(String(repo.default_branch||'main')));const head=String(branch.commit?.id||branch.commit?.sha||'');if(!/^[a-f0-9]{40}$/.test(head))throw new Error('无法核验最新代码，未删除版本');
 return sql.begin(async q=>{await q`select pg_advisory_xact_lock(hashtext(${input.projectId}),63001)`;
  if(input.action==='delete'){
   const reason=await references(q,a,input.projectId,input.commit,head);if(reason)throw new Error(reason+'，不能删除');
   await q`insert into apphub_version_recycle(organization_id,project_id,name,sha,deleted_by) values(${a.organizationId},${input.projectId},${input.name},${input.commit},${a.id}) on conflict(organization_id,project_id,name) do nothing`;
  }else{const rows=await q`delete from apphub_version_recycle where organization_id=${a.organizationId} and project_id=${input.projectId} and name=${input.name} and sha=${input.commit} returning name`;if(!rows.length)throw new Error('此版本不在回收站，请刷新版本记录');}
  await q`insert into apphub_version_event(organization_id,project_id,name,sha,actor,action) values(${a.organizationId},${input.projectId},${input.name},${input.commit},${a.id},${input.action})`;
  return {ok:true};
 });
}
