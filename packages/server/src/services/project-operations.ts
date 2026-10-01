import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {eq,and} from 'drizzle-orm';
import {db} from '../db';
import {projects,environments} from '../db/schema';
import {docker} from '../constants';
import {findMemberByUserId} from './permission';
import {accessScope,safeAppUrl} from './apphub-access';
import {readHandoff} from './apphub-handoff';
import {releaseTargets,requireInteractive} from './release-policy';
import {releaseSql as sql} from './release-store';
import {buildSchema} from './build-store';
import type {Actor} from './release-service';
import {resourceTier,serviceChange,backupArguments,backupMarker,type Tier} from './operations-policy';

type Binding={id:string;organizationId:string;projectId:string;environmentId:string;service:string;name:string;engine:'postgres'|'mysql';database:string;shared:boolean};
type Resource={key:string;name:string;tier:Tier;environmentId:string;composeId:string|null;service:string;shared:boolean;database?:{engine:'postgres'|'mysql';name:string};url:string|null;info:any;tasks:any[];nodes:Map<string,any>};
let init:Promise<void>|undefined;
function schema(){return init??=(async()=>{await buildSchema();await sql`create table if not exists apphub_project_operation(id uuid primary key,organization_id text not null,project_id text not null,resource_key text not null,actor text not null,action text not null,status text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now())`;})().catch(e=>{init=undefined;throw e;});}
async function authorize(a:Actor,pid:string,adminOnly=false){
 requireInteractive(a.apiKey);const m=await findMemberByUserId(a.id,a.organizationId),scope=accessScope(m);
 const p=await db.query.projects.findFirst({where:and(eq(projects.projectId,pid),eq(projects.organizationId,a.organizationId)),columns:{projectId:true,name:true}});
 if(!p||!scope.project(pid)||adminOnly&&!scope.admin)throw new Error(adminOnly?'仅项目所属组织的管理员可以管理运行资源':'项目不存在或未授权');
 await schema();return {project:p,scope};
}
async function bindings():Promise<Binding[]>{try {return JSON.parse(await readFile(process.env.APPHUB_PROJECT_RESOURCES_FILE||'/etc/dokploy/apphub/project-resources.json','utf8'));}catch(e:any){if(e.code==='ENOENT')return [];throw new Error('项目资源关联配置无法读取');}}
async function resources(a:Actor,pid:string){
 const auth=await authorize(a,pid),targets=(await releaseTargets()).filter(t=>t.organizationId===a.organizationId&&t.projectId===pid);
 const envs=await db.query.environments.findMany({where:eq(environments.projectId,pid),with:{compose:true}});
 const [services,tasks,nodes,plans]=await Promise.all([docker.listServices(),docker.listTasks(),docker.listNodes(),sql`select distinct on(service_id) service_id,payload from apphub_release_plan where project_id=${pid} and organization_id=${a.organizationId} and status='deployed' order by service_id,updated_at desc`]);
 const nodeMap=new Map(nodes.map(n=>[n.ID!,n])),result:Resource[]=[];
 for(const e of envs){
  const tier=resourceTier(e.environmentId,targets);
  for(const c of e.compose){
   if(c.serverId)continue;
   const formalAccess=tier==='formal'&&targets.some(t=>t.environmentId===e.environmentId&&t.testEnvironmentId&&auth.scope.environment(t.testEnvironmentId));
   if(!auth.scope.admin&&!formalAccess&&(!auth.scope.environment(e.environmentId)||!auth.scope.service(c.composeId)))continue;
   const plan=plans.find(p=>p.service_id===c.composeId),conf=plan?.payload?.input?.configuration;
   const h=plan?.payload?.handoff??await readHandoff(c.composeId);
   const owned=services.filter(s=>s.Spec?.Labels?.['com.docker.stack.namespace']===c.appName);
   if(!owned.length)result.push({key:c.composeId,name:c.name,tier,environmentId:e.environmentId,composeId:c.composeId,service:c.appName,shared:false,url:safeAppUrl(h?.loginUrl),info:null,tasks:[],nodes:nodeMap});
   for(const s of owned){const component=s.Spec!.Name!.slice(c.appName.length+1);result.push({key:c.composeId+':'+component,name:c.name+' / '+component,tier,environmentId:e.environmentId,composeId:c.composeId,service:s.Spec!.Name!,shared:false,database:conf?.kind==='database'&&component==='database'?{engine:conf.engine,name:conf.databaseName}:undefined,url:conf?.kind==='database'?null:safeAppUrl(h?.loginUrl),info:s,tasks:tasks.filter(t=>t.ServiceID===s.ID),nodes:nodeMap});}
  }
 }
 for(const b of await bindings()){
  if(b.organizationId!==a.organizationId||b.projectId!==pid||!envs.some(e=>e.environmentId===b.environmentId))continue;
  if(!auth.scope.admin)continue;
  const s=services.find(s=>s.Spec?.Name===b.service);
  result.push({key:'linked:'+b.id,name:b.name,tier:resourceTier(b.environmentId,targets),environmentId:b.environmentId,composeId:null,service:b.service,shared:b.shared,database:{engine:b.engine,name:b.database},url:null,info:s??null,tasks:s?tasks.filter(t=>t.ServiceID===s.ID):[],nodes:nodeMap});
 }
 return {...auth,resources:result};
}
function visible(r:Resource,details:boolean){
 const desired=r.info?.Spec?.Mode?.Replicated?.Replicas??null,current=r.tasks.filter(t=>t.DesiredState==='running'),running=current.filter(t=>t.Status?.State==='running').length;
 const state=!r.info?'missing':desired===0?'stopped':desired!==null&&running===desired?'running':'pending';
 const common={key:r.key,name:r.name,tier:r.tier,environmentId:r.environmentId,composeId:r.composeId,state,desired,running,url:r.url,database:r.database??null,shared:r.shared};
 if(!details)return common;
 const configured=r.info?.Spec?.TaskTemplate?.ContainerSpec?.Env??[];
 const storageMode=configured.includes('EPOS_SERVICE_MODE=report')?(configured.some((v:string)=>v.startsWith('EPOS_DATABASE=')||v.startsWith('EPOS_DATABASE_FILE='))?'PostgreSQL 连接已配置':'文件存储模式，未连接独立数据库'):null;
 return {...common,storageMode,service:r.service,version:r.info?.Version?.Index??0,image:r.info?.Spec?.TaskTemplate?.ContainerSpec?.Image??null,mounts:(r.info?.Spec?.TaskTemplate?.ContainerSpec?.Mounts??[]).map((m:any)=>({type:m.Type,source:m.Source??'',target:m.Target,readOnly:!!m.ReadOnly})),tasks:r.tasks.slice().sort((a,b)=>String(b.CreatedAt).localeCompare(String(a.CreatedAt))).slice(0,12).map(t=>({id:t.ID,containerId:t.Status?.ContainerStatus?.ContainerID??null,node:r.nodes.get(t.NodeID)?.Description?.Hostname??t.NodeID,address:r.nodes.get(t.NodeID)?.Status?.Addr??null,state:t.Status?.State,desired:t.DesiredState,exitCode:t.Status?.ContainerStatus?.ExitCode??null,updatedAt:t.UpdatedAt})),health:r.info?.Spec?.TaskTemplate?.ContainerSpec?.Healthcheck?'已配置容器健康检查':'未配置容器健康检查'};
}
export async function projectSummary(a:Actor,pid:string){const {project,resources:rows,scope}=await resources(a,pid);return {project,admin:scope.admin,resources:rows.filter(r=>scope.admin||(!r.database&&!r.service.endsWith('_preview_access'))).map(r=>({...visible(r,false),canReadHandoff:!!r.composeId&&scope.environment(r.environmentId)&&scope.service(r.composeId)})),checkedAt:new Date().toISOString()};}
async function selected(a:Actor,pid:string,key:string){await authorize(a,pid,true);const all=await resources(a,pid),r=all.resources.find(r=>r.key===key);if(!r||!r.info)throw new Error('关联服务不存在或已变更，请刷新');return r;}
function decodeLogs(data:any){if(typeof data==='string')return data;if(!Buffer.isBuffer(data))return '';let out='';for(let i=0;i+8<=data.length;){const n=data.readUInt32BE(i+4);if(n>data.length-i-8)break;out+=data.subarray(i+8,i+8+n).toString();i+=8+n;}return out;}
async function reconcile(a:Actor,pid:string){
 const jobs=await sql`select * from apphub_project_operation where project_id=${pid} and organization_id=${a.organizationId} and action='backup' and status in ('queued','running','needs_review')`;
 for(const job of jobs){
  try{const s=await docker.getService(job.payload.job).inspect();if(s.Spec.Labels?.['apphub.operation']!==job.id)continue;
   const tasks=await docker.listTasks({filters:JSON.stringify({service:[s.ID]})}),t=tasks[0];if(!t)continue;
   let status='running',meta:any={};
   if(t.Status?.State==='complete'&&t.Status.ContainerStatus?.ExitCode===0){try{meta=backupMarker(decodeLogs(await docker.getService(s.ID).logs({stdout:true,stderr:false,tail:20})));status='succeeded';}catch{status='failed';}}
   else if(['failed','rejected','shutdown','orphaned'].includes(t.Status?.State??''))status='failed';
   else if(Date.now()-new Date(job.created_at).getTime()>30*60000)status='failed';
   await sql`update apphub_project_operation set status=${status},payload=payload||${sql.json(meta)},updated_at=now() where id=${job.id}`;
   if(['succeeded','failed'].includes(status))await docker.getService(s.ID).remove();
  }catch(e:any){if(e.statusCode===404&&Date.now()-new Date(job.created_at).getTime()>60000)await sql`update apphub_project_operation set status='needs_review',updated_at=now() where id=${job.id}`;}
 }
}
export async function projectOperations(a:Actor,pid:string){await authorize(a,pid,true);await reconcile(a,pid);const all=await resources(a,pid);const events=await sql`select o.id,o.resource_key,o.actor,nullif(trim(concat_ws(' ',u."firstName",u."lastName")),'') as actor_name,u.email as actor_email,o.action,o.status,o.payload,o.created_at,o.updated_at from apphub_project_operation o left join "user" u on u.id=o.actor where o.project_id=${pid} and o.organization_id=${a.organizationId} order by o.created_at desc limit 50`;return {project:all.project,resources:all.resources.map(r=>visible(r,true)),events,checkedAt:new Date().toISOString()};}
export async function operateService(a:Actor,input:{projectId:string;key:string;action:'start'|'stop'|'restart';version:number;confirmation:string;requestId:string}){
 const r=await selected(a,input.projectId,input.key);if(r.tier==='unknown')throw new Error('环境用途未登记，禁止变更服务');
 if(input.confirmation!==r.service)throw new Error('请填写服务名称确认操作范围');
 const [lastStop]=await sql`select payload from apphub_project_operation where project_id=${input.projectId} and organization_id=${a.organizationId} and resource_key=${input.key} and action='stop' and status='accepted' order by created_at desc limit 1`;
 const spec=serviceChange(r.info.Spec,input.action,r.shared,lastStop?.payload?.previousReplicas||1);if(r.info.Version.Index!==input.version)throw new Error('服务状态已变化，请刷新后重试');
 const busy=await sql`select id from apphub_build_job where project_id=${input.projectId} and status in ('queued','building','built','deploying') union all select id::uuid from apphub_release_plan where project_id=${input.projectId} and status in ('queued','deploying')`;
 if(busy.length)throw new Error('项目正在部署，请等待完成再管理运行状态');
 const [row]=await sql`insert into apphub_project_operation(id,organization_id,project_id,resource_key,actor,action,status,payload) values(${input.requestId},${a.organizationId},${input.projectId},${input.key},${a.id},${input.action},'requested',${sql.json({service:r.service,tier:r.tier,previousReplicas:r.info.Spec.Mode.Replicated.Replicas})}) on conflict do nothing returning id`;
 if(!row)throw new Error('该操作请求已处理，请刷新记录，不要重复提交');
 try{await docker.getService(r.info.ID).update({version:r.info.Version.Index,...spec});await sql`update apphub_project_operation set status='accepted',updated_at=now() where id=${row.id}`;return {id:row.id};}catch{await sql`update apphub_project_operation set status='needs_review',updated_at=now() where id=${row.id}`;throw new Error('操作结果未确认，请刷新容器状态；不要重复操作');}
}
export async function resourceLogs(a:Actor,pid:string,key:string){const r=await selected(a,pid,key);if(r.shared)throw new Error('共享实例日志可能包含其他项目，请由集群运维统一查看');const raw=decodeLogs(await docker.getService(r.info.ID).logs({stdout:true,stderr:true,tail:100,timestamps:true}));return {log:raw.slice(-40000).replace(/(password|secret|token|authorization)(\s*[=:]\s*)[^\s,;]+/gi,'$1$2[已隐藏]').replace(/(\w+:\/\/[^\s:/]+:)[^@\s]+@/g,'$1[已隐藏]@'),checkedAt:new Date().toISOString()};}
const backupScript=`set -eu
umask 077
engine="$1"; host="$2"; database="$3"; user="$4"; password_file="$5"; id="$6"
mkdir -p /backup
if [ "$engine" = postgres ]; then
 export PGPASSWORD="$(cat "$password_file")" PGCONNECT_TIMEOUT=15
 pg_dump -h "$host" -U "$user" -d "$database" -Fc --no-owner --no-acl -f "/backup/$id.partial"
 pg_restore --list "/backup/$id.partial" >/dev/null
else
 export MYSQL_PWD="$(cat "$password_file")"
 mysqldump -h "$host" -u "$user" --single-transaction --no-tablespaces --routines --events --triggers "$database" > "/backup/$id.partial"
 test -s "/backup/$id.partial"
fi
mv "/backup/$id.partial" "/backup/$id.backup"
hash=$(sha256sum "/backup/$id.backup" | cut -d ' ' -f 1)
size=$(wc -c < "/backup/$id.backup" | tr -d ' ')
printf 'APPHUB_BACKUP_OK %s %s\\n' "$hash" "$size"
`;
export async function backupDatabase(a:Actor,input:{projectId:string;key:string;requestId:string}){
 const r=await selected(a,input.projectId,input.key);if(!r.database||r.tier==='unknown')throw new Error('该资源未登记可备份的数据库');
 const live=r.tasks.filter(t=>t.DesiredState==='running'&&t.Status?.State==='running');if(live.length!==1)throw new Error('当前只支持单副本数据库的在线逻辑备份');
 const cs=r.info.Spec.TaskTemplate.ContainerSpec,env=Object.fromEntries((cs.Env??[]).map((e:string)=>[e.slice(0,e.indexOf('=')),e.slice(e.indexOf('=')+1)]));
 const pg=r.database.engine==='postgres',user=pg?env.POSTGRES_USER:env.MYSQL_USER,file=pg?env.POSTGRES_PASSWORD_FILE:env.MYSQL_PASSWORD_FILE;
 if(!user||!file)throw new Error('数据库未提供可用的备份账号与 Secret 文件，请运维登记后再备份');
 const args=backupArguments(r.database.engine,r.service,r.database.name,user,file),secret=cs.Secrets?.find((s:any)=>'/run/secrets/'+s.File?.Name===file);
 if(!secret)throw new Error('备份账号没有对应的 Docker Secret');
 const node=r.nodes.get(live[0]!.NodeID),suffix=createHash('sha256').update(a.organizationId+':'+input.projectId).digest('hex').slice(0,16),volume='apphub-backups-'+suffix,job='apphubbackup-'+input.requestId.replaceAll('-','');
 const payload={job,service:r.service,tier:r.tier,engine:r.database.engine,database:r.database.name,volume,node:node?.Description?.Hostname,address:node?.Status?.Addr,file:input.requestId+'.backup',path:volume+':/'+input.requestId+'.backup',scope:'仅数据库逻辑备份，不含报告附件文件',verification:pg?'pg_restore 目录校验 + SHA256':'非空检查 + SHA256；需恢复演练验证'};
 await sql.begin(async q=>{await q`select pg_advisory_xact_lock(hashtext(${a.organizationId+':'+r.service}),63002)`;const existing=await q`select id from apphub_project_operation where organization_id=${a.organizationId} and action='backup' and payload->>'service'=${r.service} and status in ('queued','running')`;if(existing.length)throw new Error('该数据库已有备份任务，请等待完成');await q`insert into apphub_project_operation(id,organization_id,project_id,resource_key,actor,action,status,payload) values(${input.requestId},${a.organizationId},${input.projectId},${input.key},${a.id},'backup','queued',${q.json(payload)})`;});
 try{await docker.createService({Name:job,Labels:{'apphub.operation':input.requestId,'apphub.organization':a.organizationId,'apphub.project':input.projectId},Mode:{Replicated:{Replicas:1}},TaskTemplate:{ContainerSpec:{Image:cs.Image,Command:['sh','-c',backupScript,'backup',...args,input.requestId],Secrets:[secret],Mounts:[{Type:'volume',Source:volume,Target:'/backup'}],ReadOnly:true},Networks:r.info.Spec.TaskTemplate.Networks?.map((n:any)=>({Target:n.Target})),Placement:{Constraints:['node.id == '+live[0]!.NodeID]},RestartPolicy:{Condition:'none'},Resources:{Limits:{NanoCPUs:500000000,MemoryBytes:536870912}}},EndpointSpec:{Mode:'dnsrr'}});return {id:input.requestId};}catch{await sql`update apphub_project_operation set status='needs_review',updated_at=now() where id=${input.requestId}`;throw new Error('备份任务提交结果未确认，请管理员核对任务记录');}
}
