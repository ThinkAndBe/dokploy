import {releaseSql as sql} from './release-store';
export {sql};
let ready:Promise<void>|undefined;
export function buildSchema(){return ready??=(async()=>{await sql.begin(async q=>{
 await q`select pg_advisory_xact_lock(63001,1)`;
 await q`create table if not exists apphub_build_project(project_id text primary key,organization_id text not null,environment_id text unique not null,port integer unique not null,service_id text,credentials text,created_at timestamptz not null default now())`;
 await q`create table if not exists apphub_build_worker(id text primary key,last_seen timestamptz not null default now(),message text not null default '')`;
 await q`create table if not exists apphub_build_job(id uuid primary key,project_id text not null,organization_id text not null,created_by text not null,commit_sha text not null,manifest jsonb not null,repository text not null,status text not null default 'queued',lease text,lease_until timestamptz,worker_id text,image text,plan_id uuid,error text,log text not null default '',log_seq integer not null default 0,cancel_requested boolean not null default false,request_key uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,created_by,request_key))`;
 await q`create table if not exists apphub_build_environment_event(id bigserial primary key,project_id text not null,organization_id text not null,actor text not null,action text not null,status text not null,created_at timestamptz not null default now())`;
 await q`create index if not exists apphub_build_environment_event_project on apphub_build_environment_event(project_id,created_at desc)`;
 await q`create table if not exists apphub_preview_access(id uuid primary key,project_id text not null,organization_id text not null,actor text not null,session_id text not null,ticket_hash text unique not null,ticket_expires_at timestamptz not null,token_hash text unique,expires_at timestamptz not null)`;
 await q`create index if not exists apphub_preview_access_expiry on apphub_preview_access(expires_at)`;
 await q`alter table apphub_build_job add column if not exists artifacts jsonb`;
 await q`alter table apphub_build_project add column if not exists stack_secrets text`;
 await q`create index if not exists apphub_build_job_project on apphub_build_job(project_id,created_at desc)`;
 });})().catch(e=>{ready=undefined;throw e;});}
export async function managedBuildTargets(){
 if(process.env.APPHUB_BUILD_ENABLED!=='true')return [];await buildSchema();
 const prefix=process.env.APPHUB_BUILD_REGISTRY_PREFIX,hostname=process.env.APPHUB_BUILD_TEST_HOST,node=process.env.APPHUB_BUILD_TEST_NODE;
 if(!prefix||!hostname||!node)return [];
 const rows=await sql`select * from apphub_build_project`;
 return rows.map(p=>({organizationId:p.organization_id,projectId:p.project_id,environmentId:p.environment_id,tier:'test',allowNewWeb:true,imagePrefixes:[prefix],ports:[p.port],hostname,serviceIds:p.service_id?[p.service_id]:[],allowedEnvironmentKeys:[],sandboxNode:node,storageVolume:'apphub-test-data-'+p.environment_id.replace(/[^a-zA-Z0-9_-]/g,''),managedBuild:true}));
}
