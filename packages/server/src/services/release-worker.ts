import {parseReleaseCompose,stringifyReleaseCompose} from './release-compose-policy';
import {assertWrite} from './apphub-rbac';
import {prepareDatabase,verifyDatabase} from './managed-databases';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {eq} from 'drizzle-orm';
import {db} from '../db';
import {compose,member} from '../db/schema';
import {deployCompose} from './compose';
import {findMemberByUserId} from './permission';
import {event,releaseSql,type Plan} from './release-store';
import {composeFingerprint,revalidate} from './release-service';
import {requireReviewer} from './release-policy';
const run=promisify(execFile),workerId=randomUUID();let busy=false;
async function docker(args:string[]){return (await run('docker',args,{timeout:30000,maxBuffer:8*1024*1024})).stdout;}
async function checkNewPort(port:number){
 const ids=(await docker(['service','ls','-q'])).trim().split(/\s+/).filter(Boolean);
 if(ids.length){const services=JSON.parse(await docker(['service','inspect',...ids]));if(services.some((s:any)=>s.Endpoint?.Ports?.some((p:any)=>p.PublishedPort===port)||s.Spec?.EndpointSpec?.Ports?.some((p:any)=>p.PublishedPort===port)))throw new Error('端口已被现有 Swarm 应用使用');}
 const containers=(await docker(['ps','--format','{{json .Ports}}'])).split('\n');if(containers.some(s=>s.includes(':'+port+'->')))throw new Error('端口已被现有容器使用');
}
async function convergence(appName:string,expected:Record<string,any>){
 const until=Date.now()+300000;let stable=0;
 while(Date.now()<until){
  const ids=(await docker(['service','ls','--filter','label=com.docker.stack.namespace='+appName,'-q'])).trim().split(/\s+/).filter(Boolean);
  if(ids.length){const services=JSON.parse(await docker(['service','inspect',...ids]));let ok=true;
   for(const [name,wanted] of Object.entries(expected)){
    const s=services.find((x:any)=>x.Spec?.Name===appName+'_'+name);if(!s||s.Spec.TaskTemplate.ContainerSpec.Image!==wanted.image){ok=false;break;}
    const lines=(await docker(['service','ps',s.ID,'--filter','desired-state=running','--format','{{.CurrentState}}'])).trim().split('\n').filter(Boolean);
    const replicas=wanted.deploy?.replicas??1;if(lines.length!==replicas||!lines.every(s=>s.startsWith('Running '))){ok=false;break;}
    if(s.UpdateStatus?.State?.includes('rollback')||s.UpdateStatus?.State?.includes('paused'))throw new Error('Swarm 更新暂停或发生回滚，请查看部署日志');
   }
   if(ok){if(!stable)stable=Date.now();if(Date.now()-stable>=12000)return;}else stable=0;
  }
  await delay(3000);
 }
 throw new Error('部署命令已结束，但服务副本未在规定时间内全部运行，请核对应用健康与日志');
}
async function execute(p:Plan){
 await revalidate(p);
 if(p.approved_hash!==p.plan_hash||!p.approved_by)throw new Error('没有匹配当前方案的确认记录');
 const reviewer=await findMemberByUserId(p.approved_by,p.organization_id);
 if(p.tier==='formal')requireReviewer(reviewer.role,p.created_by,p.approved_by);
 else if(p.approved_by!==p.created_by&&!['admin','owner'].includes(reviewer.role))throw new Error('确认人的权限已失效');
 await assertWrite({id:p.created_by,organizationId:p.organization_id});
 const c=p.payload.input.configuration;let current=await db.query.compose.findFirst({where:eq(compose.composeId,p.service_id),with:{domains:true,mounts:true}});
 if(c.kind==='web'||c.kind==='database'){
  if(current)throw new Error('待创建服务已存在，需要运维核对，未重复部署');
  if(c.kind==='web')await checkNewPort(c.publishedPort);else await prepareDatabase(p);
  await db.insert(compose).values({composeId:p.service_id,name:p.payload.serviceName,environmentId:p.environment_id,appName:'apphubrel-'+p.id.replaceAll('-','').slice(0,16),composeFile:p.payload.compose,sourceType:'raw',composeType:'stack',autoDeploy:false,env:'',command:'',serviceNetworks:Object.keys((await import('yaml')).parse(p.payload.compose).services).map(serviceName=>({serviceName,networkIds:[],detachDokployNetwork:true}))});
  current=await db.query.compose.findFirst({where:eq(compose.composeId,p.service_id),with:{domains:true,mounts:true}});
  if(p.tier==='test')await releaseSql`update member set "accesedServices"=array_append("accesedServices",${p.service_id}) where organization_id=${p.organization_id} and ${p.project_id}=any("accesedProjects") and ${p.environment_id}=any("accessedEnvironments") and not ${p.service_id}=any("accesedServices")`;
 }else{
  if(!current||composeFingerprint(current)!==p.base_hash)throw new Error('部署前配置发生变化，未执行');
  await db.update(compose).set({composeFile:p.payload.compose,serviceNetworks:Object.keys((await import('yaml')).parse(p.payload.compose).services).map(serviceName=>({serviceName,networkIds:[],detachDokployNetwork:true}))}).where(eq(compose.composeId,p.service_id));
 }
 if(!current)throw new Error('无法创建服务');
 if(p.payload.sandboxOrder){
  const zero=parseReleaseCompose(p.payload.compose);for(const service of Object.values(zero.services) as any[])service.deploy={...service.deploy,replicas:0};
  await db.update(compose).set({composeFile:stringifyReleaseCompose(zero)}).where(eq(compose.composeId,p.service_id));
 }
 await deployCompose({composeId:p.service_id,titleLog:'发布方案 '+p.id,descriptionLog:'配置摘要 '+p.plan_hash,freshVolumes:false});
 const wanted=parseReleaseCompose(p.payload.compose).services;
 if(p.payload.sandboxOrder){
  await db.update(compose).set({composeFile:p.payload.compose}).where(eq(compose.composeId,p.service_id));
  for(const level of [...p.payload.sandboxOrder,['preview_access']] as string[][]){
   const names=level.filter(n=>wanted[n]);if(!names.length)continue;
   if(names.some(n=>!/^[a-z][a-z0-9_-]{0,39}$/.test(n)))throw new Error('测试组件名称无效');
   await event(releaseSql,p.id,'system','starting_components',names.join('、'));
   await docker(['service','scale','--detach=true',...names.map(n=>current!.appName+'_'+n+'=1')]);
   await convergence(current.appName,Object.fromEntries(names.map(n=>[n,wanted[n]])));
  }
 }
 await convergence(current.appName,wanted);
 if(c.kind==='database'){let ready=false;for(let attempt=0;attempt<20;attempt++){try{await verifyDatabase(p);ready=true;break;}catch{await delay(3000);}}if(!ready)throw new Error('数据库或连接池 SQL 核验未通过，请查看服务日志；数据卷已保留');}
}
export async function releaseTick(){
 if(busy||!process.env.APPHUB_RELEASE_POLICY_FILE)return;busy=true;const conn=await releaseSql.reserve().catch(e=>{busy=false;throw e});let locked=false;
 try{
  const [lock]=await conn`select pg_try_advisory_lock(62928,1) as locked`;locked=!!lock?.locked;if(!locked)return;
  const stale=await conn<Plan[]>`update apphub_release_plan set status='needs_review',error='执行进程已中断，请运维检查实际部署结果；未自动重复发布',updated_at=now() where status='deploying' and worker_id<>${workerId} returning *`;
  for(const p of stale)await event(conn,p.id,'system','interrupted');
  const [p]=await conn<Plan[]>`update apphub_release_plan set status='deploying',worker_id=${workerId},updated_at=now() where id=(select id from apphub_release_plan where status='queued' order by created_at limit 1) and status='queued' returning *`;
  if(!p)return;
  await event(conn,p.id,'system','deploying');
  try{await execute(p);await conn`update apphub_release_plan set status='deployed',updated_at=now() where id=${p.id}`;await event(conn,p.id,'system','deployed');}
  catch(error){const message=error instanceof Error?error.message:'部署未完成';const safe=/密码|password|secret|token|postgres:\/\//i.test(message)?'部署失败，请运维查看技术日志':message.slice(0,600);await conn`update apphub_release_plan set status='failed',error=${safe},updated_at=now() where id=${p.id}`;await event(conn,p.id,'system','failed',safe);}
 }finally{if(locked)await conn`select pg_advisory_unlock(62928,1)`;conn.release();busy=false;}
}
export function startReleaseWorker(){const timer=setInterval(()=>void releaseTick().catch(()=>console.error('AppHub release worker could not read its queue')),3000);timer.unref();}
