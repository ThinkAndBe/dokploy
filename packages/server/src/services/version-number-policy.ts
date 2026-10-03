// APPHUB-VERSION-1: dates are metadata, never release numbers.
export const versionPattern=/^v(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
export function versionParts(name:string){return versionPattern.test(name)?name.slice(1).split('.').map(Number):null;}
export function versionAdvice(names:string[]){
 const versions=names.map(n=>versionParts(n)||versionParts('v'+(/^v?([0-9]+\.[0-9]+\.[0-9]+)-apphub\./.exec(n)?.[1]||''))).filter((n):n is number[]=>!!n).sort((a,b)=>b[0]!-a[0]!||b[1]!-a[1]!||b[2]!-a[2]!);
 const v=versions[0];if(!v)return {current:null,patch:'v1.0.0',minor:'v1.0.0',major:'v1.0.0'};
 return {current:'v'+v.join('.'),patch:`v${v[0]}.${v[1]}.${v[2]!+1}`,minor:`v${v[0]}.${v[1]!+1}.0`,major:`v${v[0]!+1}.0.0`};
}
export function assertNextVersion(name:string,names:string[]){
 if(!versionPattern.test(name))throw new Error('版本号必须为 v主版本.次版本.修订号，例如 v1.2.3；日期、后缀和前导零不能作为版本号');
 const next=versionAdvice(names);if(![next.patch,next.minor,next.major].includes(name))throw new Error(`版本必须递增。修复用 ${next.patch}，新增功能用 ${next.minor}，不兼容变更用 ${next.major}。请刷新后重试`);
}
export function commitChannel(message:string){return /\nAppHub-Source: (web|mcp)\nAppHub-User: [A-Za-z0-9_-]{1,200}\s*$/.exec(message)?.[1]==='mcp'?'AI / MCP':/\nAppHub-Source: web\nAppHub-User: [A-Za-z0-9_-]{1,200}\s*$/.test(message)?'网页提交':'历史记录（方式未记录）';}
