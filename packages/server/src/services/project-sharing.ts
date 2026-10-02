import {memberRole,assertWrite} from './apphub-rbac';
import {releaseSql as sql} from './release-store';
import {releaseTargets,requireInteractive} from './release-policy';
import type {Actor} from './release-service';

export const isProjectAdmin=(role:string)=>role==='owner'||role==='admin';
export function assertProjectManager(role:string,actor:string,owner?:string){
 if(!isProjectAdmin(role)&&actor!==owner)throw new Error('只有项目负责人或管理员可以管理成员和移交项目');
}
async function context(q:any,a:Actor,projectId:string){
 const [m]=await q`select * from member where user_id=${a.id} and organization_id=${a.organizationId}`;
 const [p]=await q`select "projectId" from project where "projectId"=${projectId} and "organizationId"=${a.organizationId}`;
 if(!m||!p||(!isProjectAdmin(m.role)&&!m.accesedProjects.includes(projectId)))throw new Error('项目不存在或未授权');
 const [owner]=await q`select user_id from apphub_project_owner where project_id=${projectId} and organization_id=${a.organizationId}`;
 return {m,owner:owner?.user_id as string|undefined};
}
export async function initializeProjectOwner(a:Actor,projectId:string){
 await sql`insert into apphub_project_owner(project_id,organization_id,user_id) values(${projectId},${a.organizationId},${a.id}) on conflict do nothing`;
}
export async function sharingDetails(a:Actor,projectId:string){
 const {m,owner}=await context(sql,a,projectId);const canManage=(await memberRole(a)).effectiveRole!=='viewer'&&(isProjectAdmin(m.role)||owner===a.id);
 const rows=await sql`select m.user_id as id,coalesce(nullif(trim(concat_ws(' ',u."firstName",u."lastName")),''),u.email) as name,u.email from member m join "user" u on u.id=m.user_id where m.organization_id=${a.organizationId} and ${projectId}=any(m."accesedProjects") order by u.email`;
 const candidates=canManage?await sql`select m.user_id as id,coalesce(nullif(trim(concat_ws(' ',u."firstName",u."lastName")),''),u.email) as name,u.email from member m join "user" u on u.id=m.user_id where m.organization_id=${a.organizationId} order by u.email`:[];
 return {ownerId:owner??null,isOwner:owner===a.id,canManage,members:rows.map(r=>({id:String(r.id),name:String(r.name),email:String(r.email),role:r.id===owner?'负责人':'协作者'})),candidates:candidates.map(r=>({id:String(r.id),name:String(r.name),email:String(r.email)}))};
}
export async function changeSharing(a:Actor,input:{projectId:string;userId:string;action:'grant'|'revoke'|'transfer';keepPrevious:boolean}){
 requireInteractive(a.apiKey);await assertWrite(a);
 const targets=(await releaseTargets()).filter(t=>t.organizationId===a.organizationId&&t.projectId===input.projectId&&t.tier==='test');
 return sql.begin(async q=>{
  await q`select pg_advisory_xact_lock(hashtext(${input.projectId}))`;
  const {m,owner}=await context(q,a,input.projectId);assertProjectManager(m.role,a.id,owner);
  const members=await q`select * from member where organization_id=${a.organizationId} order by id for update`;
  const target=members.find(v=>v.user_id===input.userId);if(!target)throw new Error('只能选择当前组织内的用户');
  if(input.action==='revoke'&&input.userId===owner)throw new Error('请先移交负责人，再撤销其项目权限');
  if(input.action==='transfer'&&input.userId===owner)throw new Error('该用户已经是项目负责人');
  const envs=await q`select "environmentId" as id from environment where "projectId"=${input.projectId}`;
  const allEnv=envs.map(v=>v.id);const testEnv=targets.map(v=>v.environmentId);
  const services=await q`select "composeId" as id,"environmentId" as env from compose where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId}) union all select "applicationId" as id,"environmentId" as env from application where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId}) union all select "postgresId" as id,"environmentId" as env from "postgres" where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId}) union all select "mysqlId" as id,"environmentId" as env from "mysql" where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId}) union all select "mariadbId" as id,"environmentId" as env from "mariadb" where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId}) union all select "mongoId" as id,"environmentId" as env from "mongo" where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId}) union all select "redisId" as id,"environmentId" as env from "redis" where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId}) union all select "libsqlId" as id,"environmentId" as env from "libsql" where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId})`;
  const appServices=await q`select "composeId" as id from compose where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId}) union all select "applicationId" as id from application where "environmentId" in (select "environmentId" from environment where "projectId"=${input.projectId})`;
  const allService=services.map(v=>v.id);const testService=services.filter(v=>testEnv.includes(v.env)&&appServices.some(s=>s.id===v.id)).map(v=>v.id);
  async function apply(row:any,grant:boolean){
   const projectIds=grant?[...new Set([...row.accesedProjects,input.projectId])]:row.accesedProjects.filter((v:string)=>v!==input.projectId);
   const envIds=grant?[...new Set([...row.accessedEnvironments,...testEnv])]:row.accessedEnvironments.filter((v:string)=>!allEnv.includes(v));
   const serviceIds=grant?[...new Set([...row.accesedServices,...testService])]:row.accesedServices.filter((v:string)=>!allService.includes(v));
   await q`update member set "accesedProjects"=ARRAY(select jsonb_array_elements_text(${q.json(projectIds)}::jsonb)),"accessedEnvironments"=ARRAY(select jsonb_array_elements_text(${q.json(envIds)}::jsonb)),"accesedServices"=ARRAY(select jsonb_array_elements_text(${q.json(serviceIds)}::jsonb)) where id=${row.id} and organization_id=${a.organizationId}`;
  }
  await apply(target,input.action!=='revoke');
  if(input.action==='transfer'){
   await q`insert into apphub_project_owner(project_id,organization_id,user_id) values(${input.projectId},${a.organizationId},${input.userId}) on conflict(project_id) do update set user_id=excluded.user_id,updated_at=now()`;
   if(owner&&!input.keepPrevious){const previous=members.find(v=>v.user_id===owner);if(previous)await apply(previous,false);}
  }
  await q`insert into apphub_project_access_event(organization_id,project_id,actor,target,action) values(${a.organizationId},${input.projectId},${a.id},${input.userId},${input.action+(input.action==='transfer'?(input.keepPrevious?':keep_previous':':remove_previous'):'')})`;
  return {ok:true};
 });
}
