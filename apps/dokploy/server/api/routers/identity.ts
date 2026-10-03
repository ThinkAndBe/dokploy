import {identityScheduleInput} from '@dokploy/server/services/identity-schedule';
import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {createTRPCRouter,protectedProcedure} from '../trpc';
import {identityStatus,identityUsers,identityGroups,syncDirectory,identityAccess,identityProject,identityAudit,saveIdentitySSO,saveIdentitySchedule} from '@dokploy/server/services/identity-service';
const actor=(ctx:any)=>({id:ctx.user.id,organizationId:ctx.session.activeOrganizationId,apiKey:ctx.req.headers['x-api-key']});
async function safe<T>(fn:()=>Promise<T>){try{return await fn();}catch(e){throw new TRPCError({code:'BAD_REQUEST',message:e instanceof Error?e.message:'用户管理操作未完成'});}}
function interactive(ctx:any){ctx.res.setHeader('Cache-Control','no-store');if(ctx.req.headers['x-api-key']||ctx.req.headers.origin!==process.env.APPHUB_PUBLIC_URL?.replace(/\/$/,''))throw new TRPCError({code:'FORBIDDEN',message:'请在平台页面执行用户管理'});}
export const identityRouter=createTRPCRouter({
 status:protectedProcedure.query(({ctx})=>safe(()=>identityStatus(actor(ctx)))),
 users:protectedProcedure.input(z.object({search:z.string().max(100).default(''),page:z.number().int().min(1).max(20000).default(1),group:z.string().max(1000).default('')})).query(({ctx,input})=>{ctx.res.setHeader('Cache-Control','no-store');return safe(()=>identityUsers(actor(ctx),input));}),
 groups:protectedProcedure.input(z.object({search:z.string().max(100)})).query(({ctx,input})=>safe(()=>identityGroups(actor(ctx),input.search))),
 audit:protectedProcedure.query(({ctx})=>safe(()=>identityAudit(actor(ctx)))),
 schedule:protectedProcedure.input(identityScheduleInput).mutation(({ctx,input})=>{interactive(ctx);return safe(()=>saveIdentitySchedule(actor(ctx),input));}),
 sync:protectedProcedure.mutation(({ctx})=>{interactive(ctx);return safe(()=>syncDirectory(actor(ctx)));}),
 access:protectedProcedure.input(z.object({externalId:z.string().min(1).max(200),enabled:z.boolean(),canCreateProjects:z.boolean().default(false)})).mutation(({ctx,input})=>{interactive(ctx);return safe(()=>identityAccess(actor(ctx),input));}),
 project:protectedProcedure.input(z.object({externalId:z.string().min(1).max(200),projectId:z.string().min(1),action:z.enum(['grant','revoke'])})).mutation(({ctx,input})=>{interactive(ctx);return safe(()=>identityProject(actor(ctx),input));}),
 sso:protectedProcedure.input(z.object({appId:z.string().trim().max(200),secret:z.string().max(2000).optional(),enabled:z.boolean()})).mutation(({ctx,input})=>{interactive(ctx);return safe(()=>saveIdentitySSO(actor(ctx),input));}),
});
