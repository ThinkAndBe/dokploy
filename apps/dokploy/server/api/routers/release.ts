import {environmentSettings,configureEnvironment} from '@dokploy/server/services/release-admin';
import {audit} from '../utils/audit';
import {db} from '@dokploy/server/db';
import {apikey} from '@dokploy/server/db/schema';
import {eq} from 'drizzle-orm';
import {createApiKey} from "@dokploy/server/services/user";
import {findMemberByUserId} from "@dokploy/server/services/permission";
import {requireInteractive} from "@dokploy/server/services/release-policy";
import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {createTRPCRouter,protectedProcedure} from '../trpc';
import {catalog,submitPlan,listPlans,detailPlan,decidePlan,listDatabases,inspectDatabase,revealDatabase,type Actor} from '@dokploy/server/services/release-service';
import {releaseInput} from '@dokploy/server/services/release-policy';
const actor=(ctx:any):Actor=>({id:ctx.user.id,organizationId:ctx.session.activeOrganizationId,apiKey:ctx.req.headers['x-api-key']});
async function safe<T>(fn:()=>Promise<T>){try{return await fn();}catch(e){throw new TRPCError({code:'BAD_REQUEST',message:e instanceof Error?e.message:'方案操作失败，请刷新后重试'});}}
import {requestPublish,publishRequests,reviewPublish} from '@dokploy/server/services/publish-request';
export const releaseRouter=createTRPCRouter({
 requestPublish:protectedProcedure.input(z.object({testedPlanId:z.string().uuid(),description:z.string().trim().min(1).max(1500)})).mutation(({ctx,input})=>safe(()=>requestPublish(actor(ctx),input.testedPlanId,input.description))),
 publishRequests:protectedProcedure.query(({ctx})=>safe(()=>publishRequests(actor(ctx)))),
 reviewPublish:protectedProcedure.input(z.object({id:z.string().uuid(),status:z.enum(['processing','rejected']),note:z.string().trim().min(1).max(500)})).mutation(({ctx,input})=>safe(()=>reviewPublish(actor(ctx),input.id,input.status,input.note))),
 environmentSettings:protectedProcedure.query(({ctx})=>safe(()=>environmentSettings(actor(ctx)))),
 configureEnvironment:protectedProcedure.input(z.object({environmentId:z.string().min(1),tier:z.enum(['test','formal']),testEnvironmentId:z.string().optional(),databases:z.boolean(),allowNewWeb:z.boolean()})).mutation(({ctx,input})=>safe(async()=>{const result=await configureEnvironment(actor(ctx),input);await audit(ctx,{action:'update',resourceType:'environment',resourceId:input.environmentId,resourceName:'数据库与发布开放范围'});return result;})),
 databases:protectedProcedure.query(({ctx})=>safe(()=>listDatabases(actor(ctx)))),
 databaseStats:protectedProcedure.input(z.object({id:z.string().uuid()})).query(({ctx,input})=>safe(()=>inspectDatabase(actor(ctx),input.id))),
 databaseCredential:protectedProcedure.input(z.object({id:z.string().uuid()})).mutation(({ctx,input})=>{ctx.res.setHeader('Cache-Control','no-store');return safe(()=>revealDatabase(actor(ctx),input.id));}),
 planningKeys:protectedProcedure.query(async({ctx})=>safe(async()=>{
  requireInteractive(ctx.req.headers['x-api-key']);ctx.res.setHeader('Cache-Control','no-store');
  const rows=await db.select({id:apikey.id,name:apikey.name,expiresAt:apikey.expiresAt,createdAt:apikey.createdAt,metadata:apikey.metadata}).from(apikey).where(eq(apikey.referenceId,ctx.user.id));
  return rows.filter(r=>{try{const m=JSON.parse(r.metadata||'{}');return m.apphubScope==='release-planning'&&m.organizationId===ctx.session.activeOrganizationId}catch{return false}}).map(({metadata,...r})=>r);
 })),
 createPlanningKey:protectedProcedure.input(z.object({userId:z.string().optional()})).mutation(async({ctx,input})=>safe(async()=>{
  requireInteractive(ctx.req.headers['x-api-key']);const target=input.userId||ctx.user.id;
  if(target!==ctx.user.id&&!['owner','admin'].includes(ctx.user.role))throw new Error('只能为自己生成密钥');
  await findMemberByUserId(target,ctx.session.activeOrganizationId);
  if(!(await catalog({id:target,organizationId:ctx.session.activeOrganizationId})).length)throw new Error('请先分配配置方案环境');
  ctx.res.setHeader('Cache-Control','no-store');const metadata={organizationId:ctx.session.activeOrganizationId,apphubScope:'release-planning'};
  const key=await createApiKey(target,{name:'AppHub AI 配置方案',expiresIn:604800,metadata,rateLimitEnabled:true,rateLimitTimeWindow:60000,rateLimitMax:120});
  return {key:key.key,id:key.id,expiresAt:key.expiresAt};
 })),
 catalog:protectedProcedure.query(({ctx})=>safe(()=>catalog(actor(ctx)))),
 submit:protectedProcedure.input(releaseInput).mutation(({ctx,input})=>safe(()=>submitPlan(actor(ctx),input))),
 list:protectedProcedure.query(({ctx})=>safe(()=>listPlans(actor(ctx)))),
 detail:protectedProcedure.input(z.object({id:z.string().uuid()})).query(({ctx,input})=>safe(()=>detailPlan(actor(ctx),input.id))),
 decide:protectedProcedure.input(z.object({id:z.string().uuid(),hash:z.string().length(64),action:z.enum(['confirm','approve','reject','cancel']),note:z.string().min(1).max(500)})).mutation(({ctx,input})=>safe(()=>decidePlan(actor(ctx),input.id,input.hash,input.action,input.note))),
});
