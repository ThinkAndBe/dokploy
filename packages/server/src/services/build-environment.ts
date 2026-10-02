import {parseReleaseCompose} from './release-compose-policy';
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
 const names=Object.keys(parseReleaseCompose(c.composeFile).services);
 const services=await docker.listServices({filters:JSON.stringify({label:['com.docker.stack.namespace='+c.appName]})});
 const components=names.map(name=>{const item=services.find(s=>s.Spec?.Name===c.appName+'_'+name);if(item)testReplicaChange(item.Spec,c.appName,'stop',name);return {name,info:item};});
 return {p,c,service,info,components};
}
export async function testEnvironment(a:Actor,pid:string){
 const found=await authorized(a,pid);
 if(!found)return {state:'absent',desired:0,running:0,url:null as string|null,commit:null as string|null,buildId:null as string|null,mounts:[] as {volume:string;target:string}[],components:[] as {name:string;desired:number;running:number;state:string}[],recent:[] as any[]};
 const {p,info}=found;
 const components=await Promise.all(found.components.map(async item=>{const spec=item.info?.Spec;if(!item.info?.ID||!spec)return {name:item.name,desired:1,running:0,state:'缺失'};const jobs=await docker.listTasks({filters:JSON.stringify({service:[item.info.ID]})});const desired=spec.Mode?.Replicated?.Replicas??0,running=jobs.filter(t=>t.Status?.State==='running'&&t.DesiredState==='running'&&(t.Spec as any)?.ContainerSpec?.Image===(spec.TaskTemplate as any)?.ContainerSpec?.Image).length;return {name:item.name,desired,running,state:desired===0?'已停止':running===desired?'运行中':'启动中或异常'};}));
 const desired=components.reduce((n,c)=>n+c.desired,0);
 const tasks=await docker.listTasks({filters:JSON.stringify({service:[info.ID]})});
 const running=components.reduce((n,c)=>n+c.running,0);
 const current=tasks.some(t=>t.Status?.State==='running'&&t.DesiredState==='running'&&t.Spec?.ContainerSpec?.Image===info.Spec.TaskTemplate.ContainerSpec.Image);
 const [j]=await sql`select j.*,r.payload from apphub_build_job j join apphub_release_plan r on r.id=j.plan_id::text where j.project_id=${pid} and r.service_id=${p.service_id} and j.image=${info.Spec.TaskTemplate.ContainerSpec.Image} and r.status='deployed' order by j.created_at desc limit 1`;
 const busy=await sql`select status from apphub_build_job where project_id=${pid} and status in ('queued','building','built','deploying') limit 1`;
 let healthy=false;const host=process.env.APPHUB_BUILD_TEST_HOST||'';
 if(desired&&current&&components.every(c=>c.running===c.desired&&c.desired>0)&&!busy.length&&j&&/^[a-zA-Z0-9.-]+$/.test(host)){
  try{healthy=await new Promise<boolean>(resolve=>{const r=http.get({hostname:host,port:p.port,path:j.manifest.health,headers:{Host:new URL(previewOrigin(p.environment_id)).host,'x-apphub-probe':previewProbe(pid,j.manifest.health)}},reply=>{reply.resume();resolve((reply.statusCode||0)>=200&&(reply.statusCode||0)<400);});r.setTimeout(5000,()=>r.destroy());r.on('error',()=>resolve(false));});}catch{}
 }
 const state=busy.length?'deploying':desired===0?(running?'stopping':'stopped'):healthy?'running':running?'unhealthy':'starting';
 const recent=await sql`select actor,action,status,created_at from apphub_build_environment_event where project_id=${pid} and organization_id=${a.organizationId} order by created_at desc limit 5`;
 return {state,desired,running,url:healthy?j?.payload?.handoff?.loginUrl??null:null,commit:j?.commit_sha??null,buildId:j?.id??null,components,mounts:(info.Spec.TaskTemplate.ContainerSpec.Mounts||[]).filter((m:any)=>m.Type==='volume').map((m:any)=>({volume:m.Source as string,target:m.Target as string})) as {volume:string;target:string}[],recent};
}
export async function changeTestEnvironment(a:Actor,pid:string,action:'stop'|'resume'){
 requireInteractive(a.apiKey);await buildSchema();
 const result=await sql.begin(async q=>{
  await q`select pg_advisory_xact_lock(hashtext(${pid}),63001)`;
  const found=await authorized(a,pid,q);if(!found)throw new Error('尚未部署测试应用，请先测试一个代码版本');
  const jobs=await q`select status from apphub_build_job where project_id=${pid} and status in ('queued','building','built','deploying')`;
  assertTestLifecycleIdle(jobs.map(j=>j.status));
  const ordered=[...found.components].sort((a,b)=>action==='stop'?(a.name==='preview_access'?-1:b.name==='preview_access'?1:0):(a.name==='preview_access'?1:b.name==='preview_access'?-1:0));
  const changes=ordered.map(item=>{if(!item.info?.Spec||!item.info.ID)throw new Error('组件 '+item.name+' 不存在，请重新测试该版本');return {info:item.info,change:testReplicaChange(item.info.Spec,found.c.appName,action,item.name)};});
  if(changes.every(c=>!c.change.changed))return {changed:false,error:null};
  const [audit]=await q`insert into apphub_build_environment_event(project_id,organization_id,actor,action,status) values(${pid},${a.organizationId},${a.id},${action},'requested') returning id`;
  try{
   for(const c of changes)if(c.change.changed)await docker.getService(c.info.ID!).update({version:c.info.Version!.Index,...c.change.spec});
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
