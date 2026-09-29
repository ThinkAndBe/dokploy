import {databaseCompose,databaseIdentity} from './database-policy';
import {databaseCredential,databaseStats} from './managed-databases';
import {randomUUID} from 'node:crypto';
import {parse,stringify} from 'yaml';
import {eq,and} from 'drizzle-orm';
import {db} from '../db';
import {compose,environments,projects,member} from '../db/schema';
import {findMemberByUserId} from './permission';
import {readHandoff} from './apphub-handoff';
import {digest,generatedWebCompose,releaseInput,releaseTargets,requireInteractive,requireReviewer,validateConfiguration,type ReleaseInput,type ReleaseTarget} from './release-policy';
import {releaseSql,event,insertPlan,visiblePlan,type Plan} from './release-store';
export type Actor={id:string;organizationId:string;apiKey?:unknown};
export async function authorizeTarget(a:Actor,id:string){
 const t=(await releaseTargets()).find(t=>t.environmentId===id&&t.organizationId===a.organizationId);
 if(!t)throw new Error('目标环境尚未由运维开放配置方案');
 const m=await findMemberByUserId(a.id,a.organizationId),admin=['owner','admin'].includes(m.role);
 if(!admin&&(!m.accessedProjects.includes(t.projectId)||!m.accessedEnvironments.includes(t.tier==='formal'?t.testEnvironmentId||'':id)))throw new Error('没有目标项目或测试环境权限');
 const e=await db.query.environments.findFirst({where:eq(environments.environmentId,id),with:{project:true}});
 if(!e||e.projectId!==t.projectId||e.project.organizationId!==a.organizationId)throw new Error('环境归属发生变化，请联系运维');
 return {target:t,member:m,admin};
}
export async function catalog(a:Actor){
 const list=[];
 for(const t of await releaseTargets()){if(t.organizationId!==a.organizationId)continue;try{const {member:m,admin}=await authorizeTarget(a,t.environmentId);const e=await db.query.environments.findFirst({where:eq(environments.environmentId,t.environmentId),with:{project:true}});const services=[];
 for(const id of t.serviceIds){if(t.tier==='test'&&!admin&&!m.accessedServices.includes(id))continue;const c=await db.query.compose.findFirst({where:eq(compose.composeId,id)});if(c&&c.environmentId===t.environmentId){const doc=parse(c.composeFile);services.push({id,name:c.name,components:Object.entries(doc?.services??{}).map(([name,v]:[string,any])=>({name,image:v.image,replicas:v.deploy?.replicas??1}))});}}
 list.push({...t,environmentName:e?.name,projectName:e?.project.name,services});}catch{}}
 return list;
}
export const composeFingerprint=(c:any)=>digest({composeFile:c.composeFile,sourceType:c.sourceType,composeType:c.composeType,serverId:c.serverId,appName:c.appName,env:c.env,command:c.command,autoDeploy:c.autoDeploy,randomize:c.randomize,isolatedDeployment:c.isolatedDeployment,serviceNetworks:c.serviceNetworks,createEnvFile:c.createEnvFile,domains:c.domains,mounts:c.mounts});
async function testedSource(a:Actor,input:ReleaseInput,t:ReleaseTarget){
 if(t.tier!=='formal')return;
 if(!input.testedPlanId)throw new Error('正式方案必须关联已成功部署的测试方案');
 const [p]=await releaseSql<Plan[]>`select * from apphub_release_plan where id=${input.testedPlanId} and organization_id=${a.organizationId}`;
 if(!p||p.project_id!==t.projectId||p.environment_id!==t.testEnvironmentId||p.tier!=='test'||p.status!=='deployed'||p.payload.input.configuration.image!==input.configuration.image||p.payload.input.configuration.kind!==input.configuration.kind||(input.configuration.kind==='database'&&(p.payload.input.configuration.engine!==input.configuration.engine||p.payload.input.configuration.poolImage!==input.configuration.poolImage)))throw new Error('测试方案未通过或镜像摘要与正式方案不一致');
}
export async function submitPlan(a:Actor,raw:unknown){
 const input=releaseInput.parse(raw),{target:t,member:m,admin}=await authorizeTarget(a,input.environmentId);if(t.tier==='formal'&&!admin)throw new Error('生产发布由管理员处理，请从已完成的测试版本提交上线申请');validateConfiguration(input.configuration,t);await testedSource(a,input,t);
 const id=randomUUID(),c=input.configuration;let baseHash='new',serviceId='rel-'+id;let document:any;let diff:any[]=[];let handoff:any;let serviceName=input.title;
 if(c.kind==='update'){
  if(t.tier==='test'&&!admin&&!m.accessedServices.includes(c.serviceId))throw new Error('没有目标应用权限');
  const before=await db.query.compose.findFirst({where:eq(compose.composeId,c.serviceId),with:{domains:true,mounts:true}});
  if(!before||before.environmentId!==t.environmentId||before.sourceType!=='raw'||before.composeType!=='stack'||before.serverId||before.command)throw new Error('仅支持运维批准的本机 raw Swarm 编排');
  document=parse(before.composeFile,{maxAliasCount:0});if(!document?.services?.[c.component])throw new Error('目标组件不存在');
  if(before.autoDeploy)throw new Error('请先由运维关闭该应用的自动触发部署');
  baseHash=composeFingerprint(before);serviceId=c.serviceId;serviceName=before.name;
  const component=document.services[c.component];diff.push({field:c.component+'.image',before:component.image,after:c.image});component.image=c.image;
  if(c.replicas!==undefined){diff.push({field:c.component+'.replicas',before:component.deploy?.replicas??1,after:c.replicas});component.deploy={...component.deploy,replicas:c.replicas};}
  handoff=await readHandoff(serviceId)??{title:before.name,loginUrl:null,loginMethod:'请应用负责人补齐登录说明',account:'',credentialHint:'请联系运维领取',settings:[],notes:[]};
 }else if(c.kind==='database'){
  document=databaseCompose(c,id,t.databaseNode!);serviceName=c.name;const identity=databaseIdentity(id);
  diff=[{field:'数据库类型',before:'无',after:c.engine},{field:'数据库',before:'无',after:c.databaseName},{field:'连接池/客户端上限',before:'无',after:`${c.poolSize} / ${c.maxClients}`},{field:'持久化节点',before:'无',after:t.databaseNode}];
  handoff={title:c.name,loginUrl:null,loginMethod:'通过项目专用连接池访问；无需开放数据库公网端口',account:identity.user,credentialHint:'凭据自动生成；在数据库服务页面查看或通过应用绑定注入',settings:[{label:'连接池地址',value:identity.host},{label:'数据库',value:c.databaseName}],notes:['单实例持久化；节点故障需恢复，不代表主备高可用。','连接池默认会话兼容模式，自动限制连接与回收空闲后端连接。']};
 }else{
  document=generatedWebCompose(c);serviceName=c.name;
  if(c.databasePlanId){const source=await bindingSource(a,c.databasePlanId,input.environmentId);const d=databaseIdentity(source.id);document.networks.database={external:true,name:d.network};document.services.app.networks.push('database');document.secrets={database_url:{external:true,name:d.secret+'-url'}};document.services.app.secrets=[{source:'database_url',target:'database_url'}];document.services.app.environment.DATABASE_URL_FILE='/run/secrets/database_url';}
  diff=[{field:'新增应用',before:'无',after:c.name},{field:'镜像',before:'无',after:c.image},{field:'端口',before:'无',after:`${c.publishedPort} → ${c.containerPort}`},{field:'副本/内存',before:'无',after:`${c.replicas} / ${c.memoryMb} MB`}];
  handoff={title:c.name,loginUrl:`http://${t.hostname}:${c.publishedPort}`,loginMethod:c.loginMethod,account:c.initialAccount,credentialHint:c.credentialHint,settings:[],notes:['本应用由审核后的固定镜像部署；业务登录账号仍由应用维护。']};
 }
 handoff={...handoff,settings:[...(handoff.settings??[]).filter((r:any)=>r.label!=='本次镜像摘要'&&r.label!=='发布方案'),{label:'本次镜像摘要',value:c.image},{label:'发布方案',value:id}],updatedAt:new Date().toISOString()};
 const payload={input,requestHash:digest(input),compose:stringify(document),serviceName,diff,handoff,policyHash:digest(t),baseHash};
 return visiblePlan(await insertPlan({id,organization_id:a.organizationId,project_id:t.projectId,environment_id:t.environmentId,service_id:serviceId,created_by:a.id,title:input.title,tier:t.tier,status:t.tier==='test'?'awaiting_confirmation':'awaiting_approval',plan_hash:digest(payload),base_hash:baseHash,payload},input.idempotencyKey));
}
export async function accessiblePlan(a:Actor,id:string){const [p]=await releaseSql<Plan[]>`select * from apphub_release_plan where id=${id} and organization_id=${a.organizationId}`;if(!p)throw new Error('方案不存在或未授权');const access=await authorizeTarget(a,p.environment_id);if(!access.admin&&p.created_by!==a.id&&p.tier==='test'&&!access.member.accessedServices.includes(p.service_id))throw new Error('方案不存在或未授权');return {plan:p,...access};}
export async function listPlans(a:Actor){const rows=await releaseSql<Plan[]>`select * from apphub_release_plan where organization_id=${a.organizationId} order by created_at desc limit 100`;const result=[];for(const p of rows){try{await accessiblePlan(a,p.id);result.push(visiblePlan(p));}catch{}}return result;}
export async function detailPlan(a:Actor,id:string){const {plan:p,admin}=await accessiblePlan(a,id);const events=await releaseSql`select actor,action,note,created_at from apphub_release_event where plan_id=${id} order by id`;return {...visiblePlan(p),events,canApprove:admin&&p.created_by!==a.id&&!a.apiKey,canConfirm:!a.apiKey&&(admin||p.created_by===a.id)};}
export async function revalidate(p:Plan){
 if(digest(p.payload)!==p.plan_hash)throw new Error('方案内容校验失败');
 const a={id:p.created_by,organizationId:p.organization_id};const {target:t,member:m,admin}=await authorizeTarget(a,p.environment_id);
 if(digest(t)!==p.payload.policyHash)throw new Error('环境策略已修改，请重新提交方案');
 validateConfiguration(p.payload.input.configuration,t);if(p.payload.input.configuration.kind==='web'&&p.payload.input.configuration.databasePlanId)await bindingSource(a,p.payload.input.configuration.databasePlanId,p.environment_id);await testedSource(a,p.payload.input,t);
 if(p.payload.input.configuration.kind==='update'){
  if(p.tier==='test'&&!admin&&!m.accessedServices.includes(p.service_id))throw new Error('应用授权已被撤销');
  const c=await db.query.compose.findFirst({where:eq(compose.composeId,p.service_id),with:{domains:true,mounts:true}});if(!c||composeFingerprint(c)!==p.base_hash)throw new Error('应用配置已变化，请重新提交并核对差异');
 }
 return t;
}
export async function decidePlan(a:Actor,id:string,hash:string,action:'confirm'|'approve'|'reject'|'cancel',note:string){
 requireInteractive(a.apiKey);const access=await accessiblePlan(a,id);const p=access.plan;
 if(p.plan_hash!==hash)throw new Error('方案版本已变化，请重新打开详情');
 if(action==='approve')requireReviewer(access.member.role,p.created_by,a.id);
 if(action==='confirm'&&(p.tier!=='test'||(!access.admin&&p.created_by!==a.id)))throw new Error('只有方案提交人或运维能确认测试部署');
 if(action==='reject'&&(!access.admin||p.tier!=='formal'))throw new Error('只有运维能拒绝正式方案');
 if(action==='cancel'&&!access.admin&&p.created_by!==a.id)throw new Error('只能取消自己的方案');
 const next=action==='reject'?'rejected':action==='cancel'?'cancelled':'queued';
 if(next==='queued')await revalidate(p);
 return releaseSql.begin(async q=>{
  await q`select pg_advisory_xact_lock(hashtext(${p.service_id}))`;
  const [current]=await q<Plan[]>`select * from apphub_release_plan where id=${id} for update`;
  if(!current||current.plan_hash!==hash||!['awaiting_confirmation','awaiting_approval'].includes(current.status))throw new Error('方案已处理，不能重复执行');
  if(action==='approve'&&current.status!=='awaiting_approval'||action==='confirm'&&current.status!=='awaiting_confirmation')throw new Error('操作与方案阶段不匹配');
  if(next==='queued'){
   const busy=await q`select id from apphub_release_plan where service_id=${p.service_id} and status in ('queued','deploying')`;
   if(busy.length)throw new Error('应用已有部署任务，请等待完成');
  }
  await q`update apphub_release_plan set status=${next},approved_by=${a.id},approved_hash=${hash},updated_at=now() where id=${id}`;
  await event(q,id,a.id,action,note);return {status:next};
 });
}

async function bindingSource(a:Actor,id:string,environmentId:string){const {plan:p}=await accessiblePlan(a,id);if(p.status!=='deployed'||p.environment_id!==environmentId||p.payload.input.configuration.kind!=='database')throw new Error('只能绑定当前环境中已部署且有权限的数据库');return p;}
export async function listDatabases(a:Actor){const rows=await listPlans(a);return rows.filter(p=>p.configuration.kind==='database');}
export async function inspectDatabase(a:Actor,id:string){const {plan:p}=await accessiblePlan(a,id);if(p.status!=='deployed'||p.payload.input.configuration.kind!=='database')throw new Error('数据库尚未部署完成');return databaseStats(p);}
export async function revealDatabase(a:Actor,id:string){requireInteractive(a.apiKey);const {plan:p}=await accessiblePlan(a,id);if(p.status!=='deployed'||p.payload.input.configuration.kind!=='database')throw new Error('数据库尚未部署完成');await event(releaseSql,id,a.id,'reveal_database','交互页面查看项目数据库凭据');return databaseCredential(p);}
