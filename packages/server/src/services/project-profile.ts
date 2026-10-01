import {releaseSql as sql} from './release-store';
import {authorizedProject,assertWrite,memberRole,audit} from './apphub-rbac';
import {projectProfileInput} from './project-profile-policy';
type Actor={id:string;organizationId:string};
export async function readProjectProfile(a:Actor,id:string){
 await authorizedProject(a,id);
 const [p]=await sql`select "projectId" as "projectId",name,description from project where "projectId"=${id} and "organizationId"=${a.organizationId}`;
 if(!p)throw new Error('项目不存在或未授权');
 return {projectId:String(p.projectId),name:String(p.name),description:p.description as string|null,canEdit:(await memberRole(a)).effectiveRole!=='viewer'};
}
export async function saveProjectProfile(a:Actor,raw:unknown){
 const input=projectProfileInput.parse(raw);
 await assertWrite(a);await authorizedProject(a,input.projectId);
 // Compare-and-set protects a concurrent editor. Only human-readable metadata may change.
 const [p]=await sql`update project set name=${input.name},description=${input.description} where "projectId"=${input.projectId} and "organizationId"=${a.organizationId} and name=${input.expected.name} and description is not distinct from ${input.expected.description} returning "projectId" as "projectId",name,description`;
 if(!p)throw new Error('项目资料已被其他人修改，请关闭后重新打开编辑，核对最新内容');
 await audit(a,'update_project_profile',input.projectId);
 return {projectId:String(p.projectId),name:String(p.name),description:String(p.description)};
}
