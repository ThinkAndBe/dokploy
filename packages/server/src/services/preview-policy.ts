import type {IncomingHttpHeaders} from 'node:http';
export const previewCookie='__apphub_preview';
export function previewConfig(){
 const base=(process.env.APPHUB_PREVIEW_BASE_DOMAIN||'').toLowerCase();
 const parent=new URL(process.env.APPHUB_PUBLIC_URL||'http://invalid.local');
 if(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(base)||!['http:','https:'].includes(parent.protocol)||base===parent.hostname||parent.hostname==='invalid.local')throw new Error('平台内测试入口尚未由管理员配置');
 const scheme=process.env.APPHUB_PREVIEW_SCHEME ? process.env.APPHUB_PREVIEW_SCHEME.replace(/:$/,'')+':' : parent.protocol;
 if(!['http:','https:'].includes(scheme))throw new Error('测试访问协议必须为 http 或 https');
 return {base,parent:parent.origin,scheme,external:parent.protocol==='https:'&&scheme==='http:'};
}
export function previewCookieAttributes(){return previewConfig().scheme==='https:'?'SameSite=Strict; Secure':'SameSite=Lax';}
export function previewKey(host:string,base:string){
 const suffix='.'+base;
 if(!host.endsWith(suffix))throw new Error('无效测试入口');
 const key=host.slice(0,-suffix.length);
 if(!/^[a-f0-9]{16}$/.test(key))throw new Error('无效测试入口');
 return key;
}
export function previewOrigin(environment:string){
 if(!/^build-[a-f0-9]{16}$/.test(environment))throw new Error('不是平台管理的测试环境');
 const c=previewConfig();return c.scheme+'//'+environment.slice(6)+'.'+c.base;
}
export function safeProxyPath(path:string){
 if(!path.startsWith('/')||path.startsWith('//')||/[\r\n\\]/.test(path))throw new Error('无效测试请求');return path;
}
export function requestHeaders(headers:IncomingHttpHeaders,origin:string,upgrade=false){
 const connection=String(headers.connection||'').toLowerCase().split(',').map(x=>x.trim());
 const out:Record<string,string|string[]>= {};
 for(const [name,value] of Object.entries(headers)){
  if(value===undefined||['host','connection','proxy-authorization','proxy-authenticate','keep-alive','te','trailer','transfer-encoding','upgrade','expect','forwarded'].includes(name)||connection.includes(name)||name.startsWith('x-forwarded-')||name.startsWith('x-apphub-'))continue;
  out[name]=value;
 }
 out.cookie=String(headers.cookie||'').split(';').filter(c=>c.trim().split('=')[0]!==previewCookie).join(';');
 out.host=new URL(origin).host;out['x-forwarded-host']=out.host;out['x-forwarded-proto']=new URL(origin).protocol.slice(0,-1);
 if(upgrade){out.connection='Upgrade';out.upgrade='websocket';}return out;
}
export function responseCookie(value:string){
 const name=value.split('=',1)[0]?.trim();if(name===previewCookie)return null;
 // Keep application cookies host-only, never allow a test app to set a platform/parent-domain cookie through response headers.
 return value.split(';').filter((part,i)=>i===0||!/^\s*domain\s*=/i.test(part)).join(';');
}
export function allowsFrame(csp:string|undefined,xfo:string|undefined,parent:string,origin:string){
 const directive=csp?.split(';').map(x=>x.trim()).find(x=>/^frame-ancestors\s/i.test(x));
 if(directive){const sources=directive.split(/\s+/).slice(1);return sources.includes(parent)||sources.includes('*')||(sources.includes("'self'")&&parent===origin);}
 return !xfo||(!/deny/i.test(xfo)&&(!/sameorigin/i.test(xfo)||parent===origin));
}
