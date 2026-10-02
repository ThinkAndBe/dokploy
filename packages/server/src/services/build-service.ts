import {validateStackArtifacts,prepareStackSecrets} from './stack-runtime';
import {recycleSchema} from './version-recycle';
import {inspectProjectTest} from './test-source';
import http from 'node:http';
import {randomUUID,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {eq} from 'drizzle-orm';
import {db} from '../db';
import {environments,compose} from '../db/schema';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {docker} from '../constants';
import {assertWrite} from './apphub-rbac';
import {previewProbe} from './preview-gateway';
import {previewOrigin} from './preview-policy';
import {encryptValue,decryptValue} from '../lib/encryption';
import {codeProject,browseCode,codeArchive} from './project-code';
import {repositoryVersions} from './apphub-versions';
import {requireInteractive,digest} from './release-policy';
import {submitPlan,decidePlan,type Actor} from './release-service';
import {buildSchema,sql} from './build-store';
import {buildManifest,redactBuildLog,validBuiltImage} from './build-policy';
const active=['queued','building','built','deploying'];
const codeActor=(a:Actor)=>({...a,name:'AppHub',email:'build@apphub.invalid'});
async function allowed(a:Actor,pid:string){return codeProject(codeActor(a),pid);}
function enabled(){if(process.env.APPHUB_BUILD_ENABLED!=='true')throw new Error('构建服务尚未启用');}
function prefix(){const p=process.env.APPHUB_BUILD_REGISTRY_PREFIX||'';if(!/^[a-zA-Z0-9][a-zA-Z0-9.:/_-]+$/.test(p))throw new Error('构建镜像仓库未配置');return p.replace(/\/+$/,'');}
export async function buildStatus(a:Actor,pid:string){
 requireInteractive(a.apiKey);await allowed(a,pid);await buildSchema();
 const [worker]=await sql`select last_seen,message from apphub_build_worker where id=${process.env.APPHUB_BUILD_WORKER_ID||'cluster-builder'}`;
 return {enabled:process.env.APPHUB_BUILD_ENABLED==='true',online:!!worker&&Date.now()-new Date(worker.last_seen).getTime()<60000,node:process.env.APPHUB_BUILD_TEST_NODE||'',storage:'项目独立持久卷',message:worker?.message||'等待构建执行器连接'};
}
async function ensureProject(a:Actor,pid:string){
 await buildSchema();const services=await docker.listServices();const used=new Set<number>();for(const s of services)for(const p of s.Endpoint?.Ports||[])if(p.PublishedPort)used.add(p.PublishedPort);
 return sql.begin(async q=>{await q`select pg_advisory_xact_lock(63001,2)`;const [prior]=await q`select * from apphub_build_project where project_id=${pid}`;if(prior)return prior;
 const rows=await q`select port from apphub_build_project`;for(const r of rows)used.add(r.port);
 const port=Array.from({length:100},(_,i)=>32060+i).find(p=>!used.has(p));if(!port)throw new Error('测试服务端口额度已用完，请管理员扩容');
 const eid='build-'+createHash('sha256').update(pid).digest('hex').slice(0,16);
 await db.insert(environments).values({environmentId:eid,projectId:pid,name:'自动测试',description:'AppHub 自动管理；用户从项目开始测试',isDefault:false}).onConflictDoNothing();
 await q`update member set "accessedEnvironments"=array_append("accessedEnvironments",${eid}) where organization_id=${a.organizationId} and ${pid}=any("accesedProjects") and not ${eid}=any("accessedEnvironments")`;
 const [p]=await q`insert into apphub_build_project(project_id,organization_id,environment_id,port) values(${pid},${a.organizationId},${eid},${port}) returning *`;return p!;
 });
}
export async function startBuild(a:Actor,input:{projectId:string;commit?:string;requestKey:string}){
 requireInteractive(a.apiKey);enabled();const project=await allowed(a,input.projectId);await buildSchema();
 const [prior]=await sql`select * from apphub_build_job where organization_id=${a.organizationId} and created_by=${a.id} and request_key=${input.requestKey}`;
 if(prior){if(prior.project_id!==input.projectId||(input.commit&&prior.commit_sha!==input.commit))throw new Error('请求标识已用于其他版本');return {id:prior.id};}
 const state=await buildStatus(a,input.projectId);if(!state.online)throw new Error('构建执行器当前离线，请稍后重试');
 let commit=input.commit;if(!commit){const v=await repositoryVersions(project.projectId,project.giteaRepoUrl!,1,a.organizationId);commit=v.commits[0]?.sha||v.tags[0]?.sha;}
 if(!commit||!/^[a-f0-9]{40}$/.test(commit))throw new Error('请先上传代码并保存版本');
 const compatibility=await inspectProjectTest(a,input.projectId,commit);
 if(!compatibility.runnable||!compatibility.manifest)throw new Error('测试配置未就绪：'+compatibility.issues.filter(i=>i.level==='error').map(i=>i.path+'：'+i.message).join('；'));
 const parsed=compatibility.manifest;if(parsed.type==='dotnet'&&parsed.entry?.endsWith('/Epos.Management.csproj'))parsed.storage={target:'/data'};
 const [last]=await sql`select manifest from apphub_build_job where project_id=${input.projectId} and status='ready' order by created_at desc limit 1`;
 if(last&&(last.manifest.port!==parsed.port||JSON.stringify(last.manifest.storage)!==JSON.stringify(parsed.storage)))throw new Error('测试服务端口或数据目录发生变化，请管理员调整已有服务后再测试');
 await ensureProject(a,input.projectId);await recycleSchema();
 return sql.begin(async q=>{await q`select pg_advisory_xact_lock(hashtext(${input.projectId}),63001)`;
 const [running]=await q`select * from apphub_build_job where project_id=${input.projectId} and status in ('queued','building','built','deploying') order by created_at desc limit 1`;
 if(running){if(running.commit_sha===commit)return {id:running.id};throw new Error('项目已有任务正在执行，请等待或取消该构建');}
 const id=randomUUID(),repository=prefix()+'/project-'+createHash('sha256').update(input.projectId).digest('hex').slice(0,20);
 await q`insert into apphub_build_job(id,project_id,organization_id,created_by,commit_sha,manifest,repository,request_key) values(${id},${input.projectId},${a.organizationId},${a.id},${commit},${q.json(parsed)},${repository},${input.requestKey})`;
 return {id};});
}
export async function listBuilds(a:Actor,pid:string){await allowed(a,pid);await buildSchema();return sql`select id,commit_sha,status,image,plan_id,error,created_at,updated_at,cancel_requested from apphub_build_job where project_id=${pid} and organization_id=${a.organizationId} order by created_at desc limit 30`;}
export async function buildDetail(a:Actor,id:string){await buildSchema();const [j]=await sql`select * from apphub_build_job where id=${id} and organization_id=${a.organizationId}`;if(!j)throw new Error('构建不存在或未授权');await allowed(a,j.project_id);
 let handoff:any=null;if(j.plan_id){const [p]=await sql`select payload from apphub_release_plan where id=${j.plan_id}`;handoff=p?.payload?.handoff;}
 return {id:j.id,projectId:j.project_id,commit:j.commit_sha,status:j.status,log:j.log,error:j.error,planId:j.plan_id,image:j.image,createdAt:j.created_at,updatedAt:j.updated_at,cancelRequested:j.cancel_requested,handoff};}
export async function cancelBuild(a:Actor,id:string){requireInteractive(a.apiKey);await buildDetail(a,id);const rows=await sql`update apphub_build_job set cancel_requested=true,status=case when status='building' then status else 'cancelled' end,updated_at=now() where id=${id} and status in ('queued','building','built') returning id`;if(!rows.length)throw new Error('当前任务已进入部署或结束，不能取消构建');return {ok:true};}
export async function testCredential(a:Actor,pid:string){requireInteractive(a.apiKey);await allowed(a,pid);await buildSchema();const [p]=await sql`select credentials from apphub_build_project where project_id=${pid}`;if(!p?.credentials)throw new Error('此应用没有平台生成的测试账号');await sql`insert into apphub_project_access_event(organization_id,project_id,actor,target,action) values(${a.organizationId},${pid},${a.id},${a.id},'view_test_credential')`;return JSON.parse(decryptValue(p.credentials));}
export async function workerAuth(value:unknown){enabled();const file=process.env.APPHUB_BUILD_TOKEN_FILE;if(!file||typeof value!=='string')return false;const expected=(await readFile(file,'utf8')).trim(),actual=value.replace(/^Bearer /,'');return expected.length>=32&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
async function leased(id:string,lease:string){const [j]=await sql`select * from apphub_build_job where id=${id} and lease=${lease} and status='building' and lease_until>now()`;if(!j)throw new Error('构建租约已失效，请停止执行');await allowed({id:j.created_by,organizationId:j.organization_id},j.project_id);return j;}
export async function workerSource(id:string,lease:string){await buildSchema();const j=await leased(id,lease);if(j.cancel_requested)throw new Error('任务已取消');return codeArchive(codeActor({id:j.created_by,organizationId:j.organization_id}),j.project_id,j.commit_sha);}
export async function workerAction(body:any){
 await buildSchema();const worker=process.env.APPHUB_BUILD_WORKER_ID||'cluster-builder';if(body.workerId!==worker)throw new Error('执行器未登记');
 await sql`insert into apphub_build_worker(id,message) values(${worker},${String(body.message||'集群构建执行器在线').slice(0,200)}) on conflict(id) do update set last_seen=now(),message=excluded.message`;
 if(body.action==='claim')return sql.begin(async q=>{await q`select pg_advisory_xact_lock(63001,3)`;
 await q`update apphub_build_job set status=case when cancel_requested then 'cancelled' else 'interrupted' end,error='构建执行器连接中断；未重复执行，可重新开始测试',updated_at=now() where status='building' and lease_until<now()`;
 const busy=await q`select id from apphub_build_job where status='building'`;if(busy.length)return null;
 const [j]=await q`select * from apphub_build_job where status='queued' order by created_at limit 1 for update skip locked`;if(!j)return null;
 try{await allowed({id:j.created_by,organizationId:j.organization_id},j.project_id);}catch{await q`update apphub_build_job set status='failed',error='项目权限已失效' where id=${j.id}`;return null;}
 const lease=randomBytes(32).toString('hex');await q`update apphub_build_job set status='building',lease=${lease},lease_until=now()+interval '90 seconds',worker_id=${worker},updated_at=now() where id=${j.id}`;
 return {id:j.id,lease,commit:j.commit_sha,manifest:j.manifest,repository:j.repository};});
 if(body.action==='heartbeat')return {ok:true};
 const j=await leased(body.id,body.lease);
 if(body.action==='progress'){
 const seq=Number(body.seq);if(!Number.isSafeInteger(seq)||seq<0)throw new Error('日志序号无效');
 const log=redactBuildLog(String(body.log||''));await sql`update apphub_build_job set log=case when log_seq<${seq} then ${log} else log end,log_seq=greatest(log_seq,${seq}),lease_until=now()+interval '90 seconds',updated_at=now() where id=${j.id} and lease=${body.lease} and status='building'`;
 return {cancel:!!j.cancel_requested};}
 if(body.action==='finish'){
 if(j.cancel_requested){await sql`update apphub_build_job set status='cancelled',updated_at=now() where id=${j.id} and status='building'`;return {ok:true};}
 const artifacts=j.manifest.type==='stack'?validateStackArtifacts(j.repository,j.manifest,body.artifacts):null;
 if(artifacts&&artifacts.app!.image!==body.image)throw new Error('主入口镜像与组件结果不一致');
 if(!validBuiltImage(String(body.image),j.repository))throw new Error('镜像摘要不属于本次构建仓库');
 await sql`update apphub_build_job set image=${body.image},artifacts=${artifacts?sql.json(artifacts):null},status='built',log=${redactBuildLog(String(body.log||''))},updated_at=now() where id=${j.id} and lease=${body.lease} and status='building'`;return {ok:true};}
 if(body.action==='fail'){await sql`update apphub_build_job set status=case when cancel_requested then 'cancelled' else 'failed' end,error=${redactBuildLog(String(body.error||'构建失败')).slice(-800)},log=${redactBuildLog(String(body.log||''))},updated_at=now() where id=${j.id} and lease=${body.lease} and status='building'`;return {ok:true};}
 throw new Error('未知构建操作');
}
let ticking=false;
async function runtime(j:any,p:any){
 if(j.manifest.type!=='dotnet'||!j.manifest.entry?.endsWith('/Epos.Management.csproj'))return;
 let credentials=p.credentials?JSON.parse(decryptValue(p.credentials)):null;
 if(!credentials){credentials={username:'admin',password:randomBytes(18).toString('base64url')};await sql`update apphub_build_project set credentials=${encryptValue(JSON.stringify(credentials))} where project_id=${j.project_id}`;}
 const secret='apphub-test-'+p.environment_id+'-admin';
 const existing=(await docker.listSecrets({filters:JSON.stringify({name:[secret]})})).find(s=>s.Spec?.Name===secret);
 if(existing){if(existing.Spec?.Labels?.['apphub.project']!==j.project_id)throw new Error('测试密钥名称冲突');}
 else await docker.createSecret({Name:secret,Labels:{'apphub.project':j.project_id},Data:Buffer.from(credentials.password).toString('base64')});
}
export async function buildTick(){
 if(ticking||process.env.APPHUB_BUILD_ENABLED!=='true')return;ticking=true;let conn:any,locked=false;
 try{await buildSchema();conn=await sql.reserve();const [lock]=await conn`select pg_try_advisory_lock(63001,4) as locked`;locked=!!lock.locked;if(!locked)return;
 const jobs=await sql`select * from apphub_build_job where status in ('built','deploying') order by created_at`;
 for(const j of jobs){try{
 const a={id:j.created_by,organizationId:j.organization_id};await assertWrite(a);await allowed(a,j.project_id);
 const [p]=await sql`select * from apphub_build_project where project_id=${j.project_id}`;if(!p)throw new Error('项目测试配置不存在');
 if(j.status==='built'){
 if(j.cancel_requested){await sql`update apphub_build_job set status='cancelled' where id=${j.id}`;continue;}
 await runtime(j,p);await prepareStackSecrets(j,p);
 const configuration=p.service_id?{kind:'update',serviceId:p.service_id,component:'app',image:j.image,replicas:1,...(j.manifest.type==='stack'?{buildJobId:j.id}:{})}:{kind:'web',name:'项目测试',image:j.image,containerPort:j.manifest.port,publishedPort:p.port,replicas:1,memoryMb:1024,loginMethod:j.manifest.login?'平台生成独立测试账号':j.manifest.entry?.endsWith('/Epos.Management.csproj')?'平台生成独立测试账号':'由应用管理登录',initialAccount:j.manifest.login?.username??(j.manifest.entry?.endsWith('/Epos.Management.csproj')?'admin':''),credentialHint:'测试账号可在项目测试详情中查看；与正式环境独立',buildJobId:j.id};
 const plan=await submitPlan(a,{environmentId:p.environment_id,title:'代码测试 '+j.commit_sha.slice(0,12),description:'固定代码版本 '+j.commit_sha,idempotencyKey:j.id,configuration});
 await sql`update apphub_build_job set plan_id=${plan.id} where id=${j.id}`;
 if(plan.status==='awaiting_confirmation')await decidePlan(a,plan.id,plan.hash,'confirm','用户从项目点击开始测试，自动构建后部署');
 await sql`update apphub_build_job set status='deploying',updated_at=now() where id=${j.id} and status='built'`;
 }else{
 const [plan]=await sql`select * from apphub_release_plan where id=${j.plan_id}`;if(!plan)throw new Error('测试部署记录不存在');
 if(['failed','needs_review','cancelled','rejected'].includes(plan.status)){const existing=await db.query.compose.findFirst({where:eq(compose.composeId,plan.service_id)});if(existing?.environmentId===p.environment_id)await sql`update apphub_build_project set service_id=${plan.service_id} where project_id=${j.project_id}`;throw new Error(plan.error||'测试部署未完成');}
 if(plan.status==='deployed'){
 await sql`update apphub_build_project set service_id=${plan.service_id} where project_id=${j.project_id}`;
 // The probe URL is derived from operator configuration, never from uploaded code.
 const host=process.env.APPHUB_BUILD_TEST_HOST||'';if(!/^[a-zA-Z0-9.-]+$/.test(host))throw new Error('测试入口未配置');
 const paths=[...new Set([j.manifest.health,...(j.manifest.entry?.endsWith('/Epos.Management.csproj')?['/login']:[])])];
 let healthy=false;for(let n=0;n<3;n++){healthy=true;for(const path of paths){try{const ok=await new Promise<boolean>(resolve=>{const r=http.get({hostname:host,port:p.port,path,headers:{Host:new URL(previewOrigin(p.environment_id)).host,'x-apphub-probe':previewProbe(j.project_id,path)}},reply=>{reply.resume();resolve((reply.statusCode||0)>=200&&(reply.statusCode||0)<400);});r.setTimeout(5000,()=>r.destroy());r.on('error',()=>resolve(false));});if(!ok)healthy=false;}catch{healthy=false;}}if(healthy)break;await new Promise(r=>setTimeout(r,1500));}
 if(!healthy)throw new Error('容器已运行，但健康或登录页面检查未通过，请查看运行日志');
 await sql.begin(async q=>{await q`update apphub_build_project set service_id=${plan.service_id} where project_id=${j.project_id}`;await q`update apphub_build_job set status='ready',updated_at=now() where id=${j.id} and status='deploying'`;});
 }
 }
 }catch(e){await sql`update apphub_build_job set status='failed',error=${redactBuildLog(e instanceof Error?e.message:'测试未完成').slice(-800)},updated_at=now() where id=${j.id} and status in ('built','deploying')`;}}
 }finally{if(locked)await conn`select pg_advisory_unlock(63001,4)`;conn?.release();ticking=false;}
}
export function startBuildWorker(){const timer=setInterval(()=>void buildTick().catch(()=>console.error('AppHub build queue unavailable')),3000);timer.unref();}

export async function buildRuntimeLog(a:Actor,id:string){
 const j=await buildDetail(a,id);if(!j.planId)return {log:'测试服务尚未创建'};
 const [p]=await sql`select service_id from apphub_release_plan where id=${j.planId}`;
 const service=p&&await db.query.compose.findFirst({where:eq(compose.composeId,p.service_id)});
 if(!service)return {log:'测试服务尚未创建'};
 try{
  const document=(await import('./release-compose-policy')).parseReleaseCompose(service.composeFile),names=Object.keys(document.services);
  const logs=await Promise.all(names.map(async name=>{if(!/^[a-z][a-z0-9_-]{0,39}$/.test(name))throw new Error('组件名称无效');try{const r=await promisify(execFile)('docker',['service','logs','--tail','80','--timestamps',service.appName+'_'+name],{timeout:15000,maxBuffer:512*1024});return '['+name+']\n'+r.stdout+'\n'+r.stderr;}catch{return '['+name+'] 暂时无法读取组件日志';}}));
  let text=logs.join('\n');const [bp]=await sql`select stack_secrets from apphub_build_project where project_id=${j.projectId}`;
  if(bp?.stack_secrets)for(const secret of Object.values(JSON.parse(decryptValue(bp.stack_secrets))) as string[])text=text.split(secret).join('[已隐藏]');
  return {log:redactBuildLog(text)};
 }catch{return {log:'暂时无法读取运行日志，请稍后重试'};}

}
