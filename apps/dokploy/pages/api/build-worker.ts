import type {NextApiRequest,NextApiResponse} from 'next';
import {workerAuth,workerSource,workerAction} from '@dokploy/server/services/build-service';
export const config={api:{bodyParser:{sizeLimit:'256kb'},responseLimit:false}};
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','no-store');
 try{if(!await workerAuth(req.headers.authorization))return res.status(401).json({error:'构建执行器未授权'});}catch{return res.status(503).json({error:'构建服务未配置'});}
 try{
 if(req.method==='GET'){
 const id=req.query.id,lease=req.query.lease;if(typeof id!=='string'||typeof lease!=='string'||!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(lease))return res.status(400).json({error:'构建参数无效'});
 const source=await workerSource(id,lease);if(!source.body)throw new Error('代码下载不可用');const reader=source.body.getReader(),chunks:Buffer[]=[];let total=0;
 try{for(;;){const v=await reader.read();if(v.done)break;total+=v.value.length;if(total>100*1024*1024)throw new Error('代码包过大');chunks.push(Buffer.from(v.value));}}finally{await reader.cancel();}
 res.setHeader('Content-Type','application/zip');return res.send(Buffer.concat(chunks));
 }
 if(req.method!=='POST')return res.status(405).end();
 return res.json(await workerAction(req.body));
 }catch(e){return res.status(400).json({error:e instanceof Error?e.message:'构建请求失败'});}
}
