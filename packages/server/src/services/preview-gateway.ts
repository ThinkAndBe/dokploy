import {memberRole} from './apphub-rbac';
import {encryptValue,decryptValue} from '../lib/encryption';
import http,{type IncomingMessage,type IncomingHttpHeaders,type ServerResponse} from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import type {Duplex} from 'node:stream';
import {buildSchema,sql} from './build-store';
import {codeProject} from './project-code';
import {testEnvironment} from './build-environment';
import type {Actor} from './release-service';
import {requireInteractive} from './release-policy';
import {previewConfig,previewKey,previewOrigin,previewCookie,previewCookieAttributes,safeProxyPath,requestHeaders,responseCookie,allowsFrame} from './preview-policy';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function previewProbe(projectId:string,path:string){return encryptValue(JSON.stringify({purpose:'preview-health',projectId,path,expires:Date.now()+10000}));}
async function allow(a:Actor,pid:string){await memberRole(a);return codeProject({...a,name:'AppHub',email:'preview@apphub.invalid'},pid);}
export async function openPreview(a:Actor,pid:string,sessionId:string){
 requireInteractive(a.apiKey);await allow(a,pid);await buildSchema();
 const env=await testEnvironment(a,pid);if(env.state!=='running')throw new Error('测试应用还未就绪，请等待准备完成或恢复测试');
 const [p]=await sql`select * from apphub_build_project where project_id=${pid} and organization_id=${a.organizationId}`;
 const [session]=await sql`select expires_at from session where id=${sessionId} and user_id=${a.id} and active_organization_id=${a.organizationId} and expires_at>now()`;
 if(!p||!session)throw new Error('登录已过期，请重新登录 AppHub');
 const origin=previewOrigin(p.environment_id),ticket=randomBytes(32).toString('hex');
 await sql`delete from apphub_preview_access where expires_at<now() or (token_hash is null and ticket_expires_at<now())`;
 const [quota]=await sql`select count(*)::int as count from apphub_preview_access where session_id=${sessionId}`;if((quota?.count??0)>=100)throw new Error('当前会话打开测试页面过多，请稍后重试或重新登录');
 const expires=new Date(Math.min(new Date(session.expires_at).getTime(),Date.now()+8*3600000));
 await sql`insert into apphub_preview_access(id,project_id,organization_id,actor,session_id,ticket_hash,ticket_expires_at,expires_at) values(${randomUUID()},${pid},${a.organizationId},${a.id},${sessionId},${hash(ticket)},now()+interval '60 seconds',${expires})`;
 return {url:origin+'/_apphub/open?ticket='+ticket,origin,expiresAt:expires.toISOString()};
}
async function projectForHost(req:IncomingMessage){
 const cfg=previewConfig();const key=previewKey(String(req.headers.host||'').toLowerCase(),cfg.base);await buildSchema();
 const [p]=await sql`select * from apphub_build_project where environment_id=${'build-'+key}`;
 if(!p?.service_id)throw new Error('测试环境不存在');
 const host=process.env.APPHUB_BUILD_TEST_HOST||'';
 if(!/^[a-zA-Z0-9.-]+$/.test(host)||!Number.isInteger(p.port)||p.port<32060||p.port>32159)throw new Error('测试入口配置异常');
 return {p,cfg,origin:previewOrigin(p.environment_id),target:{hostname:host,port:p.port}};
}
async function access(req:IncomingMessage,context:Awaited<ReturnType<typeof projectForHost>>,ticket?:string){
 const raw=ticket??String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(previewCookie+'='))?.slice(previewCookie.length+1);
 if(!raw||!/^[a-f0-9]{64}$/.test(raw))throw new Error('请从 AppHub 项目内打开测试应用');
 const column=ticket?'ticket_hash':'token_hash';
 const rows=await sql`select a.* from apphub_preview_access a join session s on s.id=a.session_id and s.user_id=a.actor and s.active_organization_id=a.organization_id where a.${sql(column)}=${hash(raw)} and a.project_id=${context.p.project_id} and a.organization_id=${context.p.organization_id} and a.expires_at>now() and s.expires_at>now()`;
 const a=rows[0];if(!a||(ticket&&(a.token_hash||new Date(a.ticket_expires_at).getTime()<Date.now())))throw new Error('测试访问已过期，请点击平台中的“重新打开”');
 await allow({id:a.actor,organizationId:a.organization_id},a.project_id);
 return a;
}
function message(res:ServerResponse,status:number,text:string){
 let parent="'none'";try{parent=previewConfig().parent;}catch{}
 res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; frame-ancestors ${parent}; base-uri 'none'`});
 res.end('<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:48px;color:#334155}</style><h2>项目测试</h2><p>'+text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))+'</p>');
}
function upstreamHeaders(headers:IncomingHttpHeaders,origin:string,target:{hostname:string;port:number}){
 const out:Record<string,any>={};const connection=String(headers.connection||'').toLowerCase().split(',').map(x=>x.trim());
 for(const [name,value] of Object.entries(headers))if(!['connection','keep-alive','transfer-encoding','upgrade','proxy-authenticate','trailer'].includes(name)&&!connection.includes(name))out[name]=value;
 if(headers['set-cookie'])out['set-cookie']=headers['set-cookie'].map(responseCookie).filter(Boolean);
 if(headers.location){try{const u=new URL(headers.location,origin);if(u.host===target.hostname+':'+target.port)out.location=origin+u.pathname+u.search+u.hash;}catch{delete out.location;}}
 // Native form POSTs need a non-null same-origin Origin; external requests still receive no referrer.
 out['referrer-policy']='same-origin';out['cache-control']='no-store';out['x-content-type-options']='nosniff';
 const ancestor='frame-ancestors '+previewConfig().parent;
 // A separate CSP can only add restrictions; existing application policies are preserved.
 out['content-security-policy']=[...(headers['content-security-policy']?[String(headers['content-security-policy'])]:[]),ancestor];
 return out;
}
async function handle(req:IncomingMessage,res:ServerResponse){
 try{
  const c=await projectForHost(req),path=safeProxyPath(req.url||'/');
  if(path==='/_apphub/check'){
   if(req.method!=='GET')return message(res,405,'访问校验无效');
   let probe=false;try{const raw=String(req.headers['x-apphub-probe']||'');if(!raw.startsWith('enc:v1:')||raw.length>4096)throw new Error('invalid probe');const value=decryptValue(raw),p=JSON.parse(value);probe=p.purpose==='preview-health'&&p.projectId===c.p.project_id&&p.expires>Date.now()&&p.expires<Date.now()+11000&&p.path===req.headers['x-apphub-probe-path']&&req.headers['x-apphub-probe-method']==='GET';}catch{}
   if(!probe)await access(req,c);res.writeHead(204,{'Cache-Control':'no-store'});res.end();return;
  }
  if(path.startsWith('/_apphub/open?')){
   if(req.method!=='GET')return message(res,405,'请从项目页面重新打开测试');
   const ticket=new URL(path,c.origin).searchParams.get('ticket')||'';const a=await access(req,c,ticket),token=randomBytes(32).toString('hex');
   const changed=await sql`update apphub_preview_access set token_hash=${hash(token)} where id=${a.id} and token_hash is null and ticket_expires_at>now() returning id`;
   if(!changed.length)throw new Error('打开链接已使用，请从项目重新打开');
   res.writeHead(303,{Location:'/', 'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':`${previewCookie}=${token}; Path=/; HttpOnly; ${previewCookieAttributes()}; Max-Age=${Math.max(1,Math.floor((new Date(a.expires_at).getTime()-Date.now())/1000))}`});res.end();return;
  }
  await access(req,c);
  if(req.headers.origin&&req.headers.origin!==c.origin)return message(res,403,'请在当前项目测试页面内操作');
  if(!['GET','HEAD','OPTIONS'].includes(req.method||'GET')&&req.headers.origin!==c.origin)return message(res,403,'请在当前项目测试页面内提交操作');
  if(path.startsWith('/_apphub/'))return message(res,404,'测试入口不存在');
  if(Number(req.headers['content-length']||0)>200*1024*1024)return message(res,413,'文件超过测试环境上传限额');
  const upstream=http.request({...c.target,path,method:req.method,headers:{...requestHeaders(req.headers,c.origin),'x-apphub-preview-access':String(req.headers.cookie||'')}},reply=>{
   if(req.headers['sec-fetch-dest']==='iframe'&&!allowsFrame(String(reply.headers['content-security-policy']||''),String(reply.headers['x-frame-options']||''),c.cfg.parent,c.origin)){
    reply.destroy();return message(res,409,'应用设置禁止嵌入页面，请让应用负责人允许 AppHub 地址后保存新版本进行测试。平台不会移除应用自身的访问保护。');
   }
   res.writeHead(reply.statusCode||502,upstreamHeaders(reply.headers,c.origin,c.target));reply.pipe(res);reply.on('error',()=>res.destroy());
  });
  upstream.setTimeout(120000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)message(res,502,'测试应用暂时不可用，请检查是否已停止或正在准备新版本');else res.destroy();});
  let bytes=0;req.on('data',chunk=>{bytes+=chunk.length;if(bytes>200*1024*1024){upstream.destroy();if(!res.headersSent)message(res,413,'文件超过测试环境上传限额');req.destroy();}});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 }catch{if(!res.headersSent)message(res,403,'当前测试访问不可用或已过期，请回到项目点击“重新打开”；如权限已被移除，请联系项目负责人');}
}
async function upgrade(req:IncomingMessage,socket:Duplex,head:Buffer){
 try{
  const c=await projectForHost(req);await access(req,c);const path=safeProxyPath(req.url||'/');
  if(req.headers.origin!==c.origin||req.headers.upgrade?.toLowerCase()!=='websocket'||path.startsWith('/_apphub/'))throw new Error('invalid websocket');
  const upstream=http.request({...c.target,path,headers:{...requestHeaders(req.headers,c.origin,true),'x-apphub-preview-access':String(req.headers.cookie||'')}});
  upstream.setTimeout(15000,()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
  upstream.on('upgrade',(reply,remote,rest)=>{upstream.setTimeout(0);const headers=upstreamHeaders(reply.headers,c.origin,c.target);headers.connection='Upgrade';headers.upgrade='websocket';socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(headers).flatMap(([k,v])=>Array.isArray(v)?v.map(x=>k+': '+x):[k+': '+v]).join('\r\n')+'\r\n\r\n');if(rest.length)socket.write(rest);if(head.length)remote.write(head);remote.pipe(socket);socket.pipe(remote);const authTimer=setInterval(()=>void access(req,c).catch(()=>{socket.destroy();remote.destroy();}),15000);authTimer.unref();socket.on('close',()=>clearInterval(authTimer));remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());setTimeout(()=>{socket.destroy();remote.destroy();},3600000).unref();});
  upstream.on('response',reply=>{reply.resume();socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');});upstream.end();
 }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
}
export function startPreviewGateway(){
 if(!process.env.APPHUB_PREVIEW_BASE_DOMAIN)return;previewConfig();
 const server=http.createServer((req,res)=>void handle(req,res));server.on('upgrade',(req,socket,head)=>void upgrade(req,socket,head));server.requestTimeout=120000;server.headersTimeout=15000;server.listen(3001,'0.0.0.0');
}
