import {projectNameText,projectDescriptionText} from './project-profile-policy';
import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import {releaseSql as sql} from './release-store';
import {authenticateMcp,memberRole,authorizedProject,audit} from './apphub-rbac';
import {canCreateProject,effectiveRole} from './apphub-role-policy';
import {ensureProjectRepository} from './project-repository';
const inputSchema=z.object({name:projectNameText,description:projectDescriptionText.default(''),requestKey:z.string().uuid()}).strict();
export async function createMcpProject(auth:Awaited<ReturnType<typeof authenticateMcp>>,raw:unknown){
 const input=inputSchema.parse(raw),a=auth.actor;
 const m=await memberRole(a);
 if(!auth.key.scopes.includes('create-project')||!canCreateProject(m.effectiveRole,Boolean(m.canCreateProjects)))throw new Error('没有创建项目权限');
 const hash=createHash('sha256').update(JSON.stringify({name:input.name,description:input.description})).digest('hex');
 const result=await sql.begin(async q=>{
  // Serialize creation with role updates and permission changes before locking the key.
  const [member]=await q`select m.*,r.role as apphub_role from member m left join apphub_user_role r on r.organization_id=m.organization_id and r.user_id=m.user_id where m.user_id=${a.id} and m.organization_id=${a.organizationId} for update of m`;
  if(!member||!canCreateProject(effectiveRole(member.role,member.apphub_role),Boolean(member.canCreateProjects)))throw new Error('没有创建项目权限');
  const [key]=await q`select * from apphub_mcp_key where id=${auth.key.id} and user_id=${a.id} and organization_id=${a.organizationId} and not revoked and expires_at>now() for update`;
  if(!key||!key.scopes.includes('create-project'))throw new Error('MCP 密钥已失效或未授权创建项目');
  const [prior]=await q`select * from apphub_mcp_project_request where key_id=${key.id} and request_key=${input.requestKey}`;
  if(prior){if(prior.input_hash!==hash)throw new Error('请求标识已用于不同项目，请勿修改重试参数');if(!member.accesedProjects.includes(prior.project_id)&&!['admin','owner'].includes(member.role))throw new Error('项目不存在或未授权');return {projectId:String(prior.project_id),created:false};}
  const [quota]=await q`select count(*)::int as n from apphub_project_owner where organization_id=${a.organizationId} and user_id=${a.id}`;
  if((quota?.n??0)>=50)throw new Error('个人项目已达 50 个，请联系管理员');
  const id=randomUUID(),now=new Date().toISOString();
  await q`insert into project("projectId",name,description,"createdAt","organizationId") values(${id},${input.name},${input.description},${now},${a.organizationId})`;
  await q`insert into apphub_project_owner(project_id,organization_id,user_id) values(${id},${a.organizationId},${a.id})`;
  await q`update member set "accesedProjects"=array_append("accesedProjects",${id}) where id=${member.id}`;
  await q`update apphub_mcp_key set projects=projects||${q.json([id])}::jsonb where id=${key.id}`;
  await q`insert into apphub_mcp_project_request(key_id,request_key,project_id,input_hash) values(${key.id},${input.requestKey},${id},${hash})`;
  return {projectId:id,created:true};
 });
 await authorizedProject(a,result.projectId);
 // Repository provisioning is idempotent; retrying after an outage repairs it without a second project.
 let ready=false;try{ready=Boolean(await ensureProjectRepository(result.projectId));}catch{ready=false;}
 await audit(a,'mcp:create_project',result.projectId,ready?'ok':'repository_pending');
 return {...result,name:input.name,owner:'当前用户',repositoryStatus:ready?'ready':'pending',message:ready?'项目已创建，可使用本密钥上传代码和开始测试':'项目已保留；代码仓库尚未就绪，请使用同一 requestKey 重试',openInPlatform:(process.env.APPHUB_PUBLIC_URL||'')+'/dashboard/code?projectId='+encodeURIComponent(result.projectId)};
}
