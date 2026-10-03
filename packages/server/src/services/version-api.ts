import {versionPattern} from './version-number-policy';
import {z} from 'zod';
export const versionInput=z.object({projectId:z.string().min(1).max(200),name:z.string().regex(versionPattern,'请使用 v主版本.次版本.修订号，例如 v1.2.3'),commit:z.string().regex(/^[a-f0-9]{40}$/),description:z.string().trim().min(5,'请填写至少5个字符的实际变更说明').max(2000)}).strict();
// Existing immutable tags retain their historical names. This schema is only for recycle/restore.
export const changeVersionInput=z.object({
 projectId:z.string().min(1).max(200),
 name:z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/,'版本名称格式无效').refine(name=>!name.includes('..')&&!name.endsWith('.')&&!name.endsWith('.lock'),'版本名称格式无效'),
 commit:versionInput.shape.commit,
 action:z.enum(['delete','restore']),
}).strict();
export const versionListOutput=z.object({page:z.number(),hasMore:z.boolean(),next:z.object({current:z.string().nullable(),patch:z.string(),minor:z.string(),major:z.string()}),tags:z.array(z.object({name:z.string(),sha:z.string(),author:z.string(),date:z.string(),description:z.string(),source:z.string()})),commits:z.array(z.object({sha:z.string(),message:z.string(),author:z.string(),date:z.string(),source:z.string()}))});
