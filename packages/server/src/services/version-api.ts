import {z} from 'zod';
export const versionInput=z.object({projectId:z.string().min(1).max(200),name:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/).refine(v=>!v.includes('..')&&!v.endsWith('.')&&!v.endsWith('.lock'),'版本名称不合法'),commit:z.string().regex(/^[a-f0-9]{40}$/),description:z.string().max(2000).default('')}).strict();
export const versionListOutput=z.object({page:z.number(),hasMore:z.boolean(),tags:z.array(z.object({name:z.string(),sha:z.string()})),commits:z.array(z.object({sha:z.string(),message:z.string(),author:z.string(),date:z.string()}))});
