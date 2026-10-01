import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {createTRPCRouter,protectedProcedure} from '../trpc';
import {projectSummary,projectOperations,operateService,resourceLogs,backupDatabase} from '@dokploy/server/services/project-operations';
const actor=(ctx:any)=>({id:ctx.user.id,organizationId:ctx.session.activeOrganizationId,apiKey:ctx.req.headers['x-api-key']});
const project=z.object({projectId:z.string().min(1)}),resource=project.extend({key:z.string().min(1).max(200)});
async function safe<T>(fn:()=>Promise<T>){try{return await fn();}catch(e){throw new TRPCError({code:'BAD_REQUEST',message:e instanceof Error?e.message:'项目运行操作未完成'});}}
function interactive(ctx:any){if(ctx.req.headers['x-api-key']||ctx.req.headers.origin!==process.env.APPHUB_PUBLIC_URL?.replace(/\/$/,''))throw new TRPCError({code:'FORBIDDEN',message:'请在平台页面确认运维操作'});ctx.res.setHeader('Cache-Control','no-store');}
export const projectOperationsRouter=createTRPCRouter({
 summary:protectedProcedure.input(project).query(({ctx,input})=>safe(()=>projectSummary(actor(ctx),input.projectId))),
 resources:protectedProcedure.input(project).query(({ctx,input})=>{ctx.res.setHeader('Cache-Control','no-store');return safe(()=>projectOperations(actor(ctx),input.projectId));}),
 logs:protectedProcedure.input(resource).query(({ctx,input})=>{ctx.res.setHeader('Cache-Control','no-store');return safe(()=>resourceLogs(actor(ctx),input.projectId,input.key));}),
 operate:protectedProcedure.input(resource.extend({action:z.enum(['start','stop','restart']),version:z.number().int().nonnegative(),confirmation:z.string(),requestId:z.string().uuid()})).mutation(({ctx,input})=>{interactive(ctx);return safe(()=>operateService(actor(ctx),input));}),
 backup:protectedProcedure.input(resource.extend({requestId:z.string().uuid()})).mutation(({ctx,input})=>{interactive(ctx);return safe(()=>backupDatabase(actor(ctx),input));}),
});
