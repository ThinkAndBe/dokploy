import {stackServices,validateStack} from './stack-policy';
import {z} from 'zod';
import {safeCodePath} from './code-archive';
export const buildManifest=z.object({
 type:z.enum(['dockerfile','dotnet','static','node','stack']).default('dockerfile'),
 dockerfile:z.string().default('Dockerfile'),entry:z.string().optional(),
 context:z.string().optional(),output:z.string().default('dist'),
 port:z.number().int().min(1).max(65535).default(8080),
 health:z.string().regex(/^\/[a-zA-Z0-9/_.-]*$/).max(200).default('/'),
 login:z.object({username:z.string().min(1).max(80),passwordSecret:z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)}).strict().optional(),
 services:stackServices.optional(),secretKeys:z.array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)).max(16).default([]),
 storage:z.object({target:z.enum(['/data','/app/data','/app/uploads']).default('/data')}).optional(),
}).strict().superRefine((v,c)=>{if(v.type==='stack'){try{if(!v.services)throw new Error('多服务测试需要 services');validateStack({services:v.services,secretKeys:v.secretKeys});if(v.login&&!v.secretKeys.includes(v.login.passwordSecret))throw new Error('初始账号引用了未声明的密钥');}catch(e){c.addIssue({code:'custom',message:e instanceof Error?e.message:'多服务配置无效'});}}else if(v.services||v.secretKeys.length||v.login)c.addIssue({code:'custom',message:'services 和 secretKeys 仅适用于 stack 类型'});for(const [key,p] of Object.entries({dockerfile:v.dockerfile,entry:v.entry,context:v.context,output:v.output}).filter(([,p])=>!!p)){try{if(!(key==='output'&&p==='.'&&v.type==='static'))safeCodePath(p!);}catch{c.addIssue({code:'custom',message:'构建文件路径必须位于项目内'});}}if(v.type==='dotnet'&&(!v.entry||!v.entry.endsWith('.csproj')))c.addIssue({code:'custom',message:'.NET 项目需要 entry 指向 csproj'});});
export function redactBuildLog(value:string){return value.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').replace(/(authorization\s*[:=]\s*)([^\r\n]+)/gi,'$1[已隐藏]').replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[已隐藏]@').replace(/((?:password|token|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,'$1[已隐藏]').slice(-180000);}
export function validBuiltImage(image:string,repository:string){return image.startsWith(repository+'@sha256:')&&/^[a-f0-9]{64}$/.test(image.slice((repository+'@sha256:').length));}
