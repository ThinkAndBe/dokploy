import {inspectProjectTest} from '@dokploy/server/services/test-source';
import {z} from 'zod';
import {previewConfig} from '@dokploy/server/services/preview-policy';
import {openPreview} from '@dokploy/server/services/preview-gateway';
import {testEnvironment,changeTestEnvironment} from '@dokploy/server/services/build-environment';
import {TRPCError} from '@trpc/server';
import {createTRPCRouter,protectedProcedure} from '../trpc';
import {startBuild,buildStatus,listBuilds,buildDetail,cancelBuild,testCredential,buildRuntimeLog} from '@dokploy/server/services/build-service';
const actor=(ctx:any)=>({id:ctx.user.id,organizationId:ctx.session.activeOrganizationId,apiKey:ctx.req.headers['x-api-key']});
async function safe<T>(fn:()=>Promise<T>){try{return await fn();}catch(e){throw new TRPCError({code:'BAD_REQUEST',message:e instanceof z.ZodError?'apphub.json 构建说明无效，请核对类型、入口、端口和健康检查路径':e instanceof Error?e.message:'构建操作未完成'});}}
function interactive(ctx:any){if(ctx.req.headers['x-api-key']||ctx.req.headers.origin!==process.env.APPHUB_PUBLIC_URL?.replace(/\/$/,''))throw new TRPCError({code:'FORBIDDEN',message:'请从 AppHub 项目页面操作'});}
export const buildRouter=createTRPCRouter({
 compatibility:protectedProcedure.input(z.object({projectId:z.string().min(1),commit:z.string().regex(/^[a-f0-9]{40}$/)})).query(({ctx,input})=>safe(()=>inspectProjectTest(actor(ctx),input.projectId,input.commit))),
 preview:protectedProcedure.input(z.object({projectId:z.string().min(1)})).mutation(({ctx,input})=>{interactive(ctx);ctx.res.setHeader('Cache-Control','no-store');return safe(()=>openPreview(actor(ctx),input.projectId,ctx.session.id));}),
 environment:protectedProcedure.input(z.object({projectId:z.string().min(1)})).query(({ctx,input})=>{ctx.res.setHeader('Cache-Control','no-store');return safe(async()=>({...await testEnvironment(actor(ctx),input.projectId),externalPreview:process.env.APPHUB_PREVIEW_BASE_DOMAIN?previewConfig().external:false}));}),
 changeEnvironment:protectedProcedure.input(z.object({projectId:z.string().min(1),action:z.enum(['stop','resume'])})).mutation(({ctx,input})=>{interactive(ctx);return safe(()=>changeTestEnvironment(actor(ctx),input.projectId,input.action));}),
 status:protectedProcedure.input(z.object({projectId:z.string().min(1)})).query(({ctx,input})=>safe(()=>buildStatus(actor(ctx),input.projectId))),
 start:protectedProcedure.input(z.object({projectId:z.string().min(1),commit:z.string().regex(/^[a-f0-9]{40}$/).optional(),requestKey:z.string().uuid()})).mutation(({ctx,input})=>{interactive(ctx);return safe(()=>startBuild(actor(ctx),input));}),
 list:protectedProcedure.input(z.object({projectId:z.string().min(1)})).query(({ctx,input})=>safe(()=>listBuilds(actor(ctx),input.projectId))),
 detail:protectedProcedure.input(z.object({id:z.string().uuid()})).query(({ctx,input})=>safe(()=>buildDetail(actor(ctx),input.id))),
 runtimeLog:protectedProcedure.input(z.object({id:z.string().uuid()})).query(({ctx,input})=>{ctx.res.setHeader('Cache-Control','no-store');return safe(()=>buildRuntimeLog(actor(ctx),input.id));}),
 cancel:protectedProcedure.input(z.object({id:z.string().uuid()})).mutation(({ctx,input})=>{interactive(ctx);return safe(()=>cancelBuild(actor(ctx),input.id));}),
 credential:protectedProcedure.input(z.object({projectId:z.string().min(1)})).mutation(({ctx,input})=>{interactive(ctx);ctx.res.setHeader('Cache-Control','no-store');return safe(()=>testCredential(actor(ctx),input.projectId));}),
});
