import {z} from 'zod';
const name=z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const path=z.string().min(1).max(300).refine(p=>!p.startsWith('/')&&!p.includes('\\')&&!p.includes(':')&&p.split('/').every(v=>v&&v!=='.'&&v!=='..'),'路径必须位于项目内');
const command=z.array(z.string().max(4096)).min(1).max(40);
export const stackService=z.object({
 build:z.object({context:path.optional(),dockerfile:path.default('Dockerfile'),args:z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,60}$/),z.string().max(200)).default({})}).strict().optional(),
 image:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,299}$/).optional(),
 environment:z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,79}$/),z.string().max(2000)).default({}),
 command:command.optional(),entrypoint:command.optional(),user:z.string().regex(/^\d{1,6}:\d{1,6}$/).optional(),
 dependsOn:z.array(name).max(15).default([]),
 healthcheck:z.object({test:command,intervalSeconds:z.number().int().min(5).max(60).default(10),timeoutSeconds:z.number().int().min(1).max(30).default(5),startSeconds:z.number().int().min(0).max(180).default(30)}).strict(),
 storage:z.array(z.object({name,target:z.string().regex(/^\/(?:data(?:\/[a-zA-Z0-9_-]+)*|app\/(?:data|uploads)(?:\/[a-zA-Z0-9_-]+)*|var\/(?:lib|log)\/[a-zA-Z0-9_/-]+|usr\/share\/opensearch\/data)$/),readOnly:z.boolean().default(false)}).strict()).max(8).default([]),
 tmpfs:z.array(z.object({target:z.string().regex(/^\/(?:tmp|run\/[a-zA-Z0-9_-]+|var\/(?:run|log|cache)\/[a-zA-Z0-9_/-]+)$/),sizeMb:z.number().int().min(8).max(256).default(64)}).strict()).max(6).default([]),
 memoryMb:z.number().int().min(64).max(4096).default(512),cpus:z.number().min(.1).max(2).default(.5),
}).strict().superRefine((s,c)=>{
 if(Number(!!s.build)+Number(!!s.image)!==1)c.addIssue({code:'custom',message:'每个组件必须指定 build 或 image，且不能同时指定'});
 if(s.image){const first=s.image.split('/')[0]!;if(s.image.includes('/')&&(first.includes('.')||first.includes(':'))&&!['docker.io','ghcr.io','mcr.microsoft.com','quay.io','public.ecr.aws'].includes(first))c.addIssue({code:'custom',message:'外部基础镜像仅支持公开镜像仓库，不允许访问内网仓库凭据'});}
 if(s.healthcheck.test[0]!=='CMD'&&s.healthcheck.test[0]!=='CMD-SHELL')c.addIssue({code:'custom',message:'健康检查必须使用 CMD 或 CMD-SHELL'});
 if(new Set(s.storage.map(v=>v.target)).size!==s.storage.length)c.addIssue({code:'custom',message:'数据挂载路径不能重复'});
 for(const [k,v] of Object.entries(s.environment)){if(v.includes('{{secret:')&&!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))c.addIssue({code:'custom',message:'引用密钥的环境变量名必须是有效 shell 变量'});if(/password|secret|token|api[_-]?key|dsn/i.test(k)&&v&&!v.includes('{{secret:'))c.addIssue({code:'custom',message:k+' 必须引用平台自动生成的测试密钥，例如 {{secret:database}}'});}
});
export const stackServices=z.record(name,stackService);
export type StackService=z.infer<typeof stackService>;
export type StackSpec={services:Record<string,StackService>;secretKeys:string[]};
export function stackOrder(services:Record<string,StackService>){
 const done=new Set<string>(),levels:string[][]=[];
 while(done.size<Object.keys(services).length){const level=Object.entries(services).filter(([n,s])=>!done.has(n)&&s.dependsOn.every(d=>done.has(d))).map(([n])=>n);if(!level.length)throw new Error('组件依赖包含循环或不存在的组件');levels.push(level);level.forEach(n=>done.add(n));}return levels;
}
export function validateStack(m:StackSpec){
 const names=Object.keys(m.services);if(names.length<2||names.length>16||!m.services.app||names.includes('preview_access'))throw new Error('多服务测试须包含 app 入口，共 2–16 个组件；preview_access 保留给平台');
 if(Object.values(m.services).reduce((n,s)=>n+s.memoryMb,0)>16384||Object.values(m.services).reduce((n,s)=>n+s.cpus,0)>8)throw new Error('整套测试资源上限为 16 GB 内存、8 CPU');
 const keys=new Set(m.secretKeys);if(keys.size!==m.secretKeys.length)throw new Error('测试密钥名称重复');
 for(const [n,s] of Object.entries(m.services)){
  if(s.dependsOn.includes(n)||s.dependsOn.some(d=>!m.services[d]))throw new Error(n+' 的依赖组件不存在或指向自己');
  for(const v of Object.values(s.environment)){const clean=v.replace(/\{\{secret:([a-z][a-z0-9-]{0,39})\}\}/g,(_,k)=>{if(!keys.has(k))throw new Error('引用了未声明的测试密钥 '+k);return '';});if(clean.includes('{{secret:'))throw new Error('测试密钥引用格式无效');}
 }return stackOrder(m.services);
}
export type StackArtifact={image:string;entrypoint:string[];command:string[]};
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
const literal=(s:string)=>s.replaceAll('$',()=> '$$');
export function stackSecretName(environment:string,key:string){if(!/^build-[a-f0-9]{16}$/.test(environment)||!name.safeParse(key).success)throw new Error('测试密钥标识无效');return 'apphub-test-'+environment+'-'+key;}
export function generatedStackCompose(m:StackSpec,artifacts:Record<string,StackArtifact>,environment:string,node:string){
 validateStack(m);if(!/^build-[a-f0-9]{16}$/.test(environment)||!node.match(/^[a-zA-Z0-9.-]+$/))throw new Error('测试目标无效');
 const document:any={networks:{private:{driver:'overlay',internal:true}},services:{},volumes:{},secrets:{}};
 for(const key of m.secretKeys)document.secrets[key]={external:true,name:stackSecretName(environment,key)};
 for(const [n,s] of Object.entries(m.services)){
  const artifact=artifacts[n];if(!artifact||!/@sha256:[a-f0-9]{64}$/.test(artifact.image))throw new Error(n+' 缺少固定镜像摘要');
  const env:Record<string,string>={},exports:string[]=[],used=new Set<string>();
  for(const [k,v] of Object.entries(s.environment)){
   if(v.includes('{{secret:')){let i=0,parts:string[]=[];for(const match of v.matchAll(/\{\{secret:([a-z][a-z0-9-]{0,39})\}\}/g)){parts.push(quote(v.slice(i,match.index)), '"$(cat /run/secrets/apphub_'+match[1]+')"');used.add(match[1]!);i=match.index!+match[0].length;}parts.push(quote(v.slice(i)));exports.push('export '+k+'='+parts.join(''));}else env[k]=literal(v);
  }
  const cmd=[...(s.entrypoint??artifact.entrypoint),...(s.command??artifact.command)];if(!cmd.length)throw new Error(n+' 没有启动命令');
  const volumes:any[]=[{type:'tmpfs',target:'/tmp',tmpfs:{size:134217728}}];
  for(const t of s.tmpfs){if(t.target==='/tmp')volumes[0]={type:'tmpfs',target:t.target,tmpfs:{size:t.sizeMb*1048576}};else volumes.push({type:'tmpfs',target:t.target,tmpfs:{size:t.sizeMb*1048576}});}
  for(const v of s.storage){document.volumes[v.name]={name:'apphub-test-'+environment+'-'+v.name};volumes.push({type:'volume',source:v.name,target:v.target,read_only:v.readOnly});}
  document.services[n]={image:artifact.image,networks:['private'],environment:env,entrypoint:exports.length?['/bin/sh','-ec']:cmd.map(literal),command:exports.length?[literal(exports.join('\n')+'\nexec '+cmd.map(quote).join(' '))]:[],...(s.user?{user:s.user}:{}),read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],volumes,secrets:[...used].map(k=>({source:k,target:'apphub_'+k})),healthcheck:{test:s.healthcheck.test.map(literal),interval:s.healthcheck.intervalSeconds+'s',timeout:s.healthcheck.timeoutSeconds+'s',start_period:s.healthcheck.startSeconds+'s',retries:12},deploy:{replicas:1,placement:{constraints:['node.hostname == '+node]},resources:{limits:{cpus:String(s.cpus),memory:s.memoryMb+'M'}},update_config:{parallelism:1,order:'stop-first',failure_action:'pause'},restart_policy:{condition:'on-failure',delay:'5s',max_attempts:10,window:'300s'}},logging:{driver:'json-file',options:{'max-size':'5m','max-file':'2'}}};
 }return document;
}

const artifact=z.object({image:z.string().max(400),entrypoint:z.array(z.string().max(8192)).max(40),command:z.array(z.string().max(8192)).max(40)}).strict();
export function validateStackArtifacts(repository:string,m:StackSpec,raw:unknown){
 const records=z.record(z.string(),artifact).parse(raw),names=Object.keys(m.services);
 if(Object.keys(records).length!==names.length)throw new Error('构建结果与组件数量不一致');
 for(const name of names){const expected=repository+(name==='app'?'':'/components/'+name)+'@sha256:',value=records[name];if(!value?.image.startsWith(expected)||!/^[a-f0-9]{64}$/.test(value.image.slice(expected.length)))throw new Error(name+' 镜像摘要不属于本次项目构建');}
 return records;
}
