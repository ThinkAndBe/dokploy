import {it,expect} from 'vitest';
import http from 'node:http';
import vm from 'node:vm';
import {once} from 'node:events';
import {previewEdgeScript} from '../../../../packages/server/src/services/preview-edge-policy';
it('HTTP ingress denies anonymous/cross-host/revoked sessions and strips platform credentials before the app',async()=>{
 let enabled=true,upstreamHeaders:any;const host='1234567890abcdef.sandbox.apphub.erke.com';
 const auth=http.createServer((req,res)=>{res.writeHead(enabled&&req.headers.cookie?.includes('__apphub_preview=good')?204:403);res.end();});auth.listen(0,'127.0.0.1');await once(auth,'listening');
 const app=http.createServer((req,res)=>{upstreamHeaders=req.headers;res.end('application-ok');});app.listen(0,'127.0.0.1');await once(app,'listening');
 const authPort=(auth.address() as any).port,appPort=(app.address() as any).port;let edge:http.Server;const mockHttp={request:(options:any,cb:any)=>http.request({...options,hostname:'127.0.0.1',port:options.hostname==='auth'?authPort:appPort},cb),createServer:(cb:any)=>{edge=http.createServer(cb);const listen=edge.listen.bind(edge);edge.listen=((...args:any[])=>listen(0,'127.0.0.1')) as any;return edge;}};
 vm.runInNewContext(previewEdgeScript,{require:(name:string)=>{if(name!=='node:http')throw Error('unexpected module');return mockHttp;},process:{env:{PREVIEW_HOST:host,AUTH_HOST:'auth',APP_PORT:'8088'}},setInterval,clearInterval});await once(edge!,'listening');const url='http://127.0.0.1:'+(edge!.address() as any).port;
 const get=(headers:any)=>new Promise<{status:number;text:()=>Promise<string>}>(resolve=>{http.get(url,{headers},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>resolve({status:r.statusCode!,text:async()=>body}));});});
 try{expect((await get({host})).status).toBe(403);expect((await get({host:'wrong',cookie:'__apphub_preview=good'})).status).toBe(403);
 const good=await get({host,cookie:'__apphub_preview=good; business=ok','x-apphub-secret':'must-not-leak'});expect(good.status).toBe(200);expect(await good.text()).toBe('application-ok');expect(upstreamHeaders.cookie).toContain('business=ok');expect(upstreamHeaders.cookie).not.toContain('__apphub');expect(upstreamHeaders['x-apphub-secret']).toBeUndefined();
 enabled=false;expect((await get({host,cookie:'__apphub_preview=good'})).status).toBe(403);
 await new Promise<void>(r=>auth.close(()=>r()));expect((await get({host,cookie:'__apphub_preview=good'})).status).toBe(403);
 }finally{edge!.closeAllConnections();app.closeAllConnections();auth.closeAllConnections();edge!.close();app.close();auth.close();}
});
