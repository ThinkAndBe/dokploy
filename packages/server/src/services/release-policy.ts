import {databaseSchema} from './database-policy';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';

export const webSchema=z.object({kind:z.literal('web'),name:z.string().min(1).max(80),image:z.string().max(300),containerPort:z.number().int().min(1).max(65535),publishedPort:z.number().int().min(1024).max(65535),replicas:z.number().int().min(1).max(3).default(1),memoryMb:z.number().int().min(128).max(2048).default(512),databasePlanId:z.string().uuid().optional(),environment:z.record(z.string(),z.string().max(300)).default({}),loginMethod:z.string().max(400).default('应用自行管理登录；请补齐业务账号说明'),initialAccount:z.string().max(100).default(''),credentialHint:z.string().max(400).default('请联系应用负责人领取；禁止在方案中提交明文密码')}).strict();
export const changeSchema=z.object({kind:z.literal('update'),serviceId:z.string().min(1).max(100),component:z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80),image:z.string().max(300),replicas:z.number().int().min(1).max(3).optional()}).strict();
export const releaseInput=z.object({environmentId:z.string().min(1).max(100),title:z.string().min(1).max(120),description:z.string().max(1500).default(''),idempotencyKey:z.string().uuid(),configuration:z.discriminatedUnion('kind',[webSchema,changeSchema,databaseSchema]),testedPlanId:z.string().uuid().optional()}).strict();
export type ReleaseInput=z.infer<typeof releaseInput>;
const targetSchema=z.object({organizationId:z.string(),projectId:z.string(),environmentId:z.string(),tier:z.enum(['test','formal']),databaseNode:z.string().regex(/^[a-zA-Z0-9.-]+$/).optional(),databaseImages:z.record(z.enum(['postgres','mysql']),z.object({image:z.string(),poolImage:z.string()})).optional(),allowNewWeb:z.boolean().default(false),imagePrefixes:z.array(z.string().min(3)).min(1),ports:z.array(z.number().int()).default([]),hostname:z.string().regex(/^[a-zA-Z0-9.-]+$/),serviceIds:z.array(z.string()).default([]),allowedEnvironmentKeys:z.array(z.string()).default([]),testEnvironmentId:z.string().optional(),testServiceIds:z.array(z.string()).default([])}).strict();
export type ReleaseTarget=z.infer<typeof targetSchema>;
export async function releaseTargets(){
 const file=process.env.APPHUB_RELEASE_POLICY_FILE;
 if(!file)return [];
 return z.array(targetSchema).parse(JSON.parse(await readFile(file,'utf8')));
}
export const digest=(v:unknown):string=>createHash('sha256').update(canonical(v)).digest('hex');
function canonical(v:unknown):string {if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(v)??'null';}
export function validateImage(image:string,t:ReleaseTarget){
 if(!/^[a-zA-Z0-9][a-zA-Z0-9.:/_-]*@sha256:[a-f0-9]{64}$/.test(image)||!t.imagePrefixes.some(p=>image.startsWith(p.endsWith('/')?p:p+'/')))throw new Error('镜像必须来自运维允许的仓库路径，并固定为 sha256 摘要');
}
export function validateConfiguration(c:ReleaseInput['configuration'],t:ReleaseTarget){
 validateImage(c.image,t);
 if(c.kind==='database'){const approved=t.databaseImages?.[c.engine];if(!t.databaseNode||!approved||approved.image!==c.image||approved.poolImage!==c.poolImage)throw new Error('该环境尚未开放此数据库镜像与连接池');validateImage(c.poolImage,t);return;}
 if(c.kind==='update'){if(!t.serviceIds.includes(c.serviceId))throw new Error('目标服务未开放配置方案');return;}
 if(!t.allowNewWeb||!t.ports.includes(c.publishedPort))throw new Error('环境未开放新建 Web 应用或端口不在允许范围');
 for(const [k,v] of Object.entries(c.environment)){
  if(!/^[A-Z][A-Z0-9_]{0,60}$/.test(k)||!t.allowedEnvironmentKeys.includes(k)||/password|secret|token|credential|private|connection/i.test(k)||/[\r\n$`]/.test(v))throw new Error('环境变量不在允许范围；密钥应由运维配置，不能提交明文');
 }
}
export function generatedWebCompose(c:z.infer<typeof webSchema>){return {networks:{private:{driver:"overlay"}},services:{app:{networks:["private"],image:c.image,ports:[{target:c.containerPort,published:c.publishedPort,protocol:'tcp',mode:'ingress'}],environment:c.environment,read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],tmpfs:['/tmp'],deploy:{replicas:c.replicas,resources:{limits:{cpus:'1',memory:`${c.memoryMb}M`}},update_config:{parallelism:1,order:'stop-first',failure_action:'rollback'},restart_policy:{condition:'on-failure'}},logging:{driver:'json-file',options:{'max-size':'10m','max-file':'3'}}}}};}
export function requireInteractive(apiKey:unknown){if(apiKey)throw new Error('请回到 AppHub 页面确认或审批，MCP 不能执行此操作');}
export function requireReviewer(role:string,author:string,reviewer:string){if(!['owner','admin'].includes(role)||author===reviewer)throw new Error('正式发布必须由另一位运维管理员审批');}
export function guardNativeMutation(enabled:boolean,role:string,apiKey:unknown,path:string,type:string){
 if(!enabled||type!=='mutation')return;
 if(['project.createVersion','project.createVersionKey'].includes(path))return;
 if(!apiKey&&['project.create','project.changeSharing'].includes(path))return;
 const resources=new Set(['compose','application','environment','project','domain','mounts','port','redirects','security','schedule','rollbacks','previewDeployment','volumeBackups','backup','postgres','mysql','mariadb','mongo','redis','libsql']);
 if(resources.has(path.split('.')[0]!)&&(apiKey||!['owner','admin'].includes(role)))throw new Error('该平台已启用配置方案流程，请提交发布方案并在页面确认；不能绕过审批直接修改部署');
}
