import {sql} from './build-store';
import {giteaToken} from './gitea-integration';
import {defaultRetentionPolicy,retentionPolicyInput,versionEligibility,type VersionEntry,type DeploymentEntry} from './version-retention-policy';
export async function retentionSchema(q:any){
 await q`create table if not exists apphub_version_catalog(organization_id text not null,project_id text not null,name text not null,sha text not null,first_seen_at timestamptz not null default now(),primary key(organization_id,project_id,name))`;
 await q`create table if not exists apphub_version_retention(organization_id text primary key,policy jsonb not null,revision integer not null default 1,actor text not null,updated_at timestamptz not null default now())`;
 await q`create table if not exists apphub_version_policy_event(id bigserial primary key,organization_id text not null,actor text not null,previous jsonb not null,policy jsonb not null,reason text not null,created_at timestamptz not null default now())`;
 await q`alter table apphub_version_protection add column if not exists expires_at timestamptz`;
 // Old manual protections receive a bounded transition period, never silently disappear on upgrade.
 await q`update apphub_version_protection set expires_at=now()+interval '90 days' where expires_at is null`;
 await q`create table if not exists apphub_version_deployment(id bigserial primary key,organization_id text not null,project_id text not null,service_id text not null,sha text not null,image text not null,actor text not null,reason text not null,deployed_at timestamptz not null default now())`;
 await q`create index if not exists apphub_version_deployment_project on apphub_version_deployment(organization_id,project_id,deployed_at desc)`;
}
export async function retentionPolicy(org:string,q:any=sql){const [row]=await q`select * from apphub_version_retention where organization_id=${org}`;return {policy:row?retentionPolicyInput.parse(row.policy):defaultRetentionPolicy,revision:Number(row?.revision||0)};}
async function read(base:string,route:string){const r=await fetch(base+route,{headers:{Authorization:`token ${giteaToken()}`},redirect:'error',signal:AbortSignal.timeout(15000)});if(r.status===409)return [];if(!r.ok)throw new Error('无法核对完整版本历史，未允许删除');return r.json();}
export async function retentionCatalog(base:string){
 const tags:any[]=[];
 for(let page=1;page<=100;page++){const rows=await read(base,`/tags?limit=100&page=${page}`);if(!Array.isArray(rows))throw new Error('版本历史响应无效');tags.push(...rows);if(rows.length<100)break;if(page===100)throw new Error('版本记录过多，需管理员核查');}
 const versions:VersionEntry[]=[];
 // Resolve actual immutable commit times; fetch at most five missing dates concurrently.
 for(let i=0;i<tags.length;i+=5)await Promise.all(tags.slice(i,i+5).map(async t=>{
  const sha=String(t.commit?.sha||t.id||'');if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('历史版本代码引用无效');
  const c=t.commit?.created?null:await read(base,'/git/commits/'+sha);
  versions.push({name:String(t.name),sha,date:String(t.commit?.created||c?.committer?.date||c?.author?.date||'')});
 }));
 const repo=await read(base,'');const branch=await read(base,'/branches/'+encodeURIComponent(repo.default_branch||'main'));
 const head=String(branch.commit?.id||branch.commit?.sha||'');if(tags.length&&!/^[a-f0-9]{40}$/.test(head))throw new Error('无法核对最新代码');
 return {versions,head};
}
export async function retentionStates(q:any,org:string,pid:string,catalog:{versions:VersionEntry[];head:string}){
 const {policy}=await retentionPolicy(org,q);
 if(catalog.versions.length)await q`insert into apphub_version_catalog(organization_id,project_id,name,sha) select ${org},${pid},v.name,v.sha from jsonb_to_recordset(${q.json(catalog.versions.map(v=>({name:v.name,sha:v.sha})))}) as v(name text,sha text) on conflict do nothing`;
 const observed=await q`select name,sha,first_seen_at from apphub_version_catalog where organization_id=${org} and project_id=${pid}`;
 const observedByName=new Map<string,any>(observed.map((v:any)=>[String(v.name),v]));
 const versions=catalog.versions.map(v=>{const row=observedByName.get(v.name);if(!row||row.sha!==v.sha)throw new Error('版本代码引用发生变化，请管理员核查');return {...v,observedAt:new Date(row.first_seen_at).toISOString()};});
 const jobs=await q`select j.commit_sha,j.status,j.id,j.plan_id,j.image,j.created_at from apphub_build_job j where j.organization_id=${org} and j.project_id=${pid}`;
 const active=new Set<string>(jobs.filter((j:any)=>['queued','building','built','deploying'].includes(j.status)).map((j:any)=>String(j.commit_sha)));
 const testRows=await q`select j.commit_sha from apphub_build_job j join apphub_build_project bp on bp.project_id=j.project_id and bp.organization_id=j.organization_id where j.organization_id=${org} and j.project_id=${pid} and bp.service_id is not null and (j.id=(select id from apphub_build_job where project_id=${pid} and organization_id=${org} and status='ready' order by created_at desc limit 1) or j.id=(select j2.id from apphub_build_job j2 join apphub_release_plan rp on rp.id=j2.plan_id::text where j2.project_id=${pid} and j2.organization_id=${org} and rp.service_id=bp.service_id and rp.status='deployed' order by rp.created_at desc limit 1))`;
 const pendingRows=await q`select j.commit_sha from apphub_build_job j join apphub_publish_request r on r.tested_plan_id=j.plan_id::text where j.organization_id=${org} and j.project_id=${pid} and r.organization_id=${org} and r.status in ('pending','processing') and not exists(select 1 from apphub_release_plan done where done.organization_id=${org} and done.tier='formal' and done.status='deployed' and done.payload->'input'->>'testedPlanId'=r.tested_plan_id)`;
 const formal=await q`select distinct j.commit_sha,p.service_id,p.status,p.updated_at,p.id,j.image from apphub_build_job j join apphub_release_plan p on (p.payload->'input'->>'testedPlanId'=j.plan_id::text or p.payload->'input'->'configuration'->>'image'=j.image) where j.organization_id=${org} and j.project_id=${pid} and p.organization_id=${org} and p.tier='formal' and p.status not in ('failed','cancelled','rejected')`;
 const deployments:DeploymentEntry[]=formal.filter((p:any)=>p.status==='deployed').map((p:any)=>({sha:String(p.commit_sha),service:String(p.service_id),date:new Date(p.updated_at).toISOString(),image:String(p.image||'')}));
 const pending=new Set<string>([...pendingRows.map((p:any)=>String(p.commit_sha)),...formal.filter((p:any)=>p.status!=='deployed').map((p:any)=>String(p.commit_sha))]);
 const manual=await q`select sha,service_id,image,deployed_at from apphub_version_deployment where organization_id=${org} and project_id=${pid}`;
 deployments.push(...manual.map((d:any)=>({sha:String(d.sha),service:String(d.service_id),image:String(d.image),date:new Date(d.deployed_at).toISOString()})));
 const rows=await q`select name,reason,expires_at from apphub_version_protection where organization_id=${org} and project_id=${pid} and expires_at>now()`;
 const holds=new Map<string,{reason:string;until:string}>(rows.map((p:any)=>[String(p.name),{reason:String(p.reason),until:new Date(p.expires_at).toISOString()}]));
 const removed=await q`select name from apphub_version_recycle where organization_id=${org} and project_id=${pid}`;
 const removedNames=new Set(removed.map((v:any)=>String(v.name)));
 return versionEligibility(versions.filter(v=>!removedNames.has(v.name)),policy,{head:catalog.head,active,test:new Set(testRows.map((p:any)=>String(p.commit_sha))),pending,deployments,holds});
}

export async function assertVersionNotRecycled(q:any,org:string,pid:string,sha:string){
 const [removed]=await q`select name from apphub_version_recycle where organization_id=${org} and project_id=${pid} and sha=${sha} limit 1`;
 if(removed)throw new Error('此代码版本已进入回收站，请项目负责人先恢复后再使用');
}
