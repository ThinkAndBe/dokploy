import {z} from 'zod';
// U+FFFD means bytes were already lost before reaching the platform. Do not guess replacements.
export const projectNameText=z.string().trim().min(1,'请填写项目名称').max(100,'项目名称最多 100 字').refine(v=>!v.includes('\uFFFD'),'项目名称含损坏字符，请使用 UTF-8 重新填写');
export const projectDescriptionText=z.string().max(2000,'项目说明最多 2000 字').refine(v=>!v.includes('\uFFFD'),'项目说明含损坏字符，请使用 UTF-8 重新填写');
export const projectProfileInput=z.object({projectId:z.string().min(1).max(200),name:projectNameText,description:projectDescriptionText,expected:z.object({name:z.string(),description:z.string().nullable()}).strict()}).strict();
