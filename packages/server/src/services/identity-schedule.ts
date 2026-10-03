import {z} from 'zod';
export const identityScheduleInput=z.object({enabled:z.boolean(),intervalMinutes:z.number().int().min(5,'同步周期至少为 5 分钟').max(10080,'同步周期最多为 7 天')});
export type IdentityScheduleSource={source:string;organizationId:string};
// Call inside the source advisory lock when changing/claiming a schedule.
export async function readIdentitySchedule(q:any,c:IdentityScheduleSource){
 await q`insert into apphub_identity_schedule(source,organization_id,enabled,interval_minutes,next_run_at,updated_by)
 values(${c.source},${c.organizationId},${process.env.ATRUST_AUTO_SYNC==='true'},30,
 coalesce((select max(created_at)+interval '30 minutes' from apphub_identity_sync where source=${c.source}),now()),'system') on conflict(source) do nothing`;
 const [row]=await q`select enabled,interval_minutes,next_run_at,updated_at,updated_by from apphub_identity_schedule where source=${c.source} and organization_id=${c.organizationId}`;
 if(!row)throw new Error('同步周期未绑定当前组织');
 return {enabled:row.enabled as boolean,intervalMinutes:row.interval_minutes as number,nextRunAt:row.enabled?new Date(row.next_run_at).toISOString():null,updatedAt:new Date(row.updated_at).toISOString()};
}
export async function writeIdentitySchedule(q:any,c:IdentityScheduleSource,input:unknown,actor:string){
 const value=identityScheduleInput.parse(input);
 await readIdentitySchedule(q,c);
 await q`update apphub_identity_schedule set enabled=${value.enabled},interval_minutes=${value.intervalMinutes},next_run_at=now()+${value.intervalMinutes}*interval '1 minute',updated_at=now(),updated_by=${actor} where source=${c.source} and organization_id=${c.organizationId}`;
 return readIdentitySchedule(q,c);
}
