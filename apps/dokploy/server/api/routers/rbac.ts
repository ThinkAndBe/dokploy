import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {createTRPCRouter,protectedProcedure,adminProcedure} from '../trpc';
import {memberRole,myProjects,roleUsers,setRole,keys,createKey,revokeKey} from '@dokploy/server/services/apphub-rbac';
const actor=(c:any)=>({id:c.user.id,organizationId:c.session.activeOrganizationId});
function browser(c:any){if(c.req.headers['x-api-key']||c.req.headers.origin!==process.env.APPHUB_PUBLIC_URL?.replace(/\/$/,''))throw new TRPCError({code:'FORBIDDEN',message:'请在平台页面操作'});}
export const rbacRouter=createTRPCRouter({
 me:protectedProcedure.query(async({ctx})=>{const m=await memberRole(actor(ctx));return {role:m.effectiveRole,canCreate:m.effectiveRole==='admin'||(m.effectiveRole==='developer'&&m.canCreateProjects),projects:await myProjects(actor(ctx))};}),
 users:adminProcedure.query(({ctx})=>roleUsers(actor(ctx))),
 setRole:adminProcedure.input(z.object({userId:z.string().min(1),role:z.enum(['admin','developer','viewer']),canCreate:z.boolean()})).mutation(({ctx,input})=>{browser(ctx);return setRole(actor(ctx),input);}),
 keys:protectedProcedure.query(({ctx})=>keys(actor(ctx))),
 createKey:protectedProcedure.input(z.object({name:z.string().trim().min(1).max(80),projects:z.array(z.string().min(1)).max(50),scopes:z.array(z.enum(['read','write','test','publish-request','create-project'])).min(1).max(5),days:z.number().int().min(1).max(30)})).mutation(({ctx,input})=>{browser(ctx);ctx.res.setHeader('Cache-Control','no-store');return createKey(actor(ctx),input);}),
 revokeKey:protectedProcedure.input(z.object({id:z.string().uuid()})).mutation(({ctx,input})=>{browser(ctx);return revokeKey(actor(ctx),input.id);}),
});
