import {releaseSql as sql} from './release-store';
import {canUseIdentity} from './identity-policy';
export {sql};
let init:Promise<void>|undefined;
export function identitySchema(){return init??=(async()=>{
 await sql`create table if not exists apphub_identity_user(source text not null,external_id text not null,organization_id text not null,username text not null,employee_number text not null,display_name text not null,email text not null default '',group_path text not null,department text not null default '',external_reference text not null default '',source_enabled boolean not null,expires_at timestamptz,missing boolean not null default false,access_enabled boolean not null default false,user_id text unique,seen_run uuid,synced_at timestamptz not null default now(),primary key(source,external_id))`;
 await sql`create index if not exists apphub_identity_user_org on apphub_identity_user(organization_id,username)`;
 await sql`create table if not exists apphub_identity_group(source text not null,external_id text not null,organization_id text not null,name text not null,path text not null,parent_path text not null,deleted boolean not null,primary key(source,external_id))`;
 await sql`create table if not exists apphub_identity_sync(id uuid primary key,source text not null,organization_id text not null,actor text not null,status text not null,user_count integer not null default 0,group_count integer not null default 0,error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now())`;
 await sql`create table if not exists apphub_identity_event(id bigserial primary key,organization_id text not null,actor text not null,target text not null,action text not null,created_at timestamptz not null default now())`;
 })().catch(e=>{init=undefined;throw e;});}
export async function identitySessionAllowed(userId:string){
 if(process.env.APPHUB_IDENTITY_ENABLED!=='true')return true;
 await identitySchema();const [r]=await sql`select source_enabled,access_enabled,missing,expires_at from apphub_identity_user where user_id=${userId}`;
 return !r||canUseIdentity(r);
}
