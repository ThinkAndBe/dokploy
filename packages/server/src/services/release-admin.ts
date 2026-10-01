import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {db} from '../db';
import {projects} from '../db/schema';
import {findMemberByUserId} from './permission';
import {releaseTargets,requireInteractive} from './release-policy';
import type {Actor} from './release-service';
async function admin(a:Actor){requireInteractive(a.apiKey);const m=await findMemberByUserId(a.id,a.organizationId);if(!['owner','admin'].includes(m.role))throw new Error('仅运维管理员可以设置环境开放范围');}
export async function environmentSettings(a:Actor){await admin(a);const rows=await db.query.projects.findMany({where:eq(projects.organizationId,a.organizationId),with:{environments:true}});return {projects:rows.map(p=>({id:p.projectId,name:p.name,environments:p.environments.map(e=>({id:e.environmentId,name:e.name}))})),targets:(await releaseTargets()).filter(t=>t.organizationId===a.organizationId)};}
let writing=Promise.resolve();
export async function configureEnvironment(a:Actor,input:{environmentId:string;tier:'test'|'formal';testEnvironmentId?:string;databases:boolean;allowNewWeb:boolean}){
 await admin(a);let release!:()=>void;const previous=writing;writing=new Promise<void>(r=>release=r);await previous;
 try{const file=process.env.APPHUB_RELEASE_POLICY_FILE;if(!file)throw new Error('平台配置方案流程尚未启用');const {projects:rows}=await environmentSettings(a),project=rows.find(p=>p.environments.some(e=>e.id===input.environmentId));if(!project)throw new Error('环境不存在或未授权');const all=await releaseTargets(),current=all.find(t=>t.environmentId===input.environmentId&&t.organizationId===a.organizationId);const baseline=all.find(t=>t.organizationId===a.organizationId&&t.databaseImages&&t.databaseNode);if(!baseline)throw new Error('运维尚未登记数据库镜像与持久化节点');
 if(current?.managedBuild)throw new Error('此测试配置由项目自动管理，无需手动修改');
 if(input.tier==='formal'&&(!input.testEnvironmentId||input.testEnvironmentId===input.environmentId||!project.environments.some(e=>e.id===input.testEnvironmentId)||!all.some(t=>t.environmentId===input.testEnvironmentId&&t.tier==='test')))throw new Error('正式环境必须关联本项目已开放的测试环境');
 const value={...baseline,...current,organizationId:a.organizationId,projectId:project.id,environmentId:input.environmentId,tier:input.tier,allowNewWeb:input.allowNewWeb,ports:current?.ports?.length?current.ports:[32030,32031,32032,32033,32034,32035],serviceIds:current?.serviceIds??[],testServiceIds:current?.testServiceIds??[],databaseImages:input.databases?baseline.databaseImages:undefined,testEnvironmentId:input.tier==='formal'?input.testEnvironmentId:undefined};const next=all.filter(t=>!t.managedBuild&&!(t.environmentId===input.environmentId&&t.organizationId===a.organizationId));next.push(value);const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(next,null,2),{mode:0o600});await rename(temp,file);return {environmentId:input.environmentId};
 }finally{release();}
}
