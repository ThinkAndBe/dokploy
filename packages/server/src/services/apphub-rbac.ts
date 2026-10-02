import {keyExpiration,keyExpiryInput,keyLifetimeDays} from './mcp-key-lifetime';
import {releaseSql as sql} from './release-store';
import {effectiveRole,assertRoleAction,assertKeySelection} from './apphub-role-policy';
import {identitySchema,identitySessionAllowed} from './identity-store';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
type Actor={id:string;organizationId:string};
let pending:Promise<void>|undefined;
export function rbacSchema(){return pending??=(async()=>{
 await sql`create table if not exists apphub_user_role(organization_id text not null,user_id text not null,role text not null check(role in ('developer','viewer')),primary key(organization_id,user_id))`;
 await sql`create table if not exists apphub_mcp_key(id uuid primary key,organization_id text not null,user_id text not null,name text not null,token_hash text unique not null,projects jsonb not null,scopes jsonb not null,expires_at timestamptz not null,revoked boolean not null default false,created_at timestamptz not null default now(),last_used_at timestamptz)`;
 await sql`create table if not exists apphub_mcp_project_request(key_id uuid not null,request_key uuid not null,project_id text not null,input_hash text not null,primary key(key_id,request_key))`;
 await sql`create table if not exists apphub_permission_event(id bigserial primary key,organization_id text not null,actor text not null,action text not null,target text not null,status text not null,created_at timestamptz not null default now())`;
 })().catch(e=>{pending=undefined;throw e;});}
export async function memberRole(a:Actor){await rbacSchema();const [m]=await sql`select m.*,u.banned,r.role as apphub_role from member m join "user" u on u.id=m.user_id left join apphub_user_role r on r.organization_id=m.organization_id and r.user_id=m.user_id where m.user_id=${a.id} and m.organization_id=${a.organizationId}`;if(!m||m.banned||!await identitySessionAllowed(a.id))throw new Error('用户没有平台访问权限');return {...m,accesedProjects:m.accesedProjects as string[],canCreateProjects:Boolean(m.canCreateProjects),effectiveRole:effectiveRole(m.role,m.apphub_role)};}
export async function assertWrite(a:Actor){const m=await memberRole(a);assertRoleAction(m.effectiveRole,'project.write','mutation');}
export async function authorizeRoute(a:Actor,path:string,type:string){const m=await memberRole(a);assertRoleAction(m.effectiveRole,path,type);}
export async function authorizedProject(a:Actor,id:string){const m=await memberRole(a);const [p]=await sql`select "projectId" as id,name from project where "projectId"=${id} and "organizationId"=${a.organizationId}`;if(!p||(m.effectiveRole!=='admin'&&!m.accesedProjects.includes(id)))throw new Error('项目不存在或未授权');return p;}
export async function audit(a:Actor,action:string,target:string,status='ok'){await rbacSchema();await sql`insert into apphub_permission_event(organization_id,actor,action,target,status) values(${a.organizationId},${a.id},${action},${target},${status})`;}
export async function roleUsers(a:Actor){if((await memberRole(a)).effectiveRole!=='admin')throw new Error('仅管理员可管理角色');await identitySchema();return sql`select m.user_id as id,m.role as native_role,m."canCreateProjects" as can_create,coalesce(i.username,u.email) as username,coalesce(i.display_name,nullif(trim(concat_ws(' ',u."firstName",u."lastName")),''),u.email) as name,case when m.role in ('owner','admin') then 'admin' else coalesce(r.role,'developer') end as role from member m join "user" u on u.id=m.user_id left join apphub_user_role r on r.user_id=m.user_id and r.organization_id=m.organization_id left join apphub_identity_user i on i.user_id=m.user_id where m.organization_id=${a.organizationId} order by username`;
}
export async function setRole(a:Actor,input:{userId:string;role:'admin'|'developer'|'viewer';canCreate:boolean}){
 await rbacSchema();return sql.begin(async q=>{await q`select pg_advisory_xact_lock(hashtext(${a.organizationId}),78001)`;
 const members=await q`select * from member where organization_id=${a.organizationId} order by id for update`;
 const actor=members.find(m=>m.user_id===a.id),target=members.find(m=>m.user_id===input.userId);
 if(!actor||!['owner','admin'].includes(actor.role))throw new Error('仅管理员可管理角色');if(!target)throw new Error('用户不在当前组织');if(input.userId===a.id||target.role==='owner')throw new Error('不能在此修改自己或平台所有者的角色');
 await q`update member set role=${input.role==='admin'?'admin':'member'},"canCreateProjects"=${input.role==='developer'&&input.canCreate} where id=${target.id}`;
 await q`insert into apphub_user_role(organization_id,user_id,role) values(${a.organizationId},${input.userId},${input.role==='viewer'?'viewer':'developer'}) on conflict(organization_id,user_id) do update set role=excluded.role`;
 await q`insert into apphub_permission_event(organization_id,actor,action,target,status) values(${a.organizationId},${a.id},${'set_role:'+input.role},${input.userId},'ok')`;return {ok:true};});
}
export async function myProjects(a:Actor){const m=await memberRole(a);const rows=await sql`select "projectId" as id,name from project where "organizationId"=${a.organizationId} order by name`;return rows.filter(p=>m.effectiveRole==='admin'||m.accesedProjects.includes(p.id));}
export async function keys(a:Actor){await memberRole(a);return sql`select id,name,projects,scopes,expires_at,revoked,created_at,last_used_at from apphub_mcp_key where organization_id=${a.organizationId} and user_id=${a.id} and not revoked order by created_at desc limit 100`;}
export async function createKey(a:Actor,input:{name:string;projects:string[];scopes:string[];days:number}){keyLifetimeDays.parse(input.days);const m=await memberRole(a);assertKeySelection(m.effectiveRole,Boolean(m.canCreateProjects),input.projects,input.scopes);for(const id of input.projects)await authorizedProject(a,id);if(m.effectiveRole==='viewer'&&input.scopes.some(s=>s!=='read'))throw new Error('只读成员只能创建读取密钥');const existing=await keys(a);if(existing.filter(k=>!k.revoked&&new Date(k.expires_at)>new Date()).length>=20)throw new Error('有效密钥最多 20 个，请先撤销旧密钥');const token='apphub_mcp_'+randomBytes(32).toString('base64url'),id=randomUUID();await sql`insert into apphub_mcp_key(id,organization_id,user_id,name,token_hash,projects,scopes,expires_at) values(${id},${a.organizationId},${a.id},${input.name},${createHash('sha256').update(token).digest('hex')},${sql.json(input.projects)},${sql.json(input.scopes)},${keyExpiration(input.days)})`;await audit(a,'create_mcp_key',id);return {id,token};}
export async function revokeKey(a:Actor,id:string){await memberRole(a);const rows=await sql`update apphub_mcp_key set revoked=true where id=${id} and organization_id=${a.organizationId} and user_id=${a.id} returning id`;if(!rows.length)throw new Error('密钥不存在或未授权');await audit(a,'revoke_mcp_key',id);return {ok:true};}
export async function authenticateMcp(token:string){if(!/^apphub_mcp_[A-Za-z0-9_-]{43}$/.test(token))throw new Error('MCP 密钥无效');await rbacSchema();const [k]=await sql`select * from apphub_mcp_key where token_hash=${createHash('sha256').update(token).digest('hex')} and not revoked and expires_at>now()`;if(!k)throw new Error('MCP 密钥无效或已过期');const actor={id:String(k.user_id),organizationId:String(k.organization_id)},m=await memberRole(actor);await sql`update apphub_mcp_key set last_used_at=now() where id=${k.id}`;return {actor,key:k,role:m.effectiveRole};}

// Owner-only interactive renewal keeps the hash and permissions intact. Revocation is final.
export async function changeKeyExpiry(a:Actor,raw:unknown){
 const input=keyExpiryInput.parse(raw);await memberRole(a);
 return sql.begin(async q=>{
  // Match role changes / project creation lock order: member, then key.
  const [m]=await q`select m.*,r.role as apphub_role from member m left join apphub_user_role r on r.organization_id=m.organization_id and r.user_id=m.user_id where m.user_id=${a.id} and m.organization_id=${a.organizationId} for update of m`;
  if(!m)throw new Error('用户没有平台访问权限');
  const [k]=await q`select * from apphub_mcp_key where id=${input.id} and organization_id=${a.organizationId} and user_id=${a.id} and not revoked for update`;
  if(!k)throw new Error('密钥不存在、已撤销或不属于当前用户，无法续期');
  const role=effectiveRole(m.role,m.apphub_role);
  assertKeySelection(role,Boolean(m.canCreateProjects),k.projects as string[],k.scopes as string[]);
  if(role==='viewer'&&k.scopes.some((s:string)=>s!=='read'))throw new Error('当前为只读成员，不能延长含写入权限的密钥');
  for(const id of k.projects as string[]){
   const [p]=await q`select "projectId" from project where "projectId"=${id} and "organizationId"=${a.organizationId}`;
   if(!p||(role!=='admin'&&!m.accesedProjects.includes(id)))throw new Error('密钥包含已取消授权的项目，请重新创建符合当前权限的密钥');
  }
  const [quota]=await q`select count(*)::int as n from apphub_mcp_key where user_id=${a.id} and organization_id=${a.organizationId} and id<>${input.id} and not revoked and expires_at>now()`;
  if(!quota)throw new Error('无法核对密钥额度，请稍后重试');
  if(quota.n>=20)throw new Error('有效密钥最多 20 个，请先撤销旧密钥');
  const expires=keyExpiration(input.days);
  await q`update apphub_mcp_key set expires_at=${expires} where id=${input.id} and organization_id=${a.organizationId} and user_id=${a.id} and not revoked`;
  await q`insert into apphub_permission_event(organization_id,actor,action,target,status) values(${a.organizationId},${a.id},'renew_mcp_key',${input.id},'ok')`;
  return {id:input.id,expiresAt:expires,tokenUnchanged:true};
 });
}

// A member may reuse only their own live key. This never changes scopes or expiry.
export async function addKeyProject(a:Actor,input:{id:string;projectId:string}){
 await memberRole(a);
 return sql.begin(async q=>{
  const [m]=await q`select m.*,r.role as apphub_role from member m left join apphub_user_role r on r.organization_id=m.organization_id and r.user_id=m.user_id where m.user_id=${a.id} and m.organization_id=${a.organizationId} for update of m`;
  if(!m)throw new Error('用户没有平台访问权限');
  const [k]=await q`select * from apphub_mcp_key where id=${input.id} and organization_id=${a.organizationId} and user_id=${a.id} and not revoked and expires_at>now() for update`;
  if(!k)throw new Error('请选择本人有效的接入；过期接入请先续期');
  const role=effectiveRole(m.role,m.apphub_role);
  const [p]=await q`select "projectId" from project where "projectId"=${input.projectId} and "organizationId"=${a.organizationId}`;
  if(!p||(role!=='admin'&&!m.accesedProjects.includes(input.projectId)))throw new Error('项目不存在或未授权');
  if(role==='viewer'&&k.scopes.some((s:string)=>s!=='read'))throw new Error('只读成员只能复用只读接入');
  const projects=[...new Set<string>([...k.projects,input.projectId])];if(projects.length>50)throw new Error('一个接入最多绑定50个项目');
  await q`update apphub_mcp_key set projects=${q.json(projects)} where id=${k.id}`;
  await q`insert into apphub_permission_event(organization_id,actor,action,target,status) values(${a.organizationId},${a.id},'bind_mcp_project',${k.id+':'+input.projectId},'ok')`;
  return {ok:true,tokenUnchanged:true};
 });
}
