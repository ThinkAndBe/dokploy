import {parse,stringify} from 'yaml';
const LIMIT=256*1024;
export function parseReleaseCompose(value:string){
 if(Buffer.byteLength(value)>LIMIT)throw new Error('编排配置超过平台大小限制');
 const doc=parse(value,{maxAliasCount:100});let normalized:string;
 try{normalized=JSON.stringify(doc);}catch{throw new Error('编排配置不能包含循环引用');}
 if(!normalized||Buffer.byteLength(normalized)>LIMIT)throw new Error('编排引用展开后超过平台大小限制');
 const result=JSON.parse(normalized);if(!result?.services||typeof result.services!=='object'||Array.isArray(result.services))throw new Error('编排缺少有效 services');return result;
}
export function stringifyReleaseCompose(value:unknown){const text=stringify(value,{aliasDuplicateObjects:false});if(Buffer.byteLength(text)>LIMIT)throw new Error('编排配置超过平台大小限制');return text;}
