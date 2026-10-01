import http from 'node:http';
import {previewProbe} from './preview-gateway';
import {previewOrigin} from './preview-policy';
import {eq} from 'drizzle-orm';
import {db} from '../db';
import {compose} from '../db/schema';
import {docker} from '../constants';
import {codeProject} from './project-code';
import {requireInteractive} from './release-policy';
import type {Actor} from './release-service';
import {sql,buildSchema} from './build-store';
import {testReplicaChange,assertTestLifecycleIdle} from './build-lifecycle-policy';
async function authorized(a:Actor,pid:string,q:any=sql){
 requireInteractive(a.apiKey);
 await codeProject({...a,name:'AppHub',email:'build@apphub.invalid'},pid);await buildSchema();
 const [p]=await q`select * from apphub_build_project where project_id=${pid} and organization_id=${a.organizationId}`;
 if(!p?.service_id)return null;
 const c=await db.query.compose.findFirst({where:eq(compose.composeId,p.service_id),with:{environment:true}});
 if(!c||c.environmentId!==p.environment_id||c.environment.projectId!==pid||!p.environment_id.startsWith('build-'))throw new Error('项目测试环境归属不一致，请管理员核查');
 const service=docker.getService(c.appName+'_app');let info;
 try{info=await service.inspect();}catch(e:any){if(e?.statusCode===404)return null;throw new Error('暂时无法读取测试服务状态，请稍后重试');}
 testReplicaChange(info.Spec,c.appName,'stop');
 return {p,c,service,info};
}
export async function testEnvironment(a:Actor,pid:string){
 const found=await authorized(a,pid);
 if(!found)return {state:'absent',desired:0,running:0,url:null as string|null,commit:null as string|null,buildId:null as string|null,mounts:[] as {volume:string;target:string}[],recent:[] as any[]};
 const {p,info}=found,desired=info.Spec.Mode.Replicated.Replicas;
 const tasks=await docker.listTasks({filters:JSON.stringify({service:[info.ID]})});
 const running=tasks.filter(t=>t.Status?.State==='running').length;
 const current=tasks.some(t=>t.Status?.State==='running'&&t.DesiredState==='running'&&t.Spec?.ContainerSpec?.Image===info.Spec.TaskTemplate.ContainerSpec.Image);
 const [j]=await sql`select j.*,r.payload from apphub_build_job j join apphub_release_plan r on r.id=j.plan_id::text where j.project_id=${pid} and r.service_id=${p.service_id} and j.image=${info.Spec.TaskTemplate.ContainerSpec.Image} and r.status='deployed' order by j.created_at desc limit 1`;
 const busy=await sql`select status from apphub_build_job where project_id=${pid} and status in ('queued','building','built','deploying') limit 1`;
 let healthy=false;const host=process.env.APPHUB_BUILD_TEST_HOST||'';
 if(desired&&current&&!busy.length&&j&&/^[a-zA-Z0-9.-]+$/.test(host)){
  try{healthy=await new Promise<boolean>(resolve=>{const r=http.get({hostname:host,port:p.port,path:j.manifest.health,headers:{Host:new URL(previewOrigin(p.environment_id)).host,'x-apphub-probe':previewProbe(pid,j.manifest.health)}},reply=>{reply.resume();resolve((reply.statusCode||0)>=200&&(reply.statusCode||0)<400);});r.setTimeout(5000,()=>r.destroy());r.on('error',()=>resolve(false));});}catch{}
 }
 const state=busy.length?'deploying':desired===0?(running?'stopping':'stopped'):healthy?'running':running?'unhealthy':'starting';
 const recent=await sql`select actor,action,status,created_at from apphub_build_environment_event where project_id=${pid} and organization_id=${a.organizationId} order by created_at desc limit 5`;
 return {state,desired,running,url:healthy?j?.payload?.handoff?.loginUrl??null:null,commit:j?.commit_sha??null,buildId:j?.id??null,mounts:(info.Spec.TaskTemplate.ContainerSpec.Mounts||[]).filter((m:any)=>m.Type==='volume').map((m:any)=>({volume:m.Source as string,target:m.Target as string})) as {volume:string;target:string}[],recent};
}
export async function changeTestEnvironment(a:Actor,pid:string,action:'stop'|'resume'){
 requireInteractive(a.apiKey);await buildSchema();
 const result=await sql.begin(async q=>{
  await q`select pg_advisory_xact_lock(hashtext(${pid}),63001)`;
  const found=await authorized(a,pid,q);if(!found)throw new Error('尚未部署测试应用，请先测试一个代码版本');
  const jobs=await q`select status from apphub_build_job where project_id=${pid} and status in ('queued','building','built','deploying')`;
  assertTestLifecycleIdle(jobs.map(j=>j.status));
  const change=testReplicaChange(found.info.Spec,found.c.appName,action);
  let edge:any=null,edgeInfo:any=null;
  try{edge=docker.getService(found.c.appName+'_preview_access');edgeInfo=await edge.inspect();}catch(e:any){if(e?.statusCode!==404)throw new Error('无法检查测试入口状态');}
  if(edgeInfo&&(edgeInfo.Spec.Name!==found.c.appName+'_preview_access'||edgeInfo.Spec.Labels?.['com.docker.stack.namespace']!==found.c.appName))throw new Error('测试入口归属异常');
  const replicas=action==='stop'?0:1,edgeChanged=edgeInfo&&edgeInfo.Spec.Mode?.Replicated?.Replicas!==replicas;
  if(!change.changed&&!edgeChanged)return {changed:false,error:null};
  const updateEdge=async()=>{if(edgeChanged)await edge.update({version:edgeInfo.Version.Index,...edgeInfo.Spec,Mode:{Replicated:{Replicas:replicas}}});};
  const [audit]=await q`insert into apphub_build_environment_event(project_id,organization_id,actor,action,status) values(${pid},${a.organizationId},${a.id},${action},'requested') returning id`;
  try{
   if(action==='stop')await updateEdge();if(change.changed)await found.service.update({version:found.info.Version.Index,...change.spec});if(action==='resume')await updateEdge();
   await q`update apphub_build_environment_event set status='accepted' where id=${audit!.id}`;
   return {changed:true,error:null};
  }catch{
   await q`update apphub_build_environment_event set status='failed' where id=${audit!.id}`;
   return {changed:false,error:'服务状态变更未确认，请刷新运行状态后重试；数据卷未删除'};
  }
 });
 if(result.error)throw new Error(result.error);
 return {changed:result.changed};
}
