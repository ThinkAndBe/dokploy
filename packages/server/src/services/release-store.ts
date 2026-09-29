import postgres from 'postgres';
import {dbUrl} from '../db/constants';
export type Plan={id:string;organization_id:string;project_id:string;environment_id:string;service_id:string;created_by:string;title:string;tier:'test'|'formal';status:string;plan_hash:string;base_hash:string;payload:any;approved_by:string|null;approved_hash:string|null;worker_id:string|null;error:string|null;created_at:Date;updated_at:Date};
const globalDb=globalThis as unknown as {apphubReleaseSql?:ReturnType<typeof postgres>};
export const releaseSql=globalDb.apphubReleaseSql??=postgres(dbUrl,{max:4});
export async function event(q:any,id:string,actor:string,action:string,note=''){await q`insert into apphub_release_event(plan_id,actor,action,note) values(${id},${actor},${action},${note})`;}
export function visiblePlan(p:Plan){return {id:p.id,projectId:p.project_id,environmentId:p.environment_id,serviceId:p.service_id,createdBy:p.created_by,title:p.title,tier:p.tier,status:p.status,hash:p.plan_hash,diff:p.payload.diff,configuration:p.payload.input.configuration,description:p.payload.input.description,handoff:p.payload.handoff,testedPlanId:p.payload.input.testedPlanId??null,approvedBy:p.approved_by,error:p.error,createdAt:p.created_at,updatedAt:p.updated_at};}
export async function insertPlan(p:Omit<Plan,'created_at'|'updated_at'|'approved_by'|'approved_hash'|'worker_id'|'error'>,key:string){
 return releaseSql.begin(async q=>{
  await q`select pg_advisory_xact_lock(hashtext(${p.organization_id+':'+p.created_by+':'+key}))`;
  const existing=await q<Plan[]>`select * from apphub_release_plan where organization_id=${p.organization_id} and created_by=${p.created_by} and idempotency_key=${key}`;
  if(existing[0]){if(existing[0].payload.requestHash!==p.payload.requestHash)throw new Error('请求标识已被另一份方案使用');return existing[0];}
  if(p.payload.input.configuration.kind==='database'){await q`select pg_advisory_xact_lock(62929,2)`;const [quota]=await q`select count(*)::int as n from apphub_release_plan where payload->'input'->'configuration'->>'kind'='database' and status not in ('cancelled','rejected','failed')`;if((quota?.n??0)>=8)throw new Error('当前数据库服务额度已用完，请运维增加资源后调整额度');}
  const rows=await q<Plan[]>`insert into apphub_release_plan(id,organization_id,project_id,environment_id,service_id,created_by,title,tier,status,plan_hash,base_hash,idempotency_key,payload) values(${p.id},${p.organization_id},${p.project_id},${p.environment_id},${p.service_id},${p.created_by},${p.title},${p.tier},${p.status},${p.plan_hash},${p.base_hash},${key},${q.json(p.payload)}) returning *`;
  await event(q,p.id,p.created_by,'submitted');return rows[0]!;
 });
}
export async function latestHandoffs(organizationId?:string){
 const rows=organizationId?await releaseSql`select distinct on(service_id) service_id,payload from apphub_release_plan where status='deployed' and organization_id=${organizationId} order by service_id,updated_at desc`:await releaseSql`select distinct on(service_id) service_id,payload from apphub_release_plan where status='deployed' order by service_id,updated_at desc`;
 return Object.fromEntries(rows.map(r=>[r.service_id,r.payload.handoff]));
}
