import {buildSchema} from './build-store';
import {randomUUID} from 'node:crypto';
import {releaseSql as sql} from './release-store';
import {accessiblePlan,type Actor} from './release-service';
import {findMemberByUserId} from './permission';
import {requireInteractive} from './release-policy';
import {isProjectAdmin} from './project-sharing';
export function assertTestedRelease(tier:string,status:string){if(tier!=='test'||status!=='deployed')throw new Error('请先完成测试部署，再申请上线');}
export async function requestPublish(a:Actor,testedPlanId:string,description:string){
 requireInteractive(a.apiKey);const {plan:p}=await accessiblePlan(a,testedPlanId);assertTestedRelease(p.tier,p.status);
 await buildSchema();const [build]=await sql`select status from apphub_build_job where plan_id=${p.id}`;if(build&&build.status!=='ready')throw new Error('应用健康检查尚未通过，请先完成测试');
 const [r]=await sql`insert into apphub_publish_request(id,organization_id,project_id,tested_plan_id,created_by,description) values(${randomUUID()},${a.organizationId},${p.project_id},${p.id},${a.id},${description}) on conflict(organization_id,tested_plan_id) do update set tested_plan_id=excluded.tested_plan_id returning id,status`;
 return r;
}
export async function publishRequests(a:Actor){
 const m=await findMemberByUserId(a.id,a.organizationId);
 const rows=await sql`select r.*,coalesce(nullif(trim(concat_ws(' ',u."firstName",u."lastName")),''),u.email) as applicant_name,p.name as project_name,t.title as tested_title,t.payload->'input'->'configuration' as configuration,
  (select f.status from apphub_release_plan f where f.organization_id=r.organization_id and f.tier='formal' and f.payload->'input'->>'testedPlanId'=r.tested_plan_id order by f.created_at desc limit 1) as release_status
  from apphub_publish_request r join "user" u on u.id=r.created_by join project p on p."projectId"=r.project_id join apphub_release_plan t on t.id=r.tested_plan_id where r.organization_id=${a.organizationId} order by r.created_at desc limit 200`;
 return rows.filter(r=>isProjectAdmin(m.role)||m.accessedProjects.includes(r.project_id));
}
export async function reviewPublish(a:Actor,id:string,status:'processing'|'rejected',note:string){
 requireInteractive(a.apiKey);const m=await findMemberByUserId(a.id,a.organizationId);if(!isProjectAdmin(m.role))throw new Error('只有管理员可以处理上线申请');
 const rows=await sql`update apphub_publish_request set status=${status},reviewed_by=${a.id},review_note=${note},updated_at=now() where id=${id} and organization_id=${a.organizationId} and status='pending' returning id`;
 if(!rows.length)throw new Error('申请不存在或已经处理');return {ok:true};
}
